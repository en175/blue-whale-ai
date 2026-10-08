package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishImageEnhanceDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.ImageEnhanceContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageEnhanceError;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitClient;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
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

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 image_enhance_failed。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 领取规格（IKIWP8 / ADR-0119）：候选 = type + 单源白名单；租约 420s（> MediaKit 读超时 + 转存余量）。 */
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

    /**
     * 本家族的领取规格：供「一个处理器 ↔ 一份规格」一致性断言枚举（IKIWP8 / ADR-0119）。
     */
    @Override
    public Optional<ClaimSpec> claimSpec() {
        return Optional.of(claimSpec);
    }

    /**
     * 处理一个 image_enhance job。
     * <p>
     * claim 在 try 外（IKC9EJ 同构：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试，§14.5）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedJob> claimOpt;
        try {
            claimOpt = claimService.claim(claimSpec, jobId, workerId);
        } catch (Exception error) {
            log.error("[image_enhance] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

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

        // 1. 解析冻结 input 六键（§14.2：六键恒在、值恒为合法枚举；此处为 worker 兜底防御）
        //    target_node_id 是前端回填定位键，worker 不消费，不解析。
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

        // 2. 解析源素材：Asset url 落库即公网 public-read，直接作 image_url（§14.5）
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

        // 4. 版本档映射 + 能力矩阵裁剪（§14.3：不支持的键出站不发）
        String toolVersion = ImageEnhanceContract.TIER_TO_TOOL_VERSION.get(versionTier);
        String outboundMode = ImageEnhanceContract.TIERS_WITH_ENHANCE_MODE.contains(versionTier)
                ? generativeMode : null;
        Boolean outboundCorrectColor = ImageEnhanceContract.TIERS_WITH_CORRECT_COLOR.contains(versionTier)
                ? enableCorrectColor : null;

        // 5. 经网关调 MediaKit 同步 enhance（几秒返回结果图 URL，24h 有效）
        NewApiMediaKitClient.EnhanceResult result = mediaKitClient.enhance(
                providerToken, source.getUrl(), toolVersion, multiple,
                outboundMode, outboundCorrectColor);
        log.info("[image_enhance] 上游已返回 jobId={} toolVersion={} multiple={}",
                claim.id(), toolVersion, multiple);

        // 6. 立即下载结果图（24h 有效，响应后马上转存；与图片任务 persistProviderMedia 同构）
        byte[] content = fetchResultImage(result.imageUrl());

        // 7. TOS 公开读转存（image_enhance 强依赖 TOS——URL 24h 失效，不允许降级直存）
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
            // 契约 §8：解析失败静默 null，资产照常落库（webp 等不支持格式）
            log.debug("[image_enhance] ImageIO 解析宽高失败(非关键，降级 null)");
        }
        TosMediaStorage.UploadResult stored = tosService.uploadImageBytes(content, mime, claim.userId());
        log.info("[image_enhance] 转存完成 jobId={} storageKey={} size={} w={} h={}",
                claim.id(), stored.storageKey(), stored.size(), width, height);

        // 8. 终态收口：建 Asset（type=image / source=generated / generation_job_id）→ succeeded
        //    （免费工具无结算联动，同 extract 的 publishMediaExtractResult 形态，§14.5）
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

    // ========== 结果图下载（generation-worker.ts:765-801 image 路径同构） ==========

    /**
     * 下载火山结果图字节（URL 仅 24h 有效，必须立即转存）。
     * 失败归 image_enhance_failed（无自动重试，用户手动重试会重新调网关）。
     */
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

    // ========== 工具方法 ==========

    /** source_asset_id 容忍数字形态（Jackson 数字 JSON 值），与 mediaExtract 解析同构。 */
    private static String parseSourceAssetId(Map<String, Object> input) {
        Object obj = input.get(ImageEnhanceContract.INPUT_KEY_SOURCE_ASSET_ID);
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    /**
     * 失败码归一（§14.5）：§5 分类信号（额度/内容政策）保留既有码，
     * 其余（超时 / 供应商失败 / 系统异常）一律归并兜底 image_enhance_failed。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof ImageEnhanceError iee && PRESERVED_ERROR_CODES.contains(iee.getCode())) {
            return iee.getCode();
        }
        return ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED;
    }

    /** 失败处理：与图片任务同构走通用 failJob（details.raw 透传原始原因）。 */
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
