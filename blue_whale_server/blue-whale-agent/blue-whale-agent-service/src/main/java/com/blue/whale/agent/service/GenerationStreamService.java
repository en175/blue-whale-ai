package com.blue.whale.agent.service;

import com.blue.whale.agent.config.AsyncConfig;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.model.dto.ProviderImageGenerationRequest;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import com.blue.whale.agent.service.governance.CostReservationService;
import com.blue.whale.agent.service.provider.ImageGenerationProvider;
import com.blue.whale.agent.service.provider.ImageGenerationProviderRegistry;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.volcengine.ark.runtime.model.images.generation.ImageGenStreamEvent;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 流式图片生成后台处理：独立 bean，避免 {@code @Async} self-invocation 失效。
 *
 * <p>由 {@code GenerationJobService} 跨 bean 调用 {@link #runImageStream}，在
 * {@link AsyncConfig#GENERATION_EXECUTOR} 线程池异步执行。方法不加 {@code @Transactional}
 * （长耗时持 DB 连接），每张图落库用 read-modify-write 小事务——单 job 单后台线程
 * {@code blockingForEach} 串行消费，无并发。
 *
 * <p>事件映射：{@code partial_succeeded}→下载转存+append+emit；{@code partial_failed}
 * 非 {@code InternalServiceError}→记录单张失败继续，否则抛异常终止；流结束标 succeeded + done。
 */
@Slf4j
@Service
public class GenerationStreamService {

    /** 火山内部服务错误码，收到即终止流。 */
    private static final String INTERNAL_ERROR_CODE = "InternalServiceError";

    private final GenerationJobMapper jobMapper;
    private final AssetStorageService assetStorageService;
    private final ImageGenerationProviderRegistry providerRegistry;
    private final JobStreamBus bus;
    private final ProjectEventService projectEventService;
    private final TransactionTemplate transactionTemplate;
    private final CostReservationService costReservationService;

    public GenerationStreamService(GenerationJobMapper jobMapper,
                                   AssetStorageService assetStorageService,
                                   ImageGenerationProviderRegistry providerRegistry,
                                   JobStreamBus bus,
                                   ProjectEventService projectEventService,
                                   CostReservationService costReservationService,
                                   PlatformTransactionManager transactionManager) {
        this.jobMapper = jobMapper;
        this.assetStorageService = assetStorageService;
        this.providerRegistry = providerRegistry;
        this.bus = bus;
        this.projectEventService = projectEventService;
        this.costReservationService = costReservationService;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    /** 异步执行流式生成，逐张落 asset + 推 SSE。 */
    @Async(AsyncConfig.GENERATION_EXECUTOR)
    public void runImageStream(Long jobId, GenerationModelCapability capability, ProviderImageGenerationRequest req) {
        GenerationJob job = jobMapper.selectById(jobId);
        if (job == null) {
            log.warn("stream job {} not found, skip", jobId);
            return;
        }
        boolean providerCallStarted = false;
        try {
            costReservationService.requireActiveBeforeProvider(jobId);
            ImageGenerationProvider provider = providerRegistry.getProvider(capability.getProviderId());
            provider.requireReady();
            providerCallStarted = true;
            provider.streamGenerateImages(req)
                    .blockingForEach(event -> dispatch(job, event));
            markSucceeded(jobId);
            costReservationService.settleReserved(jobId, "PROVIDER_COST_PROVEN");
            bus.emit(jobId, SsePayload.done(null));
            bus.complete(jobId);
            log.info("stream job {} succeeded", jobId);
        } catch (Exception e) {
            log.error("stream job {} failed", jobId, e);
            String msg = "图像生成失败";
            markFailed(jobId, msg);
            costReservationService.finalizeProviderFailure(jobId, providerCallStarted);
            String budgetEffect = costReservationService.budgetEffect(jobId).wireValue();
            bus.emit(jobId, SsePayload.error(budgetEffect));
            bus.complete(jobId);
        }
    }

    private void dispatch(GenerationJob job, ImageGenStreamEvent event) {
        String type = event.getType();
        if (type == null) {
            return;
        }
        if (type.endsWith("partial_succeeded")) {
            onPartialSucceeded(job, event);
        } else if (type.endsWith("partial_failed")) {
            onPartialFailed(job, event);
        }
        // completed 由 blockingForEach 结束后统一标 succeeded + done
    }

    private void onPartialSucceeded(GenerationJob job, ImageGenStreamEvent event) {
        String url = event.getUrl();
        if (url == null || url.isBlank()) {
            return;
        }
        Asset asset = assetStorageService.downloadAndStore(url, job.getUserId(), Asset.TYPE_IMAGE, null);
        appendAssetAndEmit(job.getId(), event.getImageIndex(), asset);
    }

    private void onPartialFailed(GenerationJob job, ImageGenStreamEvent event) {
        String code = null;
        String msg = null;
        if (event.getError() != null) {
            code = event.getError().getCode();
            msg = event.getError().getMessage();
        }
        if (INTERNAL_ERROR_CODE.equals(code)) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "上游内部错误: " + msg);
        }
        bus.emit(job.getId(), SsePayload.imageFailed(
                event.getImageIndex(),
                costReservationService.budgetEffect(job.getId()).wireValue()));
    }

    /** 小事务：原子提交 asset 追加、job 状态与 Project 事件/outbox，再推送 job SSE。 */
    private void appendAssetAndEmit(Long jobId, int imageIndex, Asset asset) {
        transactionTemplate.executeWithoutResult(status -> {
            GenerationJob job = jobMapper.selectById(jobId);
            List<Long> ids = job.getOutputAssetIds() == null
                    ? new ArrayList<>() : new ArrayList<>(job.getOutputAssetIds());
            ids.add(asset.getId());
            job.setOutputAssetIds(ids).setStatus(GenerationJob.STATUS_PROCESSING);
            jobMapper.updateById(job);
            emitJobStatusChanged(job);
        });
        bus.emit(jobId, SsePayload.image(imageIndex, asset.getId(), asset.getUrl()));
    }

    private void markSucceeded(Long jobId) {
        transactionTemplate.executeWithoutResult(status -> {
            GenerationJob job = jobMapper.selectById(jobId);
            if (job == null) {
                return;
            }
            job.setStatus(GenerationJob.STATUS_SUCCEEDED).setProgress(100);
            jobMapper.updateById(job);
            emitJobStatusChanged(job);
        });
    }

    private void markFailed(Long jobId, String message) {
        transactionTemplate.executeWithoutResult(status -> {
            GenerationJob job = jobMapper.selectById(jobId);
            if (job == null) {
                return;
            }
            Map<String, Object> err = new HashMap<>();
            err.put("code", SystemCode.FAILURE_CODE);
            err.put("message", message == null ? "" : message);
            job.setStatus(GenerationJob.STATUS_FAILED).setError(err);
            jobMapper.updateById(job);
            emitJobStatusChanged(job);
        });
    }

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

}
