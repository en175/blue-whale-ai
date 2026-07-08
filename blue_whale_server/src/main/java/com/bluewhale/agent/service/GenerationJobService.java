package com.bluewhale.agent.service;

import com.bluewhale.agent.common.exception.GlobalException;
import com.bluewhale.agent.common.resp.SystemCode;
import com.bluewhale.agent.mapper.AssetMapper;
import com.bluewhale.agent.mapper.GenerationJobMapper;
import com.bluewhale.agent.mapper.GenerationModelCapabilityMapper;
import com.bluewhale.agent.model.dto.CreateJobResponse;
import com.bluewhale.agent.model.dto.ImageGenerateRequest;
import com.bluewhale.agent.model.dto.ImageGenerationResult;
import com.bluewhale.agent.model.dto.ImageResult;
import com.bluewhale.agent.model.dto.JobStatusResponse;
import com.bluewhale.agent.model.dto.ProviderImageGenerationRequest;
import com.bluewhale.agent.model.dto.VideoGenerateRequest;
import com.bluewhale.agent.model.dto.VideoTaskResult;
import com.bluewhale.agent.model.entity.Asset;
import com.bluewhale.agent.model.entity.GenerationJob;
import com.bluewhale.agent.model.entity.GenerationModelCapability;
import com.bluewhale.agent.service.provider.ImageGenerationProvider;
import com.bluewhale.agent.service.provider.ImageGenerationProviderRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 生成任务服务：状态机 {@code queued → processing → succeeded | failed}（沿用 PRD §5.4）。
 *
 * <p>文生图同步：insert job → 按 model_id 查能力表并路由 Provider → 转存 asset → update succeeded。
 * 图文生视频异步：insert job(queued) → 调 Ark 创建任务 → update processing + providerTaskId + nextPollAt → 返 jobId。
 * poller 调 {@link #pollJob(GenerationJob)} 查 Ark 推进状态，succeeded 时下载转存。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GenerationJobService {

    /** poller 单任务最大轮询次数，超限判 upstream_timeout。 */
    public static final int MAX_POLL_COUNT = 120;
    private static final long POLL_INTERVAL_SECONDS = 5;
    private static final int MAX_REFERENCE_IMAGES = 14;

    private final GenerationJobMapper jobMapper;
    private final AssetMapper assetMapper;
    private final VolcEngineService volcEngineService;
    private final AssetStorageService assetStorageService;
    private final GenerationModelCapabilityMapper capabilityMapper;
    private final ImageGenerationProviderRegistry providerRegistry;

    /** 文生图同步生成。 */
    @Transactional
    public ImageResult createImageJob(ImageGenerateRequest req, Long userId) {
        GenerationModelCapability capability = capabilityMapper.selectEnabledByModelId(req.modelId())
                .orElseThrow(() -> new GlobalException(SystemCode.FAILURE_CODE, "不支持的模型: " + req.modelId()));

        ProviderImageGenerationRequest providerReq = buildProviderRequest(req, capability);
        GenerationJob job = newGenerationJob(userId, GenerationJob.TYPE_IMAGE, capability.getProviderId(), buildImageInput(req));
        jobMapper.insert(job);
        try {
            ImageGenerationProvider provider = providerRegistry.getProvider(capability.getProviderId());
            ImageGenerationResult result = provider.generate(providerReq);
            Asset asset = assetStorageService.downloadAndStore(result.getImageUrl(), userId, Asset.TYPE_IMAGE, null);
            job.setStatus(GenerationJob.STATUS_SUCCEEDED)
                    .setProgress(100)
                    .setOutputAssetIds(List.of(asset.getId()));
            jobMapper.updateById(job);
            return new ImageResult(asset.getId(), asset.getUrl());
        } catch (DataAccessException e) {
            markFailed(job, 500, "数据库未连接，请检查本地 MySQL");
            throw new GlobalException("数据库未连接，请检查本地 MySQL");
        } catch (Exception e) {
            markFailed(job, SystemCode.FAILURE_CODE, e.getMessage());
            throw e instanceof GlobalException ge ? ge : new GlobalException(SystemCode.FAILURE_CODE, e.getMessage());
        }
    }

    /** 图文生视频异步提交，立即返 jobId。 */
    @Transactional
    public CreateJobResponse createVideoJob(VideoGenerateRequest req, Long userId) {
        GenerationJob job = newGenerationJob(userId, GenerationJob.TYPE_VIDEO, "volcengine", buildVideoInput(req));
        jobMapper.insert(job);
        try {
            String taskId = volcEngineService.createVideoTask(req.prompt(), req.firstFrameUrl(),
                    req.aspectRatio(), req.resolution(), req.duration());
            job.setStatus(GenerationJob.STATUS_PROCESSING)
                    .setProviderTaskId(taskId)
                    .setPollCount(0)
                    .setNextPollAt(LocalDateTime.now().plusSeconds(POLL_INTERVAL_SECONDS))
                    .setProgress(0);
            jobMapper.updateById(job);
            return new CreateJobResponse(job.getId(), GenerationJob.STATUS_QUEUED);
        } catch (Exception e) {
            markFailed(job, SystemCode.FAILURE_CODE, e.getMessage());
            throw e instanceof GlobalException ge ? ge : new GlobalException(SystemCode.FAILURE_CODE, e.getMessage());
        }
    }

    /** 查询任务状态，供前端轮询。 */
    public JobStatusResponse getJobStatus(Long jobId) {
        GenerationJob job = jobMapper.selectById(jobId);
        if (job == null) {
            throw new GlobalException(SystemCode.NOT_FOUND_CODE, "job not found");
        }
        JobStatusResponse.AssetDto assetDto = null;
        if (GenerationJob.STATUS_SUCCEEDED.equals(job.getStatus())
                && job.getOutputAssetIds() != null && !job.getOutputAssetIds().isEmpty()) {
            Asset asset = assetMapper.selectById(job.getOutputAssetIds().get(0));
            if (asset != null) {
                assetDto = new JobStatusResponse.AssetDto(asset.getId(), asset.getUrl(), asset.getType());
            }
        }
        return new JobStatusResponse(job.getId(), job.getStatus(), job.getProgress(), assetDto);
    }

    /** poller 调：查 Ark 更新状态，succeeded 时下载转存视频。 */
    @Transactional
    public void pollJob(GenerationJob job) {
        if (!GenerationJob.STATUS_PROCESSING.equals(job.getStatus())) {
            return;
        }
        int pollCount = job.getPollCount() == null ? 0 : job.getPollCount();
        if (pollCount >= MAX_POLL_COUNT) {
            markFailed(job, SystemCode.UPSTREAM_TIMEOUT_CODE, "轮询次数超限（" + MAX_POLL_COUNT + "）");
            return;
        }
        VideoTaskResult result = volcEngineService.getVideoTask(job.getProviderTaskId());
        String status = mapStatus(result.status());
        int newPollCount = pollCount + 1;
        job.setPollCount(newPollCount);
        job.setLastPolledAt(LocalDateTime.now());
        job.setNextPollAt(LocalDateTime.now().plusSeconds(POLL_INTERVAL_SECONDS));
        switch (status) {
            case GenerationJob.STATUS_PROCESSING -> {
                job.setProgress(Math.min(90, newPollCount * 5));
                jobMapper.updateById(job);
            }
            case GenerationJob.STATUS_SUCCEEDED -> {
                if (result.videoUrl() == null) {
                    markFailed(job, SystemCode.ASSET_UNAVAILABLE_CODE, "succeeded 但无 video_url");
                    return;
                }
                Asset asset = assetStorageService.downloadAndStore(result.videoUrl(), job.getUserId(),
                        Asset.TYPE_VIDEO, "video/mp4");
                job.setStatus(GenerationJob.STATUS_SUCCEEDED)
                        .setProgress(100)
                        .setOutputAssetIds(List.of(asset.getId()));
                jobMapper.updateById(job);
                log.info("video job {} succeeded, assetId={}", job.getId(), asset.getId());
            }
            case GenerationJob.STATUS_FAILED -> markFailed(job, SystemCode.CONTENT_MODERATION_REJECTED_CODE,
                    result.errorMsg() != null ? result.errorMsg() : "上游任务失败");
            default -> jobMapper.updateById(job);
        }
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

    private GenerationJob newGenerationJob(Long userId, String type, String provider, Map<String, Object> input) {
        return new GenerationJob()
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
        input.put("reference_images", req.referenceImages());
        input.put("watermark", req.watermark());
        return input;
    }

    private Map<String, Object> buildVideoInput(VideoGenerateRequest req) {
        Map<String, Object> input = new HashMap<>();
        input.put("prompt", req.prompt());
        input.put("resolution", req.resolution());
        input.put("aspectRatio", req.aspectRatio());
        input.put("duration", req.duration());
        input.put("firstFrameUrl", req.firstFrameUrl());
        return input;
    }

    private void markFailed(GenerationJob job, int code, String message) {
        job.setStatus(GenerationJob.STATUS_FAILED);
        Map<String, Object> err = new HashMap<>();
        err.put("code", code);
        err.put("message", message == null ? "" : message);
        job.setError(err);
        jobMapper.updateById(job);
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

    /** 火山 status → 本地状态机。 */
    private String mapStatus(String upstream) {
        if (upstream == null) {
            return GenerationJob.STATUS_PROCESSING;
        }
        return switch (upstream.toLowerCase()) {
            case "succeeded" -> GenerationJob.STATUS_SUCCEEDED;
            case "failed", "cancelled", "expired" -> GenerationJob.STATUS_FAILED;
            default -> GenerationJob.STATUS_PROCESSING; // queued / running
        };
    }
}
