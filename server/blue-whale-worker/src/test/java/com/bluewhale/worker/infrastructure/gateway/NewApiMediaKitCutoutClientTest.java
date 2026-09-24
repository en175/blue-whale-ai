package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.ImageCutoutContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageCutoutError;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * NewApiMediaKitCutoutClient 接口级 mock 网关测试（契约章节
 * docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXM2）。
 * <p>
 * 覆盖：两场景请求映射（general 不含增强四键 / tool_version / queue_id；human|product
 * 增强四键成组携带；固定 output_format=png）、标准请求头三元组、错误分类（网关 400 且
 * 不扣费 → §5 分类 + 上游原因透传）、result.image_url 解析与缺失兜底、官方响应宽高解析。
 * 不连真实网关。请求体字段名以火山官方 PDF「提交图像背景移除任务 API」为准
 * （无 tool_version 参数，区别于擦除；queue_id 可选不传）。
 */
class NewApiMediaKitCutoutClientTest {

    private HttpServer server;
    private final AtomicReference<String> lastPath = new AtomicReference<>();
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    private final AtomicReference<String> lastAuthorization = new AtomicReference<>();
    private final AtomicReference<String> lastClientSystem = new AtomicReference<>();
    private final AtomicReference<String> lastTraceId = new AtomicReference<>();
    private final AtomicInteger lastStatus = new AtomicInteger(200);
    private final AtomicReference<String> responseJson = new AtomicReference<>();
    private String baseUrl;

    @BeforeEach
    void startServer() throws Exception {
        responseJson.set("{\"success\":true,\"result\":{\"image_url\":\"https://volc/cutout.png\","
                + "\"image_size\":45875,\"image_format\":\"png\",\"image_width\":800,\"image_height\":600}}");
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            lastPath.set(exchange.getRequestURI().getPath());
            lastAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            lastClientSystem.set(exchange.getRequestHeaders().getFirst("X-Client-System"));
            lastTraceId.set(exchange.getRequestHeaders().getFirst("X-Trace-Id"));
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (InputStream in = exchange.getRequestBody()) {
                in.transferTo(buf);
            }
            lastBody.set(buf.toString(StandardCharsets.UTF_8));
            byte[] resp = responseJson.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(lastStatus.get(), resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private NewApiMediaKitCutoutClient.CutoutResult callGeneralScene() {
        return new NewApiMediaKitCutoutClient(baseUrl).cutout(
                "sk-token", "https://example.com/src.png", "general",
                null, null, null, null);
    }

    // ========== 两场景请求映射（官方 PDF Body 参数节） ==========

    @Test
    @DisplayName("general：路径 remove-image-background + model + scene 直传 + output_format=png，不含增强四键 / tool_version / queue_id")
    void generalSceneMinimalPayload() {
        callGeneralScene();

        assertThat(lastPath.get()).isEqualTo("/v1/mediakit/sync/remove-image-background");
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"mediakit-remove-image-background\"");
        assertThat(body).contains("\"image_url\":\"https://example.com/src.png\"");
        assertThat(body).contains("\"scene\":\"general\"");
        assertThat(body).contains("\"output_format\":\"png\"");
        // 通用场景不携带接口会忽略的字段（规格故事 29）；官方 PDF 无 tool_version；queue_id 不传
        assertThat(body).doesNotContain("\"need_contour\"");
        assertThat(body).doesNotContain("\"contour_color\"");
        assertThat(body).doesNotContain("\"contour_size\"");
        assertThat(body).doesNotContain("\"need_crop_background\"");
        assertThat(body).doesNotContain("\"tool_version\"");
        assertThat(body).doesNotContain("\"queue_id\"");
    }

    @Test
    @DisplayName("human：增强四键成组携带（need_contour/contour_color/contour_size/need_crop_background）")
    void humanSceneSendsEnhancementKeys() {
        new NewApiMediaKitCutoutClient(baseUrl).cutout(
                "sk-token", "https://example.com/src.png", "human",
                true, "#FFFFFF", 10, true);

        String body = lastBody.get();
        assertThat(body).contains("\"scene\":\"human\"");
        assertThat(body).contains("\"need_contour\":true");
        assertThat(body).contains("\"contour_color\":\"#FFFFFF\"");
        assertThat(body).contains("\"contour_size\":10");
        assertThat(body).contains("\"need_crop_background\":true");
        // 抠图无 tool_version（官方 PDF 无此参数，区别于擦除）
        assertThat(body).doesNotContain("\"tool_version\"");
    }

    @Test
    @DisplayName("product：仅透明裁剪（need_contour=false 时四键仍恒随请求携带）")
    void productSceneCarriesAllFourKeys() {
        new NewApiMediaKitCutoutClient(baseUrl).cutout(
                "sk-token", "https://example.com/src.png", "product",
                false, "#FFFFFF", 10, true);

        String body = lastBody.get();
        assertThat(body).contains("\"scene\":\"product\"");
        // 契约：need_contour=false 时官方忽略 contour_color/contour_size，四键仍随请求携带
        assertThat(body).contains("\"need_contour\":false");
        assertThat(body).contains("\"contour_color\":\"#FFFFFF\"");
        assertThat(body).contains("\"contour_size\":10");
        assertThat(body).contains("\"need_crop_background\":true");
    }

    @Test
    @DisplayName("鉴权与图片生成同构：Bearer + X-Client-System: bluewhale + X-Trace-Id")
    void standardHeadersSameAsImageGeneration() {
        callGeneralScene();

        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
    }

    // ========== 响应与错误分类（§5） ==========

    @Test
    @DisplayName("成功：解析 result.image_url 与官方响应宽高（image_width/image_height）")
    void parsesResultUrlAndDimensions() {
        NewApiMediaKitCutoutClient.CutoutResult result = callGeneralScene();

        assertThat(result.imageUrl()).isEqualTo("https://volc/cutout.png");
        assertThat(result.imageWidth()).isEqualTo(800);
        assertThat(result.imageHeight()).isEqualTo(600);
    }

    @Test
    @DisplayName("官方响应缺宽高 → imageWidth/imageHeight 为 null（processor 以 ImageIO 兜底）")
    void missingDimensionsReturnNull() {
        responseJson.set("{\"success\":true,\"result\":{\"image_url\":\"https://volc/cutout.png\"}}");

        NewApiMediaKitCutoutClient.CutoutResult result = callGeneralScene();

        assertThat(result.imageUrl()).isEqualTo("https://volc/cutout.png");
        assertThat(result.imageWidth()).isNull();
        assertThat(result.imageHeight()).isNull();
    }

    @Test
    @DisplayName("网关 400（success=false 且不扣费）→ 抛错，上游可读原因透传到 message")
    void gateway400TransportsUpstreamReason() {
        lastStatus.set(400);
        responseJson.set("{\"success\":false,\"error\":{\"code\":\"InvalidParameter\","
                + "\"message\":\"Parameter 'scene' must be one of [general, human, product].\"}}");

        Throwable thrown = catchThrowable(this::callGeneralScene);

        assertThat(thrown).isInstanceOf(ImageCutoutError.class);
        ImageCutoutError error = (ImageCutoutError) thrown;
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(error.getMessage()).contains("HTTP 400");
        assertThat(error.getMessage()).contains("must be one of");
    }

    @Test
    @DisplayName("网关 400 内容政策信号 → content_rejected（§5 分类保留）")
    void gateway400ContentPolicySignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"error\":{\"message\":\"content policy violation\"}}");

        Throwable thrown = catchThrowable(this::callGeneralScene);

        assertThat(((ImageCutoutError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("额度信号（余额不足文案）→ quota_exhausted（§5 分类保留）")
    void quotaSignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"message\":\"剩余额度不足\"}");

        Throwable thrown = catchThrowable(this::callGeneralScene);

        assertThat(((ImageCutoutError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("200 但 error 信封 → 业务失败（§5 分类）")
    void successEnvelopeErrorClassified() {
        responseJson.set("{\"error\":{\"message\":\"sensitive content detected\"}}");

        Throwable thrown = catchThrowable(this::callGeneralScene);

        assertThat(((ImageCutoutError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("200 但 result.image_url 缺失 → image_cutout_failed 兜底")
    void missingResultUrlFallsBackToCutoutFailed() {
        responseJson.set("{\"success\":true,\"result\":{}}");

        Throwable thrown = catchThrowable(this::callGeneralScene);

        assertThat(((ImageCutoutError) thrown).getCode())
                .isEqualTo(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED);
    }

    @Test
    @DisplayName("非 JSON 响应 → image_cutout_failed 兜底")
    void invalidJsonFallsBackToCutoutFailed() {
        responseJson.set("not-json<");

        Throwable thrown = catchThrowable(this::callGeneralScene);

        assertThat(((ImageCutoutError) thrown).getCode())
                .isEqualTo(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED);
    }
}
