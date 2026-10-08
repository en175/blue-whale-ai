package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishImageCutoutDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.ImageCutoutContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageCutoutError;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitCutoutClient;
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
public class ImageCutoutJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(ImageCutoutJobProcessor.class);

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 image_cutout_failed。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 领取规格（IKIWP8 / ADR-0119）。 */
    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(ImageCutoutContract.SOURCE);

    private final JobClaimService claimService;
    private final JobFinalizer finalizer;
    private final ClaimSpec claimSpec;
    private final AssetSourceService assetSource;
    private final UpstreamCredential upstreamCredential;
    private final NewApiMediaKitCutoutClient mediaKitCutoutClient;
    private final TosMediaStorage tosService;
    private final String workerId;
    private final HttpClient fetchClient;

    public ImageCutoutJobProcessor(
            JobClaimService claimService,
            GenerationJobMapper jobMapper,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiMediaKitCutoutClient mediaKitCutoutClient,
            TosMediaStorage tosService
    ) {
        this.claimService = claimService;
        this.finalizer = finalizer;
        this.claimSpec = ClaimSpec.bySources(
                ImageCutoutContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.assetSource = assetSource;
        this.upstreamCredential = upstreamCredential;
        this.mediaKitCutoutClient = mediaKitCutoutClient;
        this.tosService = tosService;
        this.workerId = "cutout-" + hostname() + "-" + ProcessHandle.current().pid();
        this.fetchClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    @Override
    public String tag() {
        return ImageCutoutContract.TAG;
    }

    /**
     * 本家族的领取规格：供「一个处理器 ↔ 一份规格」一致性断言枚举（IKIWP8 / ADR-0119）。
     */
    @Override
    public Optional<ClaimSpec> claimSpec() {
        return Optional.of(claimSpec);
    }

    /**
     * 处理一个 image_cutout job。
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
            log.error("[image_cutout] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedJob claim = claimOpt.get();
        log.info("[image_cutout] 已领取 jobId={} token={}", claim.id(), claim.fencingToken());

        try {
            processClaimedJob(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            String message = e.getMessage() != null ? e.getMessage() : "图片抠图失败";
            log.error("[image_cutout] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message);
        }
    }

    private void processClaimedJob(ClaimedJob claim) {
        Map<String, Object> input = claim.input();

        // 1. 解析冻结 input 业务键（契约：按场景三键/七键恒在；此处为 worker 兜底防御）。
        //    target_node_id 是前端回填定位键，worker 不消费，不解析。
        String sourceAssetId = parseAssetId(input.get(ImageCutoutContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源素材 id");
            return;
        }
        Object sceneObj = input.get(ImageCutoutContract.INPUT_KEY_CUTOUT_SCENE);
        if (!(sceneObj instanceof String cutoutScene) || !isKnownScene(cutoutScene)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "抠图场景非法");
            return;
        }
        // 增强四键与场景的组合校验（契约 strict 分支同口径）：
        // general 禁填（官方忽略，出站不得携带接口会忽略的字段）；human|product 四键恒在
        // 且值在契约约束内（contour_color 字面 #FFFFFF、contour_size 整数 [1,100]）。
        Object needContourObj = input.get(ImageCutoutContract.INPUT_KEY_NEED_CONTOUR);
        Object contourColorObj = input.get(ImageCutoutContract.INPUT_KEY_CONTOUR_COLOR);
        Object contourSizeObj = input.get(ImageCutoutContract.INPUT_KEY_CONTOUR_SIZE);
        Object needCropObj = input.get(ImageCutoutContract.INPUT_KEY_NEED_CROP_BACKGROUND);
        Boolean needContour = null;
        String contourColor = null;
        Integer contourSize = null;
        Boolean needCropBackground = null;
        if (isSubjectScene(cutoutScene)) {
            if (!(needContourObj instanceof Boolean nc)) {
                failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "人像/商品场景缺少描边开关");
                return;
            }
            if (!(contourColorObj instanceof String cc)
                    || !ImageCutoutContract.CONTOUR_COLOR.equals(cc)) {
                failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "描边颜色非法");
                return;
            }
            Integer parsedSize = parseContourSize(contourSizeObj);
            if (parsedSize == null) {
                failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "描边宽度非法");
                return;
            }
            if (!(needCropObj instanceof Boolean ncb)) {
                failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "人像/商品场景缺少透明裁剪开关");
                return;
            }
            needContour = nc;
            contourColor = cc;
            contourSize = parsedSize;
            needCropBackground = ncb;
        } else if (needContourObj != null || contourColorObj != null
                || contourSizeObj != null || needCropObj != null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "通用场景禁带描边与裁剪参数");
            return;
        }

        // 2. 解析源素材：Asset url 落库即公网 public-read，直接作 image_url（无遮罩输入——
        //    官方接口全自动识别主体，区别于擦除的 selected_area_erase）
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"image".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED, "源图片素材不可用");
            return;
        }

        String providerToken;
        try {
            providerToken = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[image_cutout] 生成服务凭证未配置 jobId={}: {}", claim.id(), e.getMessage());
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "生成服务凭证未配置");
            return;
        }

        // 4. 经网关调 MediaKit 同步 remove-image-background（秒级返回结果图 URL，24h 有效）；
        //    场景映射在客户端单处定义（general 四参传 null 不发键，human|product 成组携带）。
        NewApiMediaKitCutoutClient.CutoutResult result = mediaKitCutoutClient.cutout(
                providerToken, source.getUrl(), cutoutScene,
                needContour, contourColor, contourSize, needCropBackground);
        log.info("[image_cutout] 上游已返回 jobId={} scene={}", claim.id(), cutoutScene);

        // 5. 立即下载结果图（24h 有效，响应后马上转存；与图片任务 persistProviderMedia 同构）
        byte[] content = fetchResultImage(result.imageUrl());

        // 6. TOS 公开读转存（image_cutout 强依赖 TOS——URL 24h 失效，不允许降级直存）
        if (tosService == null) {
            throw new ImageCutoutError(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED,
                    "图片抠图转存存储未配置");
        }
        String mime = NewApiImageClient.sniffImageMime(content, null);
        // 宽高优先取官方响应 result.image_width/image_height（与擦除走 ImageIO 的差异）；
        // 缺失时以结果图 ImageIO 解析兜底，解析失败静默 null（契约 §8 等价标准）。
        Integer width = result.imageWidth();
        Integer height = result.imageHeight();
        BufferedImage img = null;
        try {
            img = ImageIO.read(new ByteArrayInputStream(content));
        } catch (Exception ignored) {
            // 契约 §8：解析失败静默 null，资产照常落库
            log.debug("[image_cutout] ImageIO 解析宽高失败(非关键，降级 null)");
        }
        if (img != null) {
            if (width == null) width = ImageJobProcessor.positiveDimension(img.getWidth());
            if (height == null) height = ImageJobProcessor.positiveDimension(img.getHeight());
            // 空产物闸门（IKHGJI）：scene=human/product 检不出主体时，火山返 200 + success:true +
            // 一张 alpha 全 0 的 PNG，不带 error 字段。原先只判「字节非空 + content-type 是 image/*」，
            // 于是空图被当成功转存——用户拿到一张空白结果卡，而重试入口只在失败态出现，无法自救。
            // 此处按像素判空后拒绝转存：不落脏资产、不留终态 succeeded（解析失败仍走上面的静默分支）。
            if (isEmptyCutoutResult(img)) {
                log.warn("[image_cutout] 空产物(未识别到主体) jobId={} scene={} w={} h={}",
                        claim.id(), cutoutScene, img.getWidth(), img.getHeight());
                throw new ImageCutoutError(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED,
                        "抠图结果为空：未识别到主体");
            }
        }
        TosMediaStorage.UploadResult stored = tosService.uploadImageBytes(content, mime, claim.userId());
        log.info("[image_cutout] 转存完成 jobId={} storageKey={} size={} w={} h={}",
                claim.id(), stored.storageKey(), stored.size(), width, height);

        // 7. 终态收口：建 Asset（type=image / source=generated / generation_job_id）→ succeeded
        //    （免费工具无结算联动，同 extract/enhance/erase 的单槽双事件形态）
        boolean published = finalizer.publishImageCutoutResult(new PublishImageCutoutDto(
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
            log.warn("[image_cutout] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）", claim.id());
        } else {
            log.info("[image_cutout] 发布成功 jobId={}", claim.id());
        }
    }

    /**
     * 结果图是否为空产物（IKHGJI）：整幅图找不到任何一个 alpha ≠ 0 的像素。
     * <p>
     * 判据必须是「全透明」而非「不透明」——抠图产物的主体边缘有大量半透明像素，
     * 按 255 判会误杀正常结果（测试夹具 {@code PNG_1X1} 的 alpha 就是 127）。
     * <p>
     * 无 alpha 通道的产物（上游误回 jpeg / 真彩 png）<b>不算空产物</b>：那类图整幅透不出「空」，
     * 要识别只能另起「全同色」一套判据，不属本单。把「没通道」当「空」还会让同一批像素
     * 因编码不同得到相反结论——全不透明的像素编成 RGBA 放行、编成 RGB 却拦截。
     * <p>
     * 按行走 {@link BufferedImage#getRGB(int, int, int, int, int[], int, int)} 批量取像素：数组复用、
     * 不逐像素装箱，且对索引色 + tRNS 这类没有独立 alpha band 的图也能取到正确 alpha
     * （{@code getAlphaRaster()} 对它们返回 null，用它反而要多一条兜底分支）。
     * 全空图是最坏情况（扫满全图，human 场景上限 7680×4320）；正常结果扫到首个不透明像素即返回。
     */
    private static boolean isEmptyCutoutResult(BufferedImage img) {
        int width = img.getWidth();
        int[] row = new int[width];
        for (int y = 0, height = img.getHeight(); y < height; y++) {
            img.getRGB(0, y, width, 1, row, 0, width);
            for (int x = 0; x < width; x++) {
                if ((row[x] >>> 24) != 0) {
                    return false;
                }
            }
        }
        return true;
    }

    // ========== 结果图下载（generation-worker.ts image 路径同构） ==========

    /**
     * 下载火山结果图字节（URL 仅 24h 有效，必须立即转存）。
     * 失败归 image_cutout_failed（无自动重试，用户手动重试会重新调网关）。
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
                throw new ImageCutoutError(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED,
                        "结果图下载失败: HTTP " + resp.statusCode());
            }
            content = resp.body();
            contentType = resp.headers().firstValue("content-type").orElse(null);
        } catch (ImageCutoutError e) {
            throw e;
        } catch (Exception e) {
            throw new ImageCutoutError(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED,
                    "结果图下载失败: " + e.getMessage());
        }

        if (content == null || content.length == 0) {
            throw new ImageCutoutError(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED,
                    "结果图为空");
        }
        if (contentType != null && !contentType.split(";", 2)[0].trim().startsWith("image/")) {
            throw new ImageCutoutError(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED,
                    "结果图媒体类型不匹配");
        }
        return content;
    }

    // ========== 工具方法 ==========

    private static boolean isKnownScene(String scene) {
        return ImageCutoutContract.SCENE_GENERAL.equals(scene)
                || ImageCutoutContract.SCENE_HUMAN.equals(scene)
                || ImageCutoutContract.SCENE_PRODUCT.equals(scene);
    }

    /** human|product（官方描边与裁剪四参仅这两场景生效）。 */
    private static boolean isSubjectScene(String scene) {
        return ImageCutoutContract.SCENE_HUMAN.equals(scene)
                || ImageCutoutContract.SCENE_PRODUCT.equals(scene);
    }

    /** Asset id 容忍数字形态（Jackson 数字 JSON 值），与 imageErase 解析同构。 */
    private static String parseAssetId(Object obj) {
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    /**
     * contour_size 解析（契约约束：整数且 [1,100]；容忍 Jackson 数字 JSON 值，
     * 非整数 / 越界 / 缺失一律 null 交调用方落 invalid_input）。
     */
    private static Integer parseContourSize(Object obj) {
        if (obj instanceof Number n
                && n.doubleValue() == n.intValue()
                && n.intValue() >= ImageCutoutContract.CONTOUR_SIZE_MIN
                && n.intValue() <= ImageCutoutContract.CONTOUR_SIZE_MAX) {
            return n.intValue();
        }
        return null;
    }

    /**
     * 失败码归一：§5 分类信号（额度/内容政策）保留既有码，
     * 其余（超时 / 供应商失败 / 系统异常）一律归并兜底 image_cutout_failed。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof ImageCutoutError ice && PRESERVED_ERROR_CODES.contains(ice.getCode())) {
            return ice.getCode();
        }
        return ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED;
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
