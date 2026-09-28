package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishImageOutpaintDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.ImageOutpaintContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageOutpaintError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitOutpaintClient;
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

/**
 * image_outpaint（智能扩图）作业处理器（IKGOQW，以 ImageEnhanceJobProcessor 为模板）。
 * <p>
 * 编排流程：claim → 解析冻结 input（source_asset_id + 四个 expand 比例）→
 * 解析源素材（公网 url 即 image_url）→ 取任务冻结的用户 sk- →
 * 经网关调 MediaKit 同步 expand-image-canvas → 立即下载结果图（火山 URL 仅 24h 有效）→
 * TOS 公开读转存 → 建 Asset（type=image, source=generated）→ 终态 succeeded 收口。
 * 前端经 GET /api/jobs/:id 拿 Asset 按 input.target_node_id 回填扩图结果卡
 * （源卡不动；worker 不消费画布拓扑）。
 * <p>
 * 错误码口径（无 worker 级自动重试，用户在结果卡手动重试并沿用冻结 input）：
 * <ul>
 *   <li>invalid_input：source_asset_id 缺失 / 四个 expand 比例缺失或超 [0, 0.4] 值域
 *       （创建入口复核是权威，worker 兜底防御）</li>
 *   <li>provider_credential_missing：任务缺少冻结凭证（与 image/audio 同构）</li>
 *   <li>content_rejected / content_rejected_reference / quota_exhausted：
 *       NewApiErrorClassifier §5 分类信号，保留既有码投影</li>
 *   <li>image_outpaint_failed：其余一律归并兜底（调用失败 / 超时 / 供应商错误
 *       （网关 success=false 返 400 且不扣费）/ 源素材不可用 / 结果下载转存失败），
 *       上游可读原因随 message 透传</li>
 * </ul>
 * <p>
 * 进度投影与图片任务同构：终态事件（status_changed，成功 progress=100 / 失败 error 投影），
 * 同步接口秒级返回无中间进度带。
 */
@Component
public class ImageOutpaintJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(ImageOutpaintJobProcessor.class);

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 image_outpaint_failed。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 领取规格（IKIWP8 / ADR-0119）。 */
    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(ImageOutpaintContract.SOURCE);

    private final JobStateMachineService stateMachine;
    private final JobClaimService claimService;
    private final JobFinalizer finalizer;
    private final ClaimSpec claimSpec;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiMediaKitOutpaintClient mediaKitClient;
    private final TosMediaStorage tosService;
    private final String workerId;
    private final HttpClient fetchClient;

    public ImageOutpaintJobProcessor(
            JobStateMachineService stateMachine,
            JobClaimService claimService,
            GenerationJobMapper jobMapper,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiMediaKitOutpaintClient mediaKitClient,
            TosMediaStorage tosService
    ) {
        this.stateMachine = stateMachine;
        this.claimService = claimService;
        this.finalizer = finalizer;
        this.claimSpec = ClaimSpec.bySources(
                ImageOutpaintContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.mediaKitClient = mediaKitClient;
        this.tosService = tosService;
        this.workerId = "outpaint-" + hostname() + "-" + ProcessHandle.current().pid();
        this.fetchClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    @Override
    public String tag() {
        return ImageOutpaintContract.TAG;
    }

    /**
     * 本家族的领取规格：供「一个处理器 ↔ 一份规格」一致性断言枚举（IKIWP8 / ADR-0119）。
     */
    @Override
    public Optional<ClaimSpec> claimSpec() {
        return Optional.of(claimSpec);
    }

    /**
     * 处理一个 image_outpaint job。
     * <p>
     * claim 在 try 外（IKC9EJ 同构：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedJob> claimOpt;
        try {
            claimOpt = claimService.claim(claimSpec, jobId, workerId);
        } catch (Exception error) {
            log.error("[image_outpaint] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedJob claim = claimOpt.get();
        log.info("[image_outpaint] 已领取 jobId={} token={}", claim.id(), claim.fencingToken());

        try {
            processClaimedJob(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            String message = e.getMessage() != null ? e.getMessage() : "智能扩图失败";
            log.error("[image_outpaint] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message);
        }
    }

    private void processClaimedJob(ClaimedJob claim) {
        Map<String, Object> input = claim.input();

        // 1. 解析冻结 input（六键之上加 provider_credential；创建入口复核是权威，此处为 worker 兜底防御）
        //    target_node_id 是前端回填定位键，worker 不消费，不解析。
        String sourceAssetId = parseSourceAssetId(input);
        if (sourceAssetId == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源素材 id");
            return;
        }
        double expandTop = parseExpandRatio(input, ImageOutpaintContract.INPUT_KEY_EXPAND_TOP);
        double expandBottom = parseExpandRatio(input, ImageOutpaintContract.INPUT_KEY_EXPAND_BOTTOM);
        double expandLeft = parseExpandRatio(input, ImageOutpaintContract.INPUT_KEY_EXPAND_LEFT);
        double expandRight = parseExpandRatio(input, ImageOutpaintContract.INPUT_KEY_EXPAND_RIGHT);
        if (Double.isNaN(expandTop) || Double.isNaN(expandBottom)
                || Double.isNaN(expandLeft) || Double.isNaN(expandRight)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "扩展比例非法");
            return;
        }

        // 2. 解析源素材：Asset url 落库即公网 public-read，直接作 image_url
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"image".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED, "源图片素材不可用");
            return;
        }

        // 3. 取任务冻结的用户 sk-（与图片生成同构，明文直通）
        Object credentialObj = input.get(ImageOutpaintContract.INPUT_KEY_PROVIDER_CREDENTIAL);
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "智能扩图任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[image_outpaint] 凭证无效 jobId={}: {}", claim.id(), e.getMessage(), e);
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "智能扩图任务凭证无效");
            return;
        }

        // 4. 经网关调 MediaKit 同步 expand-image-canvas（秒级返回结果图 URL，24h 有效）；
        //    四个比例出站原样透传（产品总是显式传值，不依赖火山官方默认 0.1；queue_id 不传）
        NewApiMediaKitOutpaintClient.OutpaintResult result = mediaKitClient.expandImageCanvas(
                providerToken, source.getUrl(), expandTop, expandBottom, expandLeft, expandRight);
        log.info("[image_outpaint] 上游已返回 jobId={} t={} b={} l={} r={}",
                claim.id(), expandTop, expandBottom, expandLeft, expandRight);

        // 5. 立即下载结果图（24h 有效，响应后马上转存；与图片任务 persistProviderMedia 同构）
        byte[] content = fetchResultImage(result.imageUrl());

        // 6. TOS 公开读转存（image_outpaint 强依赖 TOS——URL 24h 失效，不允许降级直存）
        if (tosService == null) {
            throw new ImageOutpaintError(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED,
                    "智能扩图转存存储未配置");
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
            log.debug("[image_outpaint] ImageIO 解析宽高失败(非关键，降级 null)");
        }
        TosMediaStorage.UploadResult stored = tosService.uploadImageBytes(content, mime, claim.userId());
        log.info("[image_outpaint] 转存完成 jobId={} storageKey={} size={} w={} h={}",
                claim.id(), stored.storageKey(), stored.size(), width, height);

        // 7. 终态收口：建 Asset（type=image / source=generated / generation_job_id）→ succeeded
        //    （免费工具无结算联动，同 extract / enhance 的发布形态）
        boolean published = finalizer.publishImageOutpaintResult(new PublishImageOutpaintDto(
                claim.id(),
                claim.projectId(),
                claim.userId(),
                claim.workerId(),
                claim.fencingToken(),
                stored.url(),
                stored.storageKey(),
                stored.mime(),
                stored.size(),
                // IKGS73：产物字节的 md5（与其余生成类型同源，来自 TOS 上传出口）
                stored.md5(),
                width,
                height));
        if (!published) {
            log.warn("[image_outpaint] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）", claim.id());
        } else {
            log.info("[image_outpaint] 发布成功 jobId={}", claim.id());
        }
    }

    // ========== 结果图下载（与 ImageEnhanceJobProcessor 同构） ==========

    /**
     * 下载火山结果图字节（URL 仅 24h 有效，必须立即转存）。
     * 失败归 image_outpaint_failed（无自动重试，用户手动重试会重新调网关）。
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
                throw new ImageOutpaintError(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED,
                        "结果图下载失败: HTTP " + resp.statusCode());
            }
            content = resp.body();
            contentType = resp.headers().firstValue("content-type").orElse(null);
        } catch (ImageOutpaintError e) {
            throw e;
        } catch (Exception e) {
            throw new ImageOutpaintError(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED,
                    "结果图下载失败: " + e.getMessage());
        }

        if (content == null || content.length == 0) {
            throw new ImageOutpaintError(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED,
                    "结果图为空");
        }
        if (contentType != null && !contentType.split(";", 2)[0].trim().startsWith("image/")) {
            throw new ImageOutpaintError(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED,
                    "结果图媒体类型不匹配");
        }
        return content;
    }

    // ========== 工具方法 ==========

    /** source_asset_id 容忍数字形态（Jackson 数字 JSON 值），与 mediaExtract 解析同构。 */
    private static String parseSourceAssetId(Map<String, Object> input) {
        Object obj = input.get(ImageOutpaintContract.INPUT_KEY_SOURCE_ASSET_ID);
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    /**
     * 解析单个扩展比例：非 Number 或超 [0, 0.4] 值域（ImageOutpaintContract 冻结）返回 NaN。
     * 值域复核权威在创建入口，此处为 worker 兜底防御（与高清放大枚举防御同构）。
     */
    private static double parseExpandRatio(Map<String, Object> input, String key) {
        Object obj = input.get(key);
        if (!(obj instanceof Number number)) return Double.NaN;
        double value = number.doubleValue();
        if (value < ImageOutpaintContract.EXPAND_RATIO_MIN
                || value > ImageOutpaintContract.EXPAND_RATIO_MAX) {
            return Double.NaN;
        }
        return value;
    }

    /**
     * 失败码归一：§5 分类信号（额度/内容政策）保留既有码，
     * 其余（超时 / 供应商失败 / 系统异常）一律归并兜底 image_outpaint_failed。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof ImageOutpaintError ioe && PRESERVED_ERROR_CODES.contains(ioe.getCode())) {
            return ioe.getCode();
        }
        return ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED;
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
