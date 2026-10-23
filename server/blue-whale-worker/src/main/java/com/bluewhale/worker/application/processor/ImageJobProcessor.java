package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.GenerationModelCapabilityEntity;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageProviderError;
import com.bluewhale.worker.infrastructure.gateway.ImageProtocol;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient.GeneratedImage;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationModelCapabilityMapper;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Component
public class ImageJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(ImageJobProcessor.class);

    private static final Set<String> TRANSIENT_IMAGE_ERROR_CODES =
            Set.of(GenerationError.ERROR_PROVIDER_FAILED);

    private static final int MAX_IMAGE_RETRIES = 3;

    private final JobStateMachineService stateMachine;
    private final JobFinalizer finalizer;
    private final AssetSourceService assetSource;
    private final UpstreamCredential upstreamCredential;
    private final NewApiImageClient imageClient;
    private final GenerationModelCapabilityMapper capabilityMapper;
    private final TosMediaStorage tosService;
    private final String workerId;
    private final HttpClient fetchClient;

    public ImageJobProcessor(
            JobStateMachineService stateMachine,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiImageClient imageClient,
            GenerationModelCapabilityMapper capabilityMapper,
            TosMediaStorage tosService
    ) {
        this.stateMachine = stateMachine;
        this.finalizer = finalizer;
        this.assetSource = assetSource;
        this.upstreamCredential = upstreamCredential;
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
        return GenerationMqRouteEnum.IMAGE.tag();
    }

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

        if (job.cancelRequested()) {
            log.info("[image] 取消已执行(cancelJobBeforeDispatch) jobId={}", job.id());
            stateMachine.cancelJobBeforeDispatch(job.id(), workerId, job.fencingToken());
            return;
        }

        String errorCode = null;
        String errorMsg = null;
        try {
            processClaimedImageJob(job);
            return;
        } catch (Exception e) {
            if (e instanceof ImageProviderError ipe) {
                errorCode = ipe.getCode();
                errorMsg = ipe.getMessage();
            } else {
                errorCode = GenerationError.ERROR_PROVIDER_FAILED;
                errorMsg = e.getMessage() != null ? e.getMessage() : "unknown";
            }
        }

        if (isTransientImageError(errorCode) && job.retry_count() < MAX_IMAGE_RETRIES) {
            long backoffMs = imageRetryBackoffMs(job.retry_count());
            java.time.LocalDateTime nextActionAt = LocalDateTime.now()
                    .plusNanos(backoffMs * 1_000_000L);
            boolean requeued = stateMachine.requeueImageJobForRetry(job.id(), nextActionAt);
            if (requeued) {
                log.info("[image] 瞬时重试已排队 jobId={} attempt={}/{} nextFireAt={} code={}",
                        job.id(), job.retry_count() + 1, MAX_IMAGE_RETRIES, nextActionAt, errorCode);
                stateMachine.appendLog(job.id(), "retry_scheduled", "queued",
                        "瞬时失败第 " + (job.retry_count() + 1) + "/" + MAX_IMAGE_RETRIES
                                + " 次重试已排队: " + errorCode + ": " + errorMsg,
                        null);
                return;
            }
        }

        log.error("[image] 终态失败 jobId={} code={}: {}", job.id(), errorCode, errorMsg);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", errorMsg);
        finalizer.failJob(job.id(), errorCode, errorMsg, details,
                workerId, job.fencingToken());
    }

    private void processClaimedImageJob(ClaimedJobDto job) {
        Map<String, Object> input = job.input();
        Map<?, ?> planSnapshot = input.get("prompt_plan_snapshot") instanceof Map<?, ?> snapshot ? snapshot : null;
        if (input.containsKey("prompt_plan_snapshot")
                && (planSnapshot == null || !(planSnapshot.get("images") instanceof List<?>))) {
            failClaimed(job, GenerationError.ERROR_INVALID_INPUT, "方案输入快照无效");
            return;
        }
        String prompt = strOrEmpty(input, "prompt");
        String modelId = strOrEmpty(input, "model_id");

        if (prompt.isEmpty() || modelId.isEmpty()) {
            failClaimed(job, GenerationError.ERROR_INVALID_INPUT, "缺少 prompt 或 model_id");
            return;
        }

        List<String> referenceIds = extractStringList(input, "input_asset_ids");

        String sizeId = input.get("size") instanceof String s ? s : null;
        GenerationModelCapabilityEntity cap = capabilityMapper.findByModelId(modelId);
        if (cap == null) {
            failClaimed(job, GenerationError.ERROR_MODEL_UNAVAILABLE,
                    "未开通或不受支持的模型: " + modelId);
            return;
        }

        String providerSize = cap.getApiSize();
        if (sizeId != null) {
            String matched = ImageChannelParser.matchSupportedSize(
                    cap.getSupportedSizes(), sizeId);
            if (matched != null) providerSize = matched;
        }

        int maxReferenceCount = ImageChannelParser.parseMaxReferenceImages(cap.getFeatures());
        if (referenceIds.size() > maxReferenceCount) {
            failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE,
                    "当前模型最多支持 " + maxReferenceCount + " 张参考图");
            return;
        }

        Map<String, AssetEntity> sourceAssetsMap;
        if (planSnapshot != null) {
            List<?> images = (List<?>) planSnapshot.get("images");
            sourceAssetsMap = new HashMap<>();
            if (images.size() != referenceIds.size()) {
                failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE, "方案素材快照与输入不一致");
                return;
            }
            for (int i = 0; i < images.size(); i++) {
                if (!(images.get(i) instanceof Map<?, ?> image)
                        || !referenceIds.get(i).equals(image.get("assetId"))
                        || !(image.get("url") instanceof String url)
                        || !(url.startsWith("https://") || url.startsWith("http://"))) {
                    failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE, "方案素材快照与输入不一致");
                    return;
                }
                AssetEntity asset = new AssetEntity();
                asset.setType("image");
                asset.setUrl(url);
                sourceAssetsMap.put(referenceIds.get(i), asset);
            }
        } else {
            sourceAssetsMap = referenceIds.isEmpty() ? Map.of()
                    : assetSource.resolveInputAssets(referenceIds, job.user_id(), job.project_id());
        }
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

        String providerToken;
        try {
            providerToken = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[image] 生成服务凭证未配置 jobId={}: {}", job.id(), e.getMessage());
            failClaimed(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "生成服务凭证未配置");
            return;
        }

        String aspectRatio = input.get("aspect_ratio") instanceof String s ? s : null;
        ImageChannel channel = ImageChannelParser.parseChannel(cap.getChannel(), cap.getCapabilityType());
        String parser = channel.parser() != null ? channel.parser() : "seedream";

        String finalSize = providerSize;
        String finalQuality = null;

        if ("gpt".equals(parser) || "banana".equals(parser)) {
            ImageChannelParser.ImageRequestMapping mapping =
                    ImageChannelParser.parseStoredMapping(
                            channel, cap.getRequestMapping(),
                            cap.getDefaultSize(), cap.getDefaultAspectRatio());
            ImageChannelParser.MappedRequest mapped =
                    ImageChannelParser.mapImageChannelRequest(mapping, sizeId, aspectRatio);
            if (!mapped.ok()) {
                failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE_TYPE,
                        "模型、分辨率与宽高比组合不受支持");
                return;
            }
            finalSize = mapped.size();
            finalQuality = mapped.quality();
        } else if (providerSize != null && aspectRatio != null
                && ImageChannelParser.hasSizeMatrix(cap.getRequestMapping())) {
            String resolved = ImageChannelParser.resolveSeedreamSize(
                    cap.getRequestMapping(), providerSize, aspectRatio);
            if (resolved == null) {
                failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE_TYPE,
                        "模型、分辨率与宽高比组合不受支持");
                return;
            }
            finalSize = resolved;
        }

        Object countRaw = job.input().get("expected_output_count");
        int requested = 1;
        if (countRaw instanceof Number num) {
            requested = num.intValue();
        } else if (countRaw instanceof String s && !s.isBlank()) {
            try {
                requested = Integer.parseInt(s.trim());
            } catch (NumberFormatException ignored) {
                requested = 1;
            }
        }
        int n = Math.max(1, Math.min(4, requested));

        List<String> sourceImageUrls = new ArrayList<>();
        for (AssetEntity source : sourceAssets) {
            if (source.getUrl() == null || source.getUrl().isEmpty()) {
                throw new ImageProviderError(GenerationError.ERROR_UNSUPPORTED_INPUT,
                        "参考图片缺少地址");
            }
            sourceImageUrls.add(source.getUrl());
        }

        ImageProtocol protocol = channel.protocol() != null
                ? channel.protocol() : ImageProtocol.INLINE_IMAGE;
        String i2iAlias = ImageChannelParser.parseI2iModelName(cap.getFeatures());
        String requestModel = (protocol == ImageProtocol.INLINE_IMAGE
                && i2iAlias != null && !sourceImageUrls.isEmpty())
                ? i2iAlias : cap.getModelId();
        List<GeneratedImage> allImages = new ArrayList<>();
        int remaining = n;
        for (int attempt = 0; remaining > 0 && attempt < n; attempt++) {
            List<GeneratedImage> batch = imageClient.generate(
                    providerToken, protocol, requestModel, prompt, remaining,
                    finalSize, finalQuality,
                    input.get("web_search") instanceof Boolean b && b,
                    input.get("sequential_image_generation") instanceof Boolean b && b,
                    sourceImageUrls,
                    channel == ImageChannel.SEEDREAM_IMAGE
            );
            allImages.addAll(batch);
            if (batch.isEmpty()) break;
            remaining = n - allImages.size();
        }
        log.info("[image] 上游已返回 jobId={} count={} expected={}", job.id(), allImages.size(), n);

        if (allImages.isEmpty()) {
            failClaimed(job, GenerationError.ERROR_NO_RESULT, "生成服务未返回结果");
            return;
        }

        if (allImages.size() != n) {
            stateMachine.appendLog(job.id(), "partial_output", "processing",
                    "生成服务返回 " + allImages.size() + " 张，期望 " + n + " 张，按部分成功处理",
                    null);
        }

        List<String> assetIds = new ArrayList<>();
        for (GeneratedImage img : allImages) {
            StoredImage stored = persistProviderImage(img, job.user_id());
            log.info("[image] 转存完成 jobId={} storageKey={} size={} w={} h={}",
                    job.id(), stored.storageKey(), stored.size(), stored.width(), stored.height());
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
                    stored.md5(),
                    width,
                    height,
                    null,
                    workerId,
                    job.fencingToken()
            ));
            if (assetId == null) {
                log.warn("[image] 终态失败(createAsset 守卫未命中) jobId={}", job.id());
                return;
            }
            assetIds.add(assetId);
        }

        boolean completed = finalizer.completeJob(
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


    private StoredImage persistProviderImage(GeneratedImage image, String userId) {
        if (image.content() != null) {
            if (tosService == null) {
                throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "图片转存存储未配置");
            }
            return uploadImageContent(image.content(), image.mime(), userId, "<b64_json>");
        }
        return persistProviderImageFromUrl(image.url(), userId);
    }

    private StoredImage persistProviderImageFromUrl(String sourceUrl, String userId) {
        if (tosService == null) {
            log.warn("[image] TOS 未配置，降级直存供应商 URL：assets.md5 将为空（IKGS73 已知边界）");
            return new StoredImage(sourceUrl, null, null, null, null, null, null);
        }

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

        if (!mime.startsWith("image/")) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "生成结果媒体类型不匹配");
        }

        return uploadImageContent(content, mime, userId, sourceUrl);
    }

    private StoredImage uploadImageContent(byte[] content, String mime, String userId, String source) {
        Integer width = null;
        Integer height = null;
        try {
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(content));
            if (img != null) {
                width = positiveDimension(img.getWidth());
                height = positiveDimension(img.getHeight());
            }
        } catch (Exception ignored) {
            log.debug("[image] ImageIO 解析宽高失败(非关键，降级 null) source={}", source);
        }

        try {
            TosMediaStorage.UploadResult uploaded = tosService.uploadImageBytes(content, mime, userId);
            return new StoredImage(uploaded.url(), uploaded.storageKey(),
                    mime, (long) content.length, uploaded.md5(), width, height);
        } catch (Exception e) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "生成结果转存失败: " + e.getMessage());
        }
    }


    private static boolean isTransientImageError(String code) {
        return TRANSIENT_IMAGE_ERROR_CODES.contains(code);
    }

    static long imageRetryBackoffMs(int retryCount) {
        return Math.min(30_000L * (1L << retryCount), 300_000L);
    }

    static Integer positiveDimension(Integer value) {
        if (value == null) return null;
        if (value > 0) return value;
        return null;
    }

    private void failClaimed(ClaimedJobDto job, String code, String msg) {
        Map<String, Object> details = new HashMap<>();
        details.put("raw", msg);
        finalizer.failJob(job.id(), code, msg, details, workerId, job.fencingToken());
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

    record StoredImage(
            String url, String storageKey, String mime,
            Long size, String md5, Integer width, Integer height
    ) {}
}
