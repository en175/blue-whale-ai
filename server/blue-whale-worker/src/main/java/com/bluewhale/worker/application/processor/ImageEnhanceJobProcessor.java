package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishImageEnhanceDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.ImageEnhanceContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageEnhanceError;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitClient;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Component
public class ImageEnhanceJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(ImageEnhanceJobProcessor.class);

    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(ImageEnhanceContract.SOURCE);

    private final JobClaimService claimService;
    private final JobFinalizer finalizer;
    private final ClaimSpec claimSpec;
    private final AssetSourceService assetSource;
    private final UpstreamCredential upstreamCredential;
    private final NewApiMediaKitClient mediaKitClient;
    private final TosMediaStorage tosService;
    private final String workerId;
    private final HttpClient fetchClient;

    public ImageEnhanceJobProcessor(
            JobClaimService claimService,
            GenerationJobMapper jobMapper,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiMediaKitClient mediaKitClient,
            TosMediaStorage tosService
    ) {
        this.claimService = claimService;
        this.finalizer = finalizer;
        this.claimSpec = ClaimSpec.bySources(
                ImageEnhanceContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.assetSource = assetSource;
        this.upstreamCredential = upstreamCredential;
        this.mediaKitClient = mediaKitClient;
        this.tosService = tosService;
        this.workerId = "enhance-" + hostname() + "-" + ProcessHandle.current().pid();
        this.fetchClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    @Override
    public String tag() {
        return ImageEnhanceContract.TAG;
    }

    @Override
    public Optional<ClaimSpec> claimSpec() {
        return Optional.of(claimSpec);
    }

    @Override
    public void handle(String jobId) {
        Optional<ClaimedJob> claimOpt;
        try {
            claimOpt = claimService.claim(claimSpec, jobId, workerId);
        } catch (Exception error) {
            log.error("[image_enhance] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error;
        }
        if (claimOpt.isEmpty()) return;

        ClaimedJob claim = claimOpt.get();
        log.info("[image_enhance] 已领取 jobId={} token={}", claim.id(), claim.fencingToken());

        try {
            processClaimedJob(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            String message = e.getMessage() != null ? e.getMessage() : "高清放大失败";
            log.error("[image_enhance] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message);
        }
    }

    private void processClaimedJob(ClaimedJob claim) {
        Map<String, Object> input = claim.input();

        String sourceAssetId = parseSourceAssetId(input);
        if (sourceAssetId == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源素材 id");
            return;
        }
        Object tierObj = input.get(ImageEnhanceContract.INPUT_KEY_VERSION_TIER);
        if (!(tierObj instanceof String versionTier)
                || !ImageEnhanceContract.TIER_TO_TOOL_VERSION.containsKey(versionTier)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "版本档非法");
            return;
        }
        Object multipleObj = input.get(ImageEnhanceContract.INPUT_KEY_MULTIPLE);
        if (!(multipleObj instanceof Number multipleNumber)
                || !ImageEnhanceContract.MULTIPLES.contains(multipleNumber.intValue())) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "放大倍数非法");
            return;
        }
        int multiple = multipleNumber.intValue();
        Object modeObj = input.get(ImageEnhanceContract.INPUT_KEY_GENERATIVE_ENHANCE_MODE);
        if (!(modeObj instanceof String generativeMode)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "增强策略非法");
            return;
        }
        Object colorObj = input.get(ImageEnhanceContract.INPUT_KEY_ENABLE_CORRECT_COLOR);
        if (!(colorObj instanceof Boolean enableCorrectColor)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "色彩校正开关非法");
            return;
        }

        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"image".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED, "源图片素材不可用");
            return;
        }

        String providerToken;
        try {
            providerToken = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[image_enhance] 生成服务凭证未配置 jobId={}: {}", claim.id(), e.getMessage());
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "生成服务凭证未配置");
            return;
        }

        String toolVersion = ImageEnhanceContract.TIER_TO_TOOL_VERSION.get(versionTier);
        String outboundMode = ImageEnhanceContract.TIERS_WITH_ENHANCE_MODE.contains(versionTier)
                ? generativeMode : null;
        Boolean outboundCorrectColor = ImageEnhanceContract.TIERS_WITH_CORRECT_COLOR.contains(versionTier)
                ? enableCorrectColor : null;

        NewApiMediaKitClient.EnhanceResult result = mediaKitClient.enhance(
                providerToken, source.getUrl(), toolVersion, multiple,
                outboundMode, outboundCorrectColor);
        log.info("[image_enhance] 上游已返回 jobId={} toolVersion={} multiple={}",
                claim.id(), toolVersion, multiple);

        byte[] content = fetchResultImage(result.imageUrl());

        if (tosService == null) {
            throw new ImageEnhanceError(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED,
                    "高清放大转存存储未配置");
        }
        String mime = NewApiImageClient.sniffImageMime(content, null);
        Integer width = null;
        Integer height = null;
        try {
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(content));
            if (img != null) {
                width = ImageJobProcessor.positiveDimension(img.getWidth());
                height = ImageJobProcessor.positiveDimension(img.getHeight());
            }
        } catch (Exception ignored) {
            log.debug("[image_enhance] ImageIO 解析宽高失败(非关键，降级 null)");
        }
        TosMediaStorage.UploadResult stored = tosService.uploadImageBytes(content, mime, claim.userId());
        log.info("[image_enhance] 转存完成 jobId={} storageKey={} size={} w={} h={}",
                claim.id(), stored.storageKey(), stored.size(), width, height);

        boolean published = finalizer.publishImageEnhanceResult(new PublishImageEnhanceDto(
                claim.id(),
                claim.projectId(),
                claim.userId(),
                claim.workerId(),
                claim.fencingToken(),
                stored.url(),
                stored.storageKey(),
                stored.mime(),
                stored.size(),
                stored.md5(),
                width,
                height));
        if (!published) {
            log.warn("[image_enhance] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）", claim.id());
        } else {
            log.info("[image_enhance] 发布成功 jobId={}", claim.id());
        }
    }


    private byte[] fetchResultImage(String sourceUrl) {
        byte[] content;
        String contentType;
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(sourceUrl))
                    .timeout(Duration.ofSeconds(30))
                    .GET()
                    .build();
            HttpResponse<byte[]> resp = fetchClient.send(req,
                    HttpResponse.BodyHandlers.ofByteArray());
            if (resp.statusCode() >= 400) {
                throw new ImageEnhanceError(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED,
                        "结果图下载失败: HTTP " + resp.statusCode());
            }
            content = resp.body();
            contentType = resp.headers().firstValue("content-type").orElse(null);
        } catch (ImageEnhanceError e) {
            throw e;
        } catch (Exception e) {
            throw new ImageEnhanceError(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED,
                    "结果图下载失败: " + e.getMessage());
        }

        if (content == null || content.length == 0) {
            throw new ImageEnhanceError(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED,
                    "结果图为空");
        }
        if (contentType != null && !contentType.split(";", 2)[0].trim().startsWith("image/")) {
            throw new ImageEnhanceError(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED,
                    "结果图媒体类型不匹配");
        }
        return content;
    }


    private static String parseSourceAssetId(Map<String, Object> input) {
        Object obj = input.get(ImageEnhanceContract.INPUT_KEY_SOURCE_ASSET_ID);
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    private static String resolveFailCode(Exception e) {
        if (e instanceof ImageEnhanceError iee && PRESERVED_ERROR_CODES.contains(iee.getCode())) {
            return iee.getCode();
        }
        return ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED;
    }

    private void failClaimed(ClaimedJob claim, String code, String msg) {
        Map<String, Object> details = new HashMap<>();
        details.put("raw", msg);
        finalizer.failJob(claim.id(), code, msg, details,
                claim.workerId(), claim.fencingToken());
    }

    private static String hostname() {
        try {
            return java.net.InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "unknown";
        }
    }
}
