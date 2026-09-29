package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishImageEraseDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.ImageEraseContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageEraseError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitEraseClient;
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
 * image_erase（图片擦除）作业处理器（契约 §15.5 / IKGOT6，附录 C 触点③；
 * 以 ImageEnhanceJobProcessor 为模板，差异 = 场景出站映射）。
 * <p>
 * 编排流程：claim → 解析冻结 input 业务键 → 解析源素材（公网 url 即 image_url）→
 * （selected_area_erase）解析遮罩素材（公网 url 即 mask_url）→ 取任务冻结的用户 sk- →
 * 经网关调 MediaKit 同步 erase（场景映射 §15.3）→ 立即下载结果图（火山 URL 仅 24h 有效）→
 * TOS 公开读转存 → 建 Asset（type=image, source=generated）→ 终态 succeeded 收口
 * （publishImageEnhanceResult 同形态）。
 * 前端经 GET /api/jobs/:id 拿 Asset 按 input.target_node_id 回填擦除结果卡
 * （擦除是发送时才建卡，node id 由前端生成传入；worker 不消费画布拓扑）。
 * <p>
 * 场景出站映射（契约 §15.3）：
 * <ul>
 *   <li>full_screen_text_erase：不传遮罩与 standard_erase_text（擦所有文字，官方默认行为）</li>
 *   <li>selected_area_erase：只传 mask_url（统一遮罩路径支持多框多笔并集），
 *       不传 selected_area 矩形（不依赖文档允许的并传并集行为）</li>
 * </ul>
 * 固定参数：tool_version=standard（官方仅支持 standard）、output_format=png（不取默认 webp）。
 * <p>
 * 错误码口径（§15.5，无 worker 级自动重试，用户在结果卡手动重试并沿用冻结 input）：
 * <ul>
 *   <li>invalid_input：业务键缺失 / 场景枚举非法 / 场景与遮罩组合违反契约
 *       （创建入口 IKGOT4 复核是权威，worker 兜底防御）</li>
 *   <li>provider_credential_missing：任务缺少冻结凭证（与 image/imageEnhance 同构）</li>
 *   <li>content_rejected / content_rejected_reference / quota_exhausted：
 *       NewApiErrorClassifier §5 分类信号，保留既有码投影</li>
 *   <li>image_erase_failed：其余一律归并兜底（调用失败 / 超时 / 供应商错误
 *       （网关 success=false 返 400 且不扣费）/ 源素材或遮罩素材不可用 / 结果下载转存失败），
 *       上游可读原因随 message 透传</li>
 * </ul>
 * <p>
 * 进度投影与图片任务同构：终态事件（status_changed，成功 progress=100 / 失败 error 投影），
 * 同步接口秒级返回无中间进度带。
 */
@Component
public class ImageEraseJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(ImageEraseJobProcessor.class);

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 image_erase_failed。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 领取规格（IKIWP8 / ADR-0119）。 */
    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(ImageEraseContract.SOURCE);

    private final JobClaimService claimService;
    private final JobFinalizer finalizer;
    private final ClaimSpec claimSpec;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiMediaKitEraseClient mediaKitEraseClient;
    private final TosMediaStorage tosService;
    private final String workerId;
    private final HttpClient fetchClient;

    public ImageEraseJobProcessor(
            JobClaimService claimService,
            GenerationJobMapper jobMapper,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiMediaKitEraseClient mediaKitEraseClient,
            TosMediaStorage tosService
    ) {
        this.claimService = claimService;
        this.finalizer = finalizer;
        this.claimSpec = ClaimSpec.bySources(
                ImageEraseContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.mediaKitEraseClient = mediaKitEraseClient;
        this.tosService = tosService;
        this.workerId = "erase-" + hostname() + "-" + ProcessHandle.current().pid();
        this.fetchClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    @Override
    public String tag() {
        return ImageEraseContract.TAG;
    }

    /**
     * 本家族的领取规格：供「一个处理器 ↔ 一份规格」一致性断言枚举（IKIWP8 / ADR-0119）。
     */
    @Override
    public Optional<ClaimSpec> claimSpec() {
        return Optional.of(claimSpec);
    }

    /**
     * 处理一个 image_erase job。
     * <p>
     * claim 在 try 外（IKC9EJ 同构：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试，§15.5）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedJob> claimOpt;
        try {
            claimOpt = claimService.claim(claimSpec, jobId, workerId);
        } catch (Exception error) {
            log.error("[image_erase] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedJob claim = claimOpt.get();
        log.info("[image_erase] 已领取 jobId={} token={}", claim.id(), claim.fencingToken());

        try {
            processClaimedJob(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            String message = e.getMessage() != null ? e.getMessage() : "图片擦除失败";
            log.error("[image_erase] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message);
        }
    }

    private void processClaimedJob(ClaimedJob claim) {
        Map<String, Object> input = claim.input();

        // 1. 解析冻结 input 业务键（§15.2：按场景三/四键恒在；此处为 worker 兜底防御）。
        //    target_node_id 是前端回填定位键，worker 不消费，不解析。
        String sourceAssetId = parseAssetId(input.get(ImageEraseContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源素材 id");
            return;
        }
        Object sceneObj = input.get(ImageEraseContract.INPUT_KEY_ERASE_SCENE);
        if (!(sceneObj instanceof String eraseScene) || !isKnownScene(eraseScene)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "擦除场景非法");
            return;
        }
        String maskAssetId = parseAssetId(input.get(ImageEraseContract.INPUT_KEY_MASK_ASSET_ID));
        if (ImageEraseContract.SCENE_FULL_SCREEN_TEXT_ERASE.equals(eraseScene)) {
            // 契约 strict 分支强制禁填（zod discriminatedUnion），worker 兜底防御同口径。
            if (maskAssetId != null) {
                failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "全屏文字擦除禁带遮罩素材");
                return;
            }
        } else {
            // selected_area_erase：mask_asset_id 必填（§15.2）。
            if (maskAssetId == null) {
                failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "指定区域擦除缺少遮罩素材");
                return;
            }
        }

        // 2. 解析源素材：Asset url 落库即公网 public-read，直接作 image_url（§15.5）
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"image".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, ImageEraseContract.ERROR_IMAGE_ERASE_FAILED, "源图片素材不可用");
            return;
        }

        // 3. selected_area_erase：解析遮罩素材，公网 url 即 mask_url（黑白遮罩 PNG 经资产上传
        //    链路取得，分辨率由前端按源图自然分辨率栅格化保证，worker 不复核）。
        String maskUrl = null;
        if (ImageEraseContract.SCENE_SELECTED_AREA_ERASE.equals(eraseScene)) {
            AssetEntity mask = assetSource.resolve(
                    Long.parseLong(maskAssetId),
                    Long.parseLong(claim.userId()),
                    Long.parseLong(claim.projectId()));
            if (mask == null || !"image".equals(mask.getType())
                    || mask.getUrl() == null || mask.getUrl().isEmpty()) {
                failClaimed(claim, ImageEraseContract.ERROR_IMAGE_ERASE_FAILED, "遮罩素材不可用");
                return;
            }
            maskUrl = mask.getUrl();
        }

        // 4. 取任务冻结的用户 sk-（与图片生成同构，修正四：明文直通）
        Object credentialObj = input.get("provider_credential");
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "图片擦除任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[image_erase] 凭证无效 jobId={}: {}", claim.id(), e.getMessage(), e);
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "图片擦除任务凭证无效");
            return;
        }

        // 5. 经网关调 MediaKit 同步 erase（几秒返回结果图 URL，24h 有效）；
        //    场景映射在客户端单处定义（§15.3：text 场景不发 mask_url，area 场景只发 mask_url）。
        NewApiMediaKitEraseClient.EraseResult result = mediaKitEraseClient.erase(
                providerToken, source.getUrl(), eraseScene, maskUrl);
        log.info("[image_erase] 上游已返回 jobId={} scene={} mask={}",
                claim.id(), eraseScene, maskUrl != null);

        // 6. 立即下载结果图（24h 有效，响应后马上转存；与图片任务 persistProviderMedia 同构）
        byte[] content = fetchResultImage(result.imageUrl());

        // 7. TOS 公开读转存（image_erase 强依赖 TOS——URL 24h 失效，不允许降级直存）
        if (tosService == null) {
            throw new ImageEraseError(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED,
                    "图片擦除转存存储未配置");
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
            // 契约 §8：解析失败静默 null，资产照常落库
            log.debug("[image_erase] ImageIO 解析宽高失败(非关键，降级 null)");
        }
        TosMediaStorage.UploadResult stored = tosService.uploadImageBytes(content, mime, claim.userId());
        log.info("[image_erase] 转存完成 jobId={} storageKey={} size={} w={} h={}",
                claim.id(), stored.storageKey(), stored.size(), width, height);

        // 8. 终态收口：建 Asset（type=image / source=generated / generation_job_id）→ succeeded
        //    （免费工具无结算联动，同 extract/enhance 的单槽双事件形态，§15.5）
        boolean published = finalizer.publishImageEraseResult(new PublishImageEraseDto(
                claim.id(),
                claim.projectId(),
                claim.userId(),
                claim.workerId(),
                claim.fencingToken(),
                stored.url(),
                stored.storageKey(),
                stored.mime(),
                stored.size(),
                // IKGS73：产物字节的 md5（与其余五个生成类型同源，来自 TOS 上传出口）
                stored.md5(),
                width,
                height));
        if (!published) {
            log.warn("[image_erase] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）", claim.id());
        } else {
            log.info("[image_erase] 发布成功 jobId={}", claim.id());
        }
    }

    // ========== 结果图下载（generation-worker.ts image 路径同构） ==========

    /**
     * 下载火山结果图字节（URL 仅 24h 有效，必须立即转存）。
     * 失败归 image_erase_failed（无自动重试，用户手动重试会重新调网关）。
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
                throw new ImageEraseError(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED,
                        "结果图下载失败: HTTP " + resp.statusCode());
            }
            content = resp.body();
            contentType = resp.headers().firstValue("content-type").orElse(null);
        } catch (ImageEraseError e) {
            throw e;
        } catch (Exception e) {
            throw new ImageEraseError(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED,
                    "结果图下载失败: " + e.getMessage());
        }

        if (content == null || content.length == 0) {
            throw new ImageEraseError(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED,
                    "结果图为空");
        }
        if (contentType != null && !contentType.split(";", 2)[0].trim().startsWith("image/")) {
            throw new ImageEraseError(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED,
                    "结果图媒体类型不匹配");
        }
        return content;
    }

    // ========== 工具方法 ==========

    private static boolean isKnownScene(String scene) {
        return ImageEraseContract.SCENE_FULL_SCREEN_TEXT_ERASE.equals(scene)
                || ImageEraseContract.SCENE_SELECTED_AREA_ERASE.equals(scene);
    }

    /** Asset id 容忍数字形态（Jackson 数字 JSON 值），与 imageEnhance 解析同构。 */
    private static String parseAssetId(Object obj) {
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    /**
     * 失败码归一（§15.5）：§5 分类信号（额度/内容政策）保留既有码，
     * 其余（超时 / 供应商失败 / 系统异常）一律归并兜底 image_erase_failed。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof ImageEraseError iee && PRESERVED_ERROR_CODES.contains(iee.getCode())) {
            return iee.getCode();
        }
        return ImageEraseContract.ERROR_IMAGE_ERASE_FAILED;
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
