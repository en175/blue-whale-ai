package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishImageCutoutDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.ImageCutoutContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageCutoutError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitCutoutClient;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.awt.image.BufferedImage;
import java.awt.image.IndexColorModel;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import javax.imageio.ImageIO;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * ImageCutoutJobProcessor 单测（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXM2）。
 * <p>
 * 覆盖：input 业务键与场景-增强键组合兜底校验、源素材与凭证缺失分类、错误码归一
 * （§5 信号保留、其余归 image_cutout_failed，无自动重试）、两场景成功链（出站参数映射 →
 * 经 mock 客户端拿到本地结果图 URL → 下载 → TOS 转存 → publishImageCutoutResult payload；
 * 宽高优先取官方响应、缺失时 ImageIO 兜底）、claim 异常上抛语义。
 * 不连真实 MQ/DB/TOS/网关（结果图用本地 HttpServer 桩）。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ImageCutoutJobProcessorTest {

    /** 1x1 PNG（ImageIO 可解析，宽高兜底断言用）。 */
    private static final byte[] PNG_1X1 = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobClaimService claimService;
    @Mock private GenerationJobMapper jobMapper;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitCutoutClient mediaKitCutoutClient;
    @Mock private TosMediaStorage tosService;

    private ImageCutoutJobProcessor processor;
    private HttpServer resultServer;
    private String resultUrl;

    @BeforeEach
    void setUp() throws Exception {
        processor = new ImageCutoutJobProcessor(
                stateMachine, claimService, jobMapper, finalizer,
                new AssetSourceService(assetMapper),
                credentialService, mediaKitCutoutClient, tosService);
        when(finalizer.failJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong()))
                .thenReturn(true);

        // 结果图桩（24h 有效的火山 URL 用本地 HttpServer 模拟）
        resultServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        resultServer.createContext("/cutout.png", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "image/png");
            exchange.sendResponseHeaders(200, PNG_1X1.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(PNG_1X1);
            }
        });
        resultServer.start();
        resultUrl = "http://127.0.0.1:" + resultServer.getAddress().getPort() + "/cutout.png";
    }

    @AfterEach
    void tearDown() {
        resultServer.stop(0);
    }

    private ClaimedJob makeClaim(Map<String, Object> input) {
        return new ClaimedJob("100", "42", "9", input, "image_cutout",
                null, false, "worker-1", 5L, 0, 0, null, null, null);
    }

    private Map<String, Object> generalSceneInput() {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("cutout_scene", "general");
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    private Map<String, Object> humanSceneInput() {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("cutout_scene", "human");
        input.put("need_contour", true);
        input.put("contour_color", "#FFFFFF");
        input.put("contour_size", 10);
        input.put("need_crop_background", true);
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    private void stubSourceAsset() {
        AssetEntity source = new AssetEntity();
        source.setType("image");
        source.setUrl("https://example.com/src.png");
        source.setStorageKey("uploads/9/image/src.png");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(source);
    }

    private void stubClaim(Map<String, Object> input) {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input)));
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
    }

    private void stubPublish() {
        when(tosService.uploadImageBytes(any(), anyString(), eq("9")))
                .thenReturn(new TosMediaStorage.UploadResult(
                        "https://tos/cutout.png", "uploads/9/image/cutout.png", "image/png", PNG_1X1.length, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishImageCutoutResult(any())).thenReturn(true);
    }

    private void assertFailCode(String expectedCode) {
        verify(finalizer).failJob(eq("100"), eq(expectedCode), anyString(),
                any(), eq("worker-1"), eq(5L));
    }

    /**
     * 造带指定像素的 PNG 字节（IKHGJI 空产物闸门夹具）。
     * <p>
     * {@code TYPE_INT_ARGB} 造出的 PNG 与火山抠图产物同形（color type 6，带透明通道）；
     * 换成 {@code TYPE_INT_RGB} 即模拟上游误回不带 alpha 的产物。像素为行优先的 ARGB。
     */
    private static byte[] png(int imageType, int width, int height, int... argb) {
        BufferedImage img = new BufferedImage(width, height, imageType);
        img.setRGB(0, 0, width, height, argb, 0, width);
        return writePng(img);
    }

    /**
     * 造索引色 + tRNS 的 PNG 字节：透明信息挂在调色板上，没有独立 alpha band
     * （{@code getAlphaRaster()} 对它是 null）。钉住闸门走批量 {@code getRGB} 而非 {@code getAlphaRaster}
     * 的理由——换成后者并把 null 当「非空」，这类全透明图就会被放行，正是本单要修的假成功。
     */
    private static byte[] indexedTransparentPng(int width, int height) {
        // 调色板两格都是 alpha=0（RGB 取不同值，避免退化成一个颜色被编码器改写形态）
        IndexColorModel cm = new IndexColorModel(1, 2,
                new byte[]{0, (byte) 0xFF}, new byte[]{0, 0}, new byte[]{0, 0}, new byte[]{0, 0});
        BufferedImage img = new BufferedImage(width, height, BufferedImage.TYPE_BYTE_INDEXED, cm);
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                // 直接写调色板下标，绕开 setRGB 的颜色匹配
                img.getRaster().setSample(x, y, 0, 0);
            }
        }
        return writePng(img);
    }

    private static byte[] writePng(BufferedImage img) {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            ImageIO.write(img, "png", out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** 把结果图桩换成任意字节（沿用 resultDownloadFails 那条用例的 remove + 重建手法）。 */
    private void stubResultBytes(byte[] bytes) {
        resultServer.removeContext("/cutout.png");
        resultServer.createContext("/cutout.png", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "image/png");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
    }

    // ========== claim 语义（IKC9EJ 同构） ==========

    @Test
    @DisplayName("claim 抛 DB 异常 → 上抛（不 fail job，不 ack → 重投）")
    void claimThrowsDbError_propagates() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString())).thenReturn(Optional.empty());

        processor.handle("100");

        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(finalizer, never()).publishImageCutoutResult(any());
    }

    // ========== input 业务键与场景-增强键组合兜底校验（权威复核在创建入口 IKGXM1） ==========

    @Test
    @DisplayName("缺 source_asset_id → invalid_input")
    void missingSourceAssetId_invalidInput() {
        Map<String, Object> input = generalSceneInput();
        input.remove("source_asset_id");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("cutout_scene 非枚举值 → invalid_input")
    void invalidScene_invalidInput() {
        Map<String, Object> input = generalSceneInput();
        input.put("cutout_scene", "vehicle");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("general 场景携带增强四键之一 → invalid_input（契约 strict 分支禁填）")
    void generalSceneWithEnhancementKeys_invalidInput() {
        Map<String, Object> input = generalSceneInput();
        input.put("need_contour", true);
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("human 场景缺增强四键 → invalid_input（契约：human|product 四键恒在）")
    void subjectSceneWithoutEnhancementKeys_invalidInput() {
        Map<String, Object> input = humanSceneInput();
        input.remove("need_contour");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("human 场景 contour_color 非 #FFFFFF → invalid_input（契约字面冻结）")
    void subjectSceneWrongContourColor_invalidInput() {
        Map<String, Object> input = humanSceneInput();
        input.put("contour_color", "#000000");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("human 场景 contour_size 越界（101）→ invalid_input（官方 [1,100]）")
    void subjectSceneContourSizeOutOfRange_invalidInput() {
        Map<String, Object> input = humanSceneInput();
        input.put("contour_size", 101);
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    // ========== 源素材 / 凭证 ==========

    @Test
    @DisplayName("源素材不可用 → image_cutout_failed + 可读原因")
    void sourceAssetUnavailable_cutoutFailed() {
        stubClaim(generalSceneInput());
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(null);

        processor.handle("100");

        assertFailCode(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED);
        verify(mediaKitCutoutClient, never()).cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any());
    }

    @Test
    @DisplayName("缺冻结凭证 → provider_credential_missing（与 image/imageErase 同构）")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = generalSceneInput();
        input.remove("provider_credential");
        stubClaim(input);
        stubSourceAsset();

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }

    // ========== 错误码归一（§5 信号保留，其余归 image_cutout_failed；无自动重试） ==========

    @Test
    @DisplayName("客户端 content_rejected → 保留既有码投影（§5 信号）")
    void contentRejected_preserved() {
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenThrow(new ImageCutoutError(GenerationError.ERROR_CONTENT_REJECTED,
                        "图片抠图失败: HTTP 400 sensitive content"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("客户端 quota_exhausted → 保留既有码投影（§5 信号）")
    void quotaExhausted_preserved() {
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenThrow(new ImageCutoutError(GenerationError.ERROR_QUOTA_EXHAUSTED,
                        "图片抠图失败: HTTP 402 剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("客户端 provider_failed（网关 400 接口报错）→ 归并 image_cutout_failed（兜底，无自动重试）")
    void providerFailed_normalizedToCutoutFailed() {
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenThrow(new ImageCutoutError(GenerationError.ERROR_PROVIDER_FAILED,
                        "图片抠图失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED);
    }

    @Test
    @DisplayName("客户端超时（provider_timeout）→ 归并 image_cutout_failed（不重试）")
    void providerTimeout_normalizedToCutoutFailed() {
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenThrow(new ImageCutoutError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 图片抠图超时"));

        processor.handle("100");

        assertFailCode(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED);
    }

    // ========== 两场景成功链（出站映射 + 回填：下载 → TOS → 发布 payload 带宽高） ==========

    @Test
    @DisplayName("general 成功链：出站最小 payload（增强四参 null）→ 宽高取官方响应 → 发布 payload")
    void generalSceneSuccessChain() {
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("general"), isNull(), isNull(), isNull(), isNull()))
                .thenReturn(new NewApiMediaKitCutoutClient.CutoutResult(resultUrl, 800, 600));
        stubPublish();

        processor.handle("100");

        // 出站映射：general 增强四参全 null（客户端不发 need_contour 等四键，规格故事 29）
        verify(mediaKitCutoutClient).cutout(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("general"), isNull(), isNull(), isNull(), isNull());
        ArgumentCaptor<PublishImageCutoutDto> captor = ArgumentCaptor.forClass(PublishImageCutoutDto.class);
        verify(finalizer).publishImageCutoutResult(captor.capture());
        PublishImageCutoutDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/cutout.png");
        assertThat(published.storageKey()).isEqualTo("uploads/9/image/cutout.png");
        assertThat(published.mime()).isEqualTo("image/png");
        assertThat(published.size()).isEqualTo(PNG_1X1.length);
        // 宽高优先取官方响应 result.image_width/image_height（与擦除走 ImageIO 的差异；
        // 桩图是 1x1，若误走 ImageIO 会得到 1——这两条断言即防漂移）
        assertThat(published.width()).isEqualTo(800);
        assertThat(published.height()).isEqualTo(600);
        // IKGS73：md5 必须从 stored 穿透到发布入参（assets.md5 去重依赖）。
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("human 成功链：出站带描边组全键 → 官方响应缺宽高时 ImageIO 兜底 → 发布 payload")
    void humanSceneSuccessChain_imageIoFallback() {
        stubClaim(humanSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("human"), eq(true), eq("#FFFFFF"), eq(10), eq(true)))
                .thenReturn(new NewApiMediaKitCutoutClient.CutoutResult(resultUrl, null, null));
        stubPublish();

        processor.handle("100");

        // 出站映射：human 增强四参成组携带（need_contour/contour_color/contour_size/need_crop_background）
        verify(mediaKitCutoutClient).cutout(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("human"), eq(true), eq("#FFFFFF"), eq(10), eq(true));
        ArgumentCaptor<PublishImageCutoutDto> captor = ArgumentCaptor.forClass(PublishImageCutoutDto.class);
        verify(finalizer).publishImageCutoutResult(captor.capture());
        // 官方响应缺宽高 → 结果图 ImageIO 解析兜底（1x1 PNG）
        assertThat(captor.getValue().width()).isEqualTo(1);
        assertThat(captor.getValue().height()).isEqualTo(1);
        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("结果图下载 404 → image_cutout_failed，不转存不发布")
    void resultDownloadFails_cutoutFailed() {
        resultServer.removeContext("/cutout.png");
        resultServer.createContext("/cutout.png", exchange -> {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
        });
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenReturn(new NewApiMediaKitCutoutClient.CutoutResult(resultUrl, 800, 600));

        processor.handle("100");

        assertFailCode(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED);
        verify(tosService, never()).uploadImageBytes(any(), anyString(), anyString());
        verify(finalizer, never()).publishImageCutoutResult(any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenReturn(new NewApiMediaKitCutoutClient.CutoutResult(resultUrl, 800, 600));
        when(tosService.uploadImageBytes(any(), anyString(), anyString()))
                .thenReturn(new TosMediaStorage.UploadResult(
                        "https://tos/c.png", "uploads/9/image/c.png", "image/png", PNG_1X1.length, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishImageCutoutResult(any())).thenReturn(false);

        processor.handle("100");

        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    // ========== 空产物闸门（IKHGJI：火山 scene 硬过滤档返回 200 + alpha 全 0 的假成功） ==========

    @Test
    @DisplayName("全透明结果图 → 判空拦截：不转存、不发布、落 image_cutout_failed")
    void allTransparentResult_cutoutFailed() {
        stubResultBytes(png(BufferedImage.TYPE_INT_ARGB, 2, 2,
                0x00000000, 0x00000000, 0x00000000, 0x00000000));
        stubClaim(humanSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenReturn(new NewApiMediaKitCutoutClient.CutoutResult(resultUrl, 800, 600));
        // 成功链一并桩上：闸门若不生效，job 会一路走到成功，assertFailCode 才会真的失败。
        // 不桩的话未打桩的 uploadImageBytes 返回 null → NPE 被 handle 兜住 → 同样落
        // image_cutout_failed，断言就成了摆设（只有下面的 never() 还能拦住）。
        stubPublish();

        processor.handle("100");

        assertFailCode(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED);
        // 闸门拦在 uploadImageBytes 之前：既不落脏资产，也不留终态 succeeded
        verify(tosService, never()).uploadImageBytes(any(), anyString(), anyString());
        verify(finalizer, never()).publishImageCutoutResult(any());
    }

    @Test
    @DisplayName("半透明结果图（alpha=127，抠图边缘常态）→ 不误判为空，照常转存发布")
    void semiTransparentResult_notJudgedEmpty() {
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenReturn(new NewApiMediaKitCutoutClient.CutoutResult(resultUrl, 800, 600));
        stubPublish();

        processor.handle("100");

        // setUp 的桩图 PNG_1X1 解出来是 alpha=127：判据若写成「非 255 即空」会在这里误杀
        verify(tosService).uploadImageBytes(eq(PNG_1X1), anyString(), eq("9"));
        verify(finalizer).publishImageCutoutResult(any());
        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("2x2 里仅 1 个像素不透明 → 不算空产物，放行")
    void singleOpaquePixelResult_notEmpty() {
        stubResultBytes(png(BufferedImage.TYPE_INT_ARGB, 2, 2,
                0x00000000, 0x00000000, 0x00000000, 0xFF00FF00));
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenReturn(new NewApiMediaKitCutoutClient.CutoutResult(resultUrl, 800, 600));
        stubPublish();

        processor.handle("100");

        verify(tosService).uploadImageBytes(any(), anyString(), eq("9"));
        verify(finalizer).publishImageCutoutResult(any());
        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("索引色 + tRNS 的全透明结果图 → 同样判空拦截（透明不在独立 alpha band 上）")
    void indexedTransparentResult_cutoutFailed() throws Exception {
        byte[] bytes = indexedTransparentPng(2, 2);
        // 先钉住夹具本身：索引色 + tRNS 的图 hasAlpha() 为 true 却没有独立 alpha band。
        // 这两条断言一旦挂了，说明 JDK 的 PNG 解码行为变了，闸门换 getAlphaRaster() 的前提也随之作废。
        BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(bytes));
        assertThat(decoded.getColorModel().hasAlpha()).isTrue();
        assertThat(decoded.getAlphaRaster()).isNull();
        stubResultBytes(bytes);
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenReturn(new NewApiMediaKitCutoutClient.CutoutResult(resultUrl, 800, 600));
        stubPublish();

        processor.handle("100");

        assertFailCode(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED);
        verify(tosService, never()).uploadImageBytes(any(), anyString(), anyString());
        verify(finalizer, never()).publishImageCutoutResult(any());
    }

    @Test
    @DisplayName("全不透明产物、不带 alpha 通道（真彩 png）→ 不算空产物，放行")
    void opaqueWithoutAlphaChannel_notEmpty() {
        stubResultBytes(png(BufferedImage.TYPE_INT_RGB, 2, 2,
                0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF));
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenReturn(new NewApiMediaKitCutoutClient.CutoutResult(resultUrl, 800, 600));
        stubPublish();

        processor.handle("100");

        verify(tosService).uploadImageBytes(any(), anyString(), eq("9"));
        verify(finalizer).publishImageCutoutResult(any());
        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("全不透明产物、带 alpha 通道（RGBA 全 255）→ 与上一条同判，放行（钉住编码无关）")
    void opaqueArgbResult_notEmpty() {
        stubResultBytes(png(BufferedImage.TYPE_INT_ARGB, 2, 2,
                0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF));
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenReturn(new NewApiMediaKitCutoutClient.CutoutResult(resultUrl, 800, 600));
        stubPublish();

        processor.handle("100");

        verify(tosService).uploadImageBytes(any(), anyString(), eq("9"));
        verify(finalizer).publishImageCutoutResult(any());
        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("结果图不可解码（非图片字节）→ 不触发闸门，维持契约 §8 静默降级")
    void undecodableResult_skipsGate() {
        byte[] garbage = "not-an-image".getBytes(StandardCharsets.UTF_8);
        stubResultBytes(garbage);
        stubClaim(generalSceneInput());
        stubSourceAsset();
        when(mediaKitCutoutClient.cutout(anyString(), anyString(), anyString(),
                any(), any(), any(), any()))
                .thenReturn(new NewApiMediaKitCutoutClient.CutoutResult(resultUrl, 800, 600));
        stubPublish();

        processor.handle("100");

        // 魔数认不出 → sniffImageMime 兜底 image/png，mime 照常带过去（不是 null）
        verify(tosService).uploadImageBytes(eq(garbage), eq("image/png"), eq("9"));
        verify(finalizer).publishImageCutoutResult(any());
        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }
}
