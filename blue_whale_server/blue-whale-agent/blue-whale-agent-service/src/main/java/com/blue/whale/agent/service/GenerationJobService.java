package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationModelCapabilityMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.*;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import com.blue.whale.agent.service.provider.ImageGenerationProvider;
import com.blue.whale.agent.service.provider.ImageGenerationProviderRegistry;
import com.blue.whale.agent.service.governance.CostReservationService;
import com.blue.whale.agent.service.governance.AuthorizedGenerationAction;
import com.blue.whale.agent.service.governance.GenerationCostAdmissionService;
import com.blue.whale.agent.service.governance.GovernanceException;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 生成任务服务：状态机 {@code queued → processing → succeeded | failed}（沿用 PRD §5.4）。
 *
 * <p>文生图同步：insert job → 按 model_id 查能力表并路由 Provider → 转存 asset → update succeeded。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GenerationJobService {

    private static final int MAX_REFERENCE_IMAGES = 14;

    private final GenerationJobMapper jobMapper;
    private final AssetMapper assetMapper;
    private final AssetStorageService assetStorageService;
    private final GenerationModelCapabilityMapper capabilityMapper;
    private final ImageGenerationProviderRegistry providerRegistry;
    private final GenerationStreamService generationStreamService;
    private final ProjectEventService projectEventService;
    private final ProjectService projectService;
    private final GenerationCostAdmissionService costAdmissionService;
    private final CostReservationService costReservationService;
    private final PlatformTransactionManager transactionManager;

    /** 文生图：流式模型建 job 异步逐张生成（返 job_id）；非流式模型同步一次性返回（返 asset_id+url）。 */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public ImageGenerateResponse createImageJob(
            ImageGenerateRequest req, Long userId, Long inputRequestId) {
        Long projectId = requireOwnedProject(req.projectId(), userId);
        GenerationModelCapability capability = capabilityMapper.selectEnabledByModelId(req.modelId())
                .orElseThrow(() -> new GlobalException(SystemCode.FAILURE_CODE, "不支持的模型: " + req.modelId()));

        ProviderImageGenerationRequest providerReq = buildProviderRequest(req, capability);
        Map<String, Object> input = buildImageInput(req);
        Map<String, Object> admissionArguments = new HashMap<>(input);
        admissionArguments.put("_cost_provider", capability.getProviderId());
        String proposedActionIdentity = inputRequestId == null
                ? "legacy-dock:" + UUID.randomUUID() : null;
        boolean streaming = streamFlag(capability);
        GenerationJob job = inTransaction(() -> {
            AuthorizedGenerationAction authorization = costAdmissionService.authorizeRequest(
                    userId, projectId, "LegacyGenerationRequest", proposedActionIdentity,
                    proposedActionIdentity, "generate_image", admissionArguments,
                    false, inputRequestId);
            GenerationJob created = newGenerationJob(projectId, userId, GenerationJob.TYPE_IMAGE,
                    capability.getProviderId(), input);
            jobMapper.insert(created);
            created.setActionIdentity(authorization.actionIdentity())
                    .setProjectActionIdentity(authorization.actionIdentity())
                    .setExpectedOutputCount(providerReq.getQuantity());
            jobMapper.updateById(created);
            costAdmissionService.reserveAuthorized(
                    userId, projectId, created.getId(), created.getActionIdentity(), "generate_image",
                    authorization.quote());
            emitJobCreated(created);
            if (streaming) {
                created.setStatus(GenerationJob.STATUS_PROCESSING);
                jobMapper.updateById(created);
                emitJobStatusChanged(created);
            }
            return created;
        });

        if (streaming) {
            triggerStreamAfterCommit(job.getId(), capability, providerReq);
            return ImageGenerateResponse.streaming(job.getId());
        }

        boolean providerCallStarted = false;
        try {
            costReservationService.requireActiveBeforeProvider(job.getId());
            ImageGenerationProvider provider = providerRegistry.getProvider(capability.getProviderId());
            provider.requireReady();
            providerCallStarted = true;
            ImageGenerationResult result = provider.generate(providerReq);
            Asset asset = assetStorageService.downloadAndStore(result.getImageUrl(), userId, Asset.TYPE_IMAGE, null);
            inTransaction(() -> {
                job.setStatus(GenerationJob.STATUS_SUCCEEDED)
                        .setProgress(100)
                        .setOutputAssetIds(List.of(asset.getId()));
                jobMapper.updateById(job);
                costReservationService.settleReserved(job.getId(), "PROVIDER_COST_PROVEN");
                emitJobStatusChanged(job);
            });
            return ImageGenerateResponse.sync(asset.getId(), asset.getUrl());
        } catch (GovernanceException e) {
            throw e;
        } catch (DataAccessException e) {
            // 暴露真实根因（最内层异常 message），避免笼统的“数据库未连接”掩盖问题
            log.error("createImageJob 数据库操作异常", e);
            boolean paidCallStarted = providerCallStarted;
            inTransaction(() -> {
                markFailed(job, 500, "服务暂时不可用");
                finalizeCostAfterFailure(job.getId(), paidCallStarted);
            });
            throw new GlobalException(SystemCode.FAILURE_CODE, "服务暂时不可用");
        } catch (Exception e) {
            log.error("createImageJob 上游生成失败", e);
            boolean paidCallStarted = providerCallStarted;
            inTransaction(() -> {
                markFailed(job, SystemCode.FAILURE_CODE, "图像生成失败");
                finalizeCostAfterFailure(job.getId(), paidCallStarted);
            });
            throw new GlobalException(SystemCode.FAILURE_CODE, "图像生成失败");
        }
    }

    private <T> T inTransaction(Supplier<T> action) {
        return new TransactionTemplate(transactionManager).execute(status -> action.get());
    }

    private void inTransaction(Runnable action) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> action.run());
    }

    /** 模型能力 features.stream=true 走流式路径。 */
    private boolean streamFlag(GenerationModelCapability capability) {
        GenerationModelCapability.Features features = capability.getFeatures();
        return features != null && Boolean.TRUE.equals(features.getStream());
    }

    /** 事务提交后才触发 @Async（保证 insert 已可见）；无事务上下文则直接调。 */
    private void triggerStreamAfterCommit(Long jobId, GenerationModelCapability capability,
                                          ProviderImageGenerationRequest req) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    generationStreamService.runImageStream(jobId, capability, req);
                }
            });
        } else {
            generationStreamService.runImageStream(jobId, capability, req);
        }
    }

    /** 查询任务状态，供前端轮询。 */
    public JobStatusResponse getJobStatus(Long jobId, Long userId) {
        GenerationJob job = jobMapper.selectById(jobId);
        if (job == null || !java.util.Objects.equals(job.getUserId(), userId)) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        projectService.requireOwned(job.getProjectId(), userId);
        JobStatusResponse.AssetDto assetDto = null;
        if (GenerationJob.STATUS_SUCCEEDED.equals(job.getStatus())
                && job.getOutputAssetIds() != null && !job.getOutputAssetIds().isEmpty()) {
            Asset asset = assetMapper.selectById(job.getOutputAssetIds().get(0));
            if (asset != null) {
                assetDto = new JobStatusResponse.AssetDto(asset.getId(), asset.getUrl(), asset.getType());
            }
        }
        Map<String, Object> publicError = null;
        if (GenerationJob.STATUS_FAILED.equals(job.getStatus())) {
            Map<String, Object> storedError = job.getError() == null ? Map.of() : job.getError();
            publicError = GenerationPublicError.project(
                    storedError,
                    job.getType(),
                    costReservationService.budgetEffect(job.getId()).wireValue());
        }
        return new JobStatusResponse(
                job.getId(), job.getStatus(), job.getProgress(), assetDto, publicError);
    }

    /**
     * 任务列表（生成流页）：按 {@code userId} + {@code type/status/projectId} 过滤，分页，按创建时间倒序。
     * 产出资源（outputAssets）一次性按 outputAssetIds 批量查 assets 补 url，避免 N+1。
     */
    public Page<JobListItemResponse> listJobs(Long userId, String type, String status, Long projectId, int page, int size) {
        Page<GenerationJob> jobPage = jobMapper.selectPage(new Page<>(page, size),
                Wrappers.<GenerationJob>lambdaQuery()
                        .eq(GenerationJob::getUserId, userId)
                        .eq(type != null && !type.isBlank(), GenerationJob::getType, type)
                        .eq(status != null && !status.isBlank(), GenerationJob::getStatus, status)
                        .eq(projectId != null, GenerationJob::getProjectId, projectId)
                        .orderByDesc(GenerationJob::getGmtCreate));

        List<Long> assetIds = jobPage.getRecords().stream()
                .filter(j -> j.getOutputAssetIds() != null)
                .flatMap(j -> j.getOutputAssetIds().stream())
                .distinct()
                .toList();
        Map<Long, Asset> assetMap = new HashMap<>();
        if (!assetIds.isEmpty()) {
            for (Asset a : assetMapper.selectBatchIds(assetIds)) {
                assetMap.put(a.getId(), a);
            }
        }

        List<JobListItemResponse> items = jobPage.getRecords().stream()
                .map(j -> new JobListItemResponse(j.getId(), j.getType(), j.getStatus(), j.getProgress(),
                        j.getInput(), j.getGmtCreate(), resolveOutputAssets(j, assetMap)))
                .toList();

        Page<JobListItemResponse> result = new Page<>(jobPage.getCurrent(), jobPage.getSize(), jobPage.getTotal());
        result.setRecords(items);
        return result;
    }

    private List<JobListItemResponse.OutputAsset> resolveOutputAssets(GenerationJob job, Map<Long, Asset> assetMap) {
        if (job.getOutputAssetIds() == null) {
            return List.of();
        }
        return job.getOutputAssetIds().stream()
                .map(assetMap::get)
                .filter(a -> a != null)
                .map(a -> new JobListItemResponse.OutputAsset(a.getId(), a.getUrl(), a.getType(), a.getWidth(), a.getHeight()))
                .toList();
    }

    private ProviderImageGenerationRequest buildProviderRequest(ImageGenerateRequest req,
                                                                 GenerationModelCapability capability) {
        String size = resolveApiSize(req.sizeId(), capability);
        String outputFormat = resolveOutputFormat(req.format(), capability);
        List<String> referenceImages = resolveReferenceImages(req.referenceImages(), capability);
        int quantity = resolveQuantity(req.quantity(), capability);

        return ProviderImageGenerationRequest.builder()
                .modelId(capability.getModelId())
                .prompt(req.prompt())
                .size(size)
                .aspectRatio(req.aspectRatio())
                .outputFormat(outputFormat)
                .quantity(quantity)
                .referenceImages(referenceImages)
                .watermark(req.watermark())
                .build();
    }

    private GenerationJob newGenerationJob(Long projectId, Long userId, String type,
                                           String provider, Map<String, Object> input) {
        return new GenerationJob()
                .setProjectId(projectId)
                .setUserId(userId)
                .setType(type)
                .setSource(GenerationJob.SOURCE_DOCK)
                .setInput(input)
                .setStatus(GenerationJob.STATUS_QUEUED)
                .setProgress(0)
                .setProvider(provider);
    }

    private Map<String, Object> buildImageInput(ImageGenerateRequest req) {
        Map<String, Object> input = new HashMap<>();
        input.put("prompt", req.prompt());
        input.put("model_id", req.modelId());
        input.put("size_id", req.sizeId());
        input.put("aspect_ratio", req.aspectRatio());
        input.put("format", req.format());
        input.put("quantity", req.quantity());
        input.put("expected_output_count", req.quantity() == null ? 1 : req.quantity());
        input.put("reference_images", req.referenceImages());
        input.put("watermark", req.watermark());
        input.put("project_id", req.projectId());
        return input;
    }

    private Long requireOwnedProject(Long projectId, Long userId) {
        if (projectId == null) {
            throw GovernanceException.actionNotAllowed();
        }
        projectService.requireOwned(projectId, userId);
        return projectId;
    }

    private void markFailed(GenerationJob job, int code, String message) {
        job.setStatus(GenerationJob.STATUS_FAILED);
        Map<String, Object> err = new HashMap<>();
        err.put("code", code);
        err.put("message", message == null ? "" : message);
        job.setError(err);
        jobMapper.updateById(job);
        emitJobStatusChanged(job);
    }

    private void finalizeCostAfterFailure(Long jobId, boolean providerCallStarted) {
        costReservationService.finalizeProviderFailure(jobId, providerCallStarted);
    }

    /** Job 创建事件（payload 含初始 status/type）。仅归属 Project 的 Job 产事件。 */
    private void emitJobCreated(GenerationJob job) {
        if (job.getProjectId() == null) {
            return;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", job.getId());
        payload.put("type", job.getType());
        payload.put("status", job.getStatus());
        projectEventService.appendEvent(job.getProjectId(), EventType.GENERATION_JOB_CREATED,
                AggregateType.GENERATION_JOB, String.valueOf(job.getId()), job.getVersion(),
                payload, null, null);
    }

    /** Job 状态变更事件（payload 含 status/progress/output_asset_ids）。仅归属 Project 的 Job 产事件。 */
    private void emitJobStatusChanged(GenerationJob job) {
        if (job.getProjectId() == null) {
            return;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", job.getId());
        payload.put("status", job.getStatus());
        payload.put("progress", job.getProgress());
        payload.put("output_asset_ids", job.getOutputAssetIds());
        projectEventService.appendEvent(job.getProjectId(), EventType.GENERATION_JOB_STATUS_CHANGED,
                AggregateType.GENERATION_JOB, String.valueOf(job.getId()), job.getVersion(),
                payload, null, null);
    }

    /** 前端 resolution(size_id) → 上游 API 需要的 size 值。 */
    private String resolveApiSize(String resolution, GenerationModelCapability capability) {
        String sizeId = (resolution == null || resolution.isBlank()) ? capability.getDefaultSize() : resolution;
        List<GenerationModelCapability.SizeOption> sizes = capability.getSupportedSizes();
        if (sizes == null || sizes.isEmpty()) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "模型未配置可用尺寸");
        }
        for (GenerationModelCapability.SizeOption option : sizes) {
            if (option.getId().equalsIgnoreCase(sizeId)) {
                return option.getApiValue();
            }
        }
        throw new GlobalException(SystemCode.FAILURE_CODE,
                "模型不支持该尺寸: " + sizeId + "，可用: " + sizes.stream().map(GenerationModelCapability.SizeOption::getId).toList());
    }

    /** 按模型能力校验/兜底输出格式。 */
    private String resolveOutputFormat(String format, GenerationModelCapability capability) {
        List<String> supported = capability.getSupportedFormats();
        if (format == null || format.isBlank()) {
            return capability.getDefaultFormat();
        }
        if (supported == null || !supported.contains(format)) {
            throw new GlobalException(SystemCode.FAILURE_CODE,
                    "模型不支持该格式: " + format + "，可用: " + supported);
        }
        return format;
    }

    /** 按模型能力校验参考图。 */
    private List<String> resolveReferenceImages(List<String> referenceImages, GenerationModelCapability capability) {
        if (referenceImages == null || referenceImages.isEmpty()) {
            return null;
        }
        GenerationModelCapability.Features features = capability.getFeatures();
        if (features == null || !Boolean.TRUE.equals(features.getReferenceImage())) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "当前模型不支持参考图");
        }
        if (referenceImages.size() > MAX_REFERENCE_IMAGES) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "参考图最多 " + MAX_REFERENCE_IMAGES + " 张");
        }
        return referenceImages;
    }

    /** 按模型能力校验生成数量。 */
    private int resolveQuantity(Integer quantity, GenerationModelCapability capability) {
        int value = quantity == null ? 1 : quantity;
        GenerationModelCapability.Features features = capability.getFeatures();
        int max = (features != null && features.getQuantityMax() != null) ? features.getQuantityMax() : 1;
        if (value < 1) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "生成数量不能小于 1");
        }
        if (value > max) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "生成数量超过该模型限制（最大 " + max + "）");
        }
        return value;
    }

}
