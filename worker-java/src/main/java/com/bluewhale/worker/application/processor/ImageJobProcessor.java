package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.GenerationModelCapabilityEntity;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageProviderError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient.GeneratedImage;
import com.bluewhale.worker.infrastructure.mapper.GenerationModelCapabilityMapper;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Conditional;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.LinkedHashSet;

/**
 * 图片作业处理器（generation-worker.ts:499-685 image 分支逐字移植）。
 * <p>
 * 编排流程：claim → 校验输入 → 查能力 → 校验参考图 → 解封凭证 → 渠道映射 →
 * 调 provider（支持批量循环）→ 转存 → createAsset 循环 → completeJob。
 * <p>
 * 错误码映射（附录 A image + generation-worker.ts）：
 * <ul>
 *   <li>unsupported_type:288 / invalid_input:303 / model_unavailable:338</li>
 *   <li>invalid_reference:349/362 / provider_credential_missing:502</li>
 *   <li>invalid_reference_type:537/550 / unsupported_input:558 / no_result:600</li>
 *   <li>catch-all:687-692 / provider 分类（content > quota > provider_failed）</li>
 * </ul>
 * <p>
 * 瞬态重试（generation-worker.ts:705-725）：
 * TRANSIENT={provider_failed} 且 retry_count&lt;3 → requeueImageJobForRetry，
 * 退避 30/60/120s 封顶 300s（caller 计算 :84-87），return WITHOUT ack-fail。
 * <p>
 * 修正三：ARK provider（ark-image-provider.ts）不移植——new-api 网关是唯一 provider。
 * 修正一：cost_reservations 结算不在实现范围（settle-ops.ts:228 整块省略）。
 */
@Component
@Conditional(com.bluewhale.worker.config.ImageEnabledCondition.class)
public class ImageJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(ImageJobProcessor.class);

    /** 瞬时失败码集合（generation-worker.ts:76 TRANSIENT_IMAGE_ERROR_CODES）。 */
    private static final Set<String> TRANSIENT_IMAGE_ERROR_CODES =
            Set.of(GenerationError.ERROR_PROVIDER_FAILED);

    /** 图片任务最大重试次数（generation-worker.ts:78 MAX_IMAGE_RETRIES）。 */
    private static final int MAX_IMAGE_RETRIES = 3;

    private final JobStateMachineService stateMachine;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiImageClient imageClient;
    private final GenerationModelCapabilityMapper capabilityMapper;
    private final TosMediaStorage tosService;
    private final String workerId;
    private final HttpClient fetchClient;

    public ImageJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiImageClient imageClient,
            GenerationModelCapabilityMapper capabilityMapper,
            TosMediaStorage tosService
    ) {
        this.stateMachine = stateMachine;
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.imageClient = imageClient;
        this.capabilityMapper = capabilityMapper;
        this.tosService = tosService;
        this.workerId = "image-" + hostname() + "-" + ProcessHandle.current().pid();
        this.fetchClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    @Override
    public String tag() {
        return "image";
    }

    /**
     * 处理一个图片 job（generation-worker.ts:127-135 processImageJobById）。
     * <p>
     * claim 在 try 外（与 audio 同构：DB 异常上抛 → consumer 不 ack → 重投）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimImageJobById(jobId, workerId);
        } catch (Exception error) {
            log.error("claimImageJobById 失败 jobId={}", jobId, error);
            throw error;
        }
        if (claimOpt.isEmpty()) return;

        ClaimedJobDto job = claimOpt.get();
        log.info("[image] 已领取 jobId={} type={} token={}", job.id(), job.type(), job.fencingToken());

        // cancelRequested → 取消（generation-worker.ts:237-241）
        if (job.cancelRequested()) {
            log.info("[image] 取消已执行(cancelRequested) jobId={}", job.id());
            stateMachine.failJob(job.id(), GenerationError.ERROR_PROVIDER_FAILED,
                    "任务已取消", null, workerId, job.fencingToken());
            return;
        }

        // 处理并捕获异常（generation-worker.ts:686-728）
        String errorCode = null;
        String errorMsg = null;
        try {
            processClaimedImageJob(job);
            return; // 成功完成
        } catch (Exception e) {
            if (e instanceof ImageProviderError ipe) {
                errorCode = ipe.getCode();
                errorMsg = ipe.getMessage();
            } else {
                errorCode = GenerationError.ERROR_PROVIDER_FAILED;
                errorMsg = e.getMessage() != null ? e.getMessage() : "unknown";
            }
        }

        // 瞬态重试（generation-worker.ts:705-725）
        if (isTransientImageError(errorCode) && job.retry_count() < MAX_IMAGE_RETRIES) {
            long backoffMs = imageRetryBackoffMs(job.retry_count());
            java.time.LocalDateTime nextActionAt = java.time.LocalDateTime.now(java.time.ZoneOffset.UTC)
                    .plusNanos(backoffMs * 1_000_000L);
            boolean requeued = stateMachine.requeueImageJobForRetry(job.id(), nextActionAt);
            if (requeued) {
                log.info("[image] 瞬时重试已排队 jobId={} attempt={}/{} nextFireAt={} code={}",
                        job.id(), job.retry_count() + 1, MAX_IMAGE_RETRIES, nextActionAt, errorCode);
                stateMachine.appendLog(job.id(), "retry_scheduled", "queued",
                        "瞬时失败第 " + (job.retry_count() + 1) + "/" + MAX_IMAGE_RETRIES
                                + " 次重试已排队: " + errorCode + ": " + errorMsg,
                        null);
                // return WITHOUT ack-fail（generation-worker.ts:723-724）
                return;
            }
        }

        // 终态失败（generation-worker.ts:726）
        log.error("[image] 终态失败 jobId={} code={}: {}", job.id(), errorCode, errorMsg);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", errorMsg);
        stateMachine.failJob(job.id(), errorCode, errorMsg, details,
                workerId, job.fencingToken());
    }

    /**
     * 处理已领取的图片作业（generation-worker.ts:499-685）。
     */
    private void processClaimedImageJob(ClaimedJobDto job) {
        Map<String, Object> input = job.input();
        String prompt = strOrEmpty(input, "prompt");
        String modelId = strOrEmpty(input, "model_id");

        // 1. 校验输入（generation-worker.ts:295-305）
        // IKDLQF：图片允许空 prompt 仅凭附件驱动——Java 侧简化：空 prompt 且无 model_id → fail
        if (prompt.isEmpty() || modelId.isEmpty()) {
            failClaimed(job, GenerationError.ERROR_INVALID_INPUT, "缺少 prompt 或 model_id");
            return;
        }

        // 2. 图片参考图字段 = input_asset_ids（IKA72G :309-310）
        List<String> referenceIds = extractStringList(input, "input_asset_ids");

        // 3. 查能力行（generation-worker.ts:330-346）
        String sizeId = input.get("size") instanceof String s ? s : null;
        GenerationModelCapabilityEntity cap = capabilityMapper.findByModelId(modelId);
        if (cap == null) {
            failClaimed(job, GenerationError.ERROR_MODEL_UNAVAILABLE,
                    "未开通或不受支持的模型: " + modelId);
            return;
        }

        // 匹配 supported_sizes（asset-ops.ts:111-126）
        String providerSize = cap.getApiSize();
        Integer capWidth = cap.getWidth();
        Integer capHeight = cap.getHeight();
        if (sizeId != null) {
            String[] matched = ImageChannelMapper.matchSupportedSize(
                    cap.getSupportedSizes(), sizeId);
            if (matched != null) {
                if (matched[0] != null) providerSize = matched[0];
                if (matched[1] != null) capWidth = Integer.parseInt(matched[1]);
                if (matched[2] != null) capHeight = Integer.parseInt(matched[2]);
            }
        }

        // 参考图上限（asset-ops.ts:131-139）
        int maxReferenceCount = ImageChannelMapper.parseMaxReferenceImages(cap.getFeatures());
        if (referenceIds.size() > maxReferenceCount) {
            failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE,
                    "当前模型最多支持 " + maxReferenceCount + " 张参考图");
            return;
        }

        // 4. 解析参考素材（generation-worker.ts:354-364）
        Map<String, AssetEntity> sourceAssetsMap = referenceIds.isEmpty()
                ? Map.of()
                : assetSource.resolveInputAssets(referenceIds, job.user_id(), job.project_id());
        // 校验完整性和类型（generation-worker.ts:358-364）
        if (sourceAssetsMap.size() != referenceIds.size()) {
            failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE,
                    "参考素材不存在或无权访问");
            return;
        }
        List<AssetEntity> sourceAssets = referenceIds.stream()
                .map(sourceAssetsMap::get)
                .toList();
        for (AssetEntity asset : sourceAssets) {
            if (!"image".equals(asset.getType())) {
                failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE,
                        "参考素材不存在或无权访问");
                return;
            }
        }

        // 5. 解封凭证（generation-worker.ts:500-507）
        Object sealedObj = input.get("provider_credential");
        if (!(sealedObj instanceof String sealedCredential) || sealedCredential.isEmpty()) {
            failClaimed(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "图片任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(sealedCredential);
        } catch (Exception e) {
            log.debug("[image] 凭证解密失败 jobId={}: {}", job.id(), e.getMessage(), e);
            failClaimed(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "图片任务凭证解密失败");
            return;
        }

        // 6. 渠道映射（generation-worker.ts:521-553）
        String aspectRatio = input.get("aspect_ratio") instanceof String s ? s : null;
        String channelParser = (cap.getChannelParser() != null && !cap.getChannelParser().isEmpty())
                ? cap.getChannelParser() : "seedream";

        String finalSize = providerSize;
        String finalQuality = null;

        if ("gpt".equals(channelParser) || "banana".equals(channelParser)) {
            ImageChannelMapper.ImageRequestMapping mapping =
                    ImageChannelMapper.parseStoredMapping(
                            channelParser, cap.getRequestMapping(),
                            cap.getDefaultSize(), cap.getDefaultAspectRatio());
            ImageChannelMapper.MappedRequest mapped =
                    ImageChannelMapper.mapImageChannelRequest(mapping, sizeId, aspectRatio);
            if (!mapped.ok()) {
                failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE_TYPE,
                        "模型、分辨率与宽高比组合不受支持");
                return;
            }
            finalSize = mapped.size();
            finalQuality = mapped.quality();
        } else if (providerSize != null && aspectRatio != null
                && ImageChannelMapper.hasSeedreamSizeTable(cap.getModelId())) {
            String resolved = ImageChannelMapper.resolveSeedreamImageSize(
                    cap.getModelId(), providerSize, aspectRatio);
            if (resolved == null) {
                failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE_TYPE,
                        "模型、分辨率与宽高比组合不受支持");
                return;
            }
            finalSize = resolved;
        }

        // 7. 生成数量（generation-worker.ts:554）
        int n = Math.max(1, Math.min(4, job.expected_output_count()));

        // 8. 收集参考图 URL（generation-worker.ts:555-561）
        List<String> sourceImageUrls = new ArrayList<>();
        for (AssetEntity source : sourceAssets) {
            if (source.getUrl() == null || source.getUrl().isEmpty()) {
                throw new ImageProviderError(GenerationError.ERROR_UNSUPPORTED_INPUT,
                        "参考图片缺少地址");
            }
            sourceImageUrls.add(source.getUrl());
        }

        // 9. 调用 provider（generation-worker.ts:583-598 批量循环）
        // 契约 §11 / ADR-0085（IKESD6）：行配了别名且本 job 带参考图 → 出站 model 换图生图上游名。
        // 只换 HTTP body 的 model 字段；job.input.model_id 恒为 canonical（计费/重试/恢复不受影响）。
        String i2iAlias = ImageChannelMapper.parseI2iModelName(cap.getFeatures());
        String requestModel = (i2iAlias != null && !sourceImageUrls.isEmpty())
                ? i2iAlias : cap.getModelId();
        List<GeneratedImage> allImages = new ArrayList<>();
        int remaining = n;
        for (int attempt = 0; remaining > 0 && attempt < n; attempt++) {
            List<GeneratedImage> batch = imageClient.generate(
                    providerToken, requestModel, prompt, remaining,
                    finalSize, finalQuality,
                    input.get("web_search") instanceof Boolean b && b,
                    input.get("sequential_image_generation") instanceof Boolean b && b,
                    sourceImageUrls
            );
            allImages.addAll(batch);
            if (batch.isEmpty()) break;
            remaining = n - allImages.size();
        }
        log.info("[image] 上游已返回 jobId={} count={} expected={}", job.id(), allImages.size(), n);

        // 10. 无结果 → no_result（generation-worker.ts:599-601）
        if (allImages.isEmpty()) {
            failClaimed(job, GenerationError.ERROR_NO_RESULT, "生成服务未返回结果");
            return;
        }

        // 11. 部分成功日志（generation-worker.ts:605-612）
        if (allImages.size() != n) {
            stateMachine.appendLog(job.id(), "partial_output", "processing",
                    "生成服务返回 " + allImages.size() + " 张，期望 " + n + " 张，按部分成功处理",
                    null);
        }

        // 12. 逐张转存 + createAsset（generation-worker.ts:613-638）
        List<String> assetIds = new ArrayList<>();
        for (GeneratedImage img : allImages) {
            StoredImage stored = persistProviderImage(img.url(), job.user_id());
            log.info("[image] 转存完成 jobId={} storageKey={} size={} w={} h={}",
                    job.id(), stored.storageKey(), stored.size(), stored.width(), stored.height());
            // 宽度优先取 provider 返回值，回退 persistProviderImage 解析值
            Integer width = positiveDimension(img.width());
            if (width == null) width = stored.width();
            Integer height = positiveDimension(img.height());
            if (height == null) height = stored.height();

            String assetId = stateMachine.createAsset(new JobStateMachineService.CreateAssetInput(
                    job.user_id(),
                    job.project_id(),
                    job.id(),
                    "image",
                    stored.url(),
                    stored.storageKey(),
                    stored.mime(),
                    stored.size(),
                    width,
                    height,
                    null, // duration
                    workerId,
                    job.fencingToken()
            ));
            if (assetId == null) {
                log.warn("[image] 终态失败(createAsset 守卫未命中) jobId={}", job.id());
                return; // 守卫失败 → 退出（generation-worker.ts:637）
            }
            assetIds.add(assetId);
        }

        // 13. completeJob（generation-worker.ts:684 finishJob）
        // 修正一：不传 actualAmountFen（结算不在范围）
        boolean completed = stateMachine.completeJob(
                job.id(), assetIds, workerId, job.fencingToken());
        if (completed) {
            log.info("[image] 发布成功 jobId={} assetCount={}", job.id(), assetIds.size());
            stateMachine.appendLog(job.id(), "succeeded", "succeeded",
                    "产出 " + assetIds.size() + " 个素材",
                    Map.of("asset_ids", assetIds));
        } else {
            log.warn("[image] 终态失败(completeJob 守卫未命中) jobId={} assetCount={}", job.id(), assetIds.size());
        }
    }

    // ========== persistProviderMedia image 路径（:731-818） ==========

    /**
     * 图片转存（generation-worker.ts:731-818 persistProviderMedia image 路径）。
     * <p>
     * url → fetch 字节 → ImageIO 解析宽高 → TOS 上传。
     * TOS 未配置 → 降级直存 URL（storageKey=null，generation-worker.ts:752-761）。
     * <p>
     * 图像元数据等价标准（契约 §8）：仅消费 width/height，round(正有限数) 否则 null；
     * 解析失败静默、资产照常落库。Java ImageIO 不支持 webp → width/height null 回退，
     * 资产照常落库（等价标准满足 per §8，TS 也只消费 w/h 且容忍 null）。
     */
    private StoredImage persistProviderImage(String sourceUrl, String userId) {
        // 降级模式：TOS 未配置 → 直存 URL（generation-worker.ts:752-761）
        if (tosService == null) {
            return new StoredImage(sourceUrl, null, null, null, null, null);
        }

        // fetch 字节（generation-worker.ts:765-776）
        byte[] content;
        String mime;
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(sourceUrl))
                    .timeout(Duration.ofSeconds(30))
                    .GET()
                    .build();
            HttpResponse<byte[]> resp = fetchClient.send(req,
                    HttpResponse.BodyHandlers.ofByteArray());
            if (resp.statusCode() >= 400) {
                String errBody = new String(resp.body(), java.nio.charset.StandardCharsets.UTF_8);
                String truncated = errBody.length() > 300 ? errBody.substring(0, 300) + "…" : errBody;
                throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "生成结果下载失败: HTTP " + resp.statusCode() + " body=" + truncated);
            }
            content = resp.body();
            String contentType = resp.headers().firstValue("content-type").orElse(null);
            mime = contentType != null
                    ? contentType.split(";", 2)[0].trim()
                    : "image/png";
        } catch (ImageProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "生成结果下载失败: " + e.getMessage());
        }

        if (content.length == 0) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "生成结果为空");
        }

        // mime 校验（generation-worker.ts:779-781）
        if (!mime.startsWith("image/")) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "生成结果媒体类型不匹配");
        }

        // ImageIO 解析宽高（generation-worker.ts:785-794）
        // 契约 §8：解析失败静默 null，资产照常落库
        Integer width = null;
        Integer height = null;
        try {
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(content));
            if (img != null) {
                width = positiveDimension(img.getWidth());
                height = positiveDimension(img.getHeight());
            }
        } catch (Exception ignored) {
            // 静默：webp 等不支持格式 → null，资产照常落库（契约 §8 等价标准满足）
            log.debug("[image] ImageIO 解析宽高失败(非关键，降级 null) sourceUrl={}", sourceUrl);
        }

        // TOS 上传
        try {
            TosMediaStorage.UploadResult uploaded = tosService.uploadImageBytes(content, mime, userId);
            return new StoredImage(uploaded.url(), uploaded.storageKey(),
                    mime, (long) content.length, width, height);
        } catch (Exception e) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "生成结果转存失败: " + e.getMessage());
        }
    }

    // ========== 工具方法 ==========

    /** 瞬时失败判断（generation-worker.ts:80-82 isTransientImageError）。 */
    private static boolean isTransientImageError(String code) {
        return TRANSIENT_IMAGE_ERROR_CODES.contains(code);
    }

    /**
     * 指数退避（generation-worker.ts:84-87 imageRetryBackoffMs）。
     * 30s → 60s → 120s，封顶 300s（5min）。
     * 调用方负责计算 nextActionAt。
     */
    static long imageRetryBackoffMs(int retryCount) {
        return Math.min(30_000L * (1L << retryCount), 300_000L);
    }

    /** 正有限数 → round，否则 null（generation-worker.ts:820-824 positiveDimension）。 */
    static Integer positiveDimension(Integer value) {
        if (value == null) return null;
        if (value > 0) return value;
        return null;
    }

    private void failClaimed(ClaimedJobDto job, String code, String msg) {
        Map<String, Object> details = new HashMap<>();
        details.put("raw", msg);
        stateMachine.failJob(job.id(), code, msg, details, workerId, job.fencingToken());
    }

    private static String strOrEmpty(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return (v instanceof String s) ? s : "";
    }

    @SuppressWarnings("unchecked")
    private static List<String> extractStringList(Map<String, Object> map, String key) {
        Object v = map.get(key);
        if (!(v instanceof List<?> list)) return List.of();
        List<String> result = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof String s) result.add(s);
            else if (item instanceof Number n) result.add(n.toString());
        }
        return result;
    }

    private static String hostname() {
        try {
            return java.net.InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "unknown";
        }
    }

    /** 转存结果（对齐 TS persistProviderMedia 返回形状）。 */
    record StoredImage(
            String url, String storageKey, String mime,
            Long size, Integer width, Integer height
    ) {}
}
