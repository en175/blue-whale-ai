package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.ImageEnhanceContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageEnhanceError;
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

class NewApiMediaKitClientTest {

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
        responseJson.set("{\"success\":true,\"result\":{\"image_url\":\"https://volc/enhanced.png\"}}");
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

    private NewApiMediaKitClient.EnhanceResult callMax() {
        return new NewApiMediaKitClient(new UpstreamBaseUrl(baseUrl)).enhance(
                "sk-token", "https://example.com/src.png", "max", 4,
                "fidelity_first", false);
    }


    @Test
    @DisplayName("max 档全字段：路径 /v1/mediakit/sync/enhance-image + model + 全部 MediaKit 参数")
    void maxTierSendsAllFields() {
        callMax();

        assertThat(lastPath.get()).isEqualTo("/v1/mediakit/sync/enhance-image");
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"mediakit-enhance-image\"");
        assertThat(body).contains("\"image_url\":\"https://example.com/src.png\"");
        assertThat(body).contains("\"tool_version\":\"max\"");
        assertThat(body).contains("\"multiple\":4");
        assertThat(body).contains("\"generative_enhance_mode\":\"fidelity_first\"");
        assertThat(body).contains("\"enable_correct_color\":false");
    }

    @Test
    @DisplayName("鉴权与图片生成同构：Bearer + X-Client-System: bluewhale + X-Trace-Id")
    void standardHeadersSameAsImageGeneration() {
        callMax();

        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
    }

    @Test
    @DisplayName("lite 档出站裁剪：tool_version=standard 且不发 generative_enhance_mode / enable_correct_color")
    void liteTierOmitsUnsupportedKeys() {
        new NewApiMediaKitClient(new UpstreamBaseUrl(baseUrl)).enhance(
                "sk-token", "https://example.com/src.png", "standard", 2, null, null);

        String body = lastBody.get();
        assertThat(body).contains("\"tool_version\":\"standard\"");
        assertThat(body).doesNotContain("generative_enhance_mode");
        assertThat(body).doesNotContain("enable_correct_color");
    }

    @Test
    @DisplayName("pro 档出站裁剪：tool_version=professional，发策略、不发色彩校正")
    void proTierSendsModeOnly() {
        new NewApiMediaKitClient(new UpstreamBaseUrl(baseUrl)).enhance(
                "sk-token", "https://example.com/src.png", "professional", 6,
                "generative_first", null);

        String body = lastBody.get();
        assertThat(body).contains("\"tool_version\":\"professional\"");
        assertThat(body).contains("\"generative_enhance_mode\":\"generative_first\"");
        assertThat(body).doesNotContain("enable_correct_color");
    }


    @Test
    @DisplayName("成功：解析 result.image_url（火山托管 URL，24h 有效）")
    void parsesResultImageUrl() {
        NewApiMediaKitClient.EnhanceResult result = callMax();

        assertThat(result.imageUrl()).isEqualTo("https://volc/enhanced.png");
    }

    @Test
    @DisplayName("网关 400（success=false 且不扣费）→ 抛错，上游可读原因透传到 message")
    void gateway400TransportsUpstreamReason() {
        lastStatus.set(400);
        responseJson.set("{\"success\":false,\"message\":\"image resolution too small for tool version\"}");

        Throwable thrown = catchThrowable(this::callMax);

        assertThat(thrown).isInstanceOf(ImageEnhanceError.class);
        ImageEnhanceError error = (ImageEnhanceError) thrown;
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(error.getMessage()).contains("HTTP 400");
        assertThat(error.getMessage()).contains("image resolution too small");
    }

    @Test
    @DisplayName("网关 400 内容政策信号 → content_rejected（§5 分类保留）")
    void gateway400ContentPolicySignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"error\":{\"message\":\"content policy violation\"}}");

        Throwable thrown = catchThrowable(this::callMax);

        assertThat(((ImageEnhanceError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("额度信号（402 / 余额不足文案）→ quota_exhausted（§5 分类保留）")
    void quotaSignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"message\":\"剩余额度不足\"}");

        Throwable thrown = catchThrowable(this::callMax);

        assertThat(((ImageEnhanceError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("200 但 error 信封 → 业务失败（§5 分类）")
    void successEnvelopeErrorClassified() {
        responseJson.set("{\"error\":{\"message\":\"sensitive content detected\"}}");

        Throwable thrown = catchThrowable(this::callMax);

        assertThat(((ImageEnhanceError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("200 但 result.image_url 缺失 → image_enhance_failed 兜底")
    void missingResultUrlFallsBackToEnhanceFailed() {
        responseJson.set("{\"success\":true,\"result\":{}}");

        Throwable thrown = catchThrowable(this::callMax);

        assertThat(((ImageEnhanceError) thrown).getCode())
                .isEqualTo(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED);
    }

    @Test
    @DisplayName("非 JSON 响应 → image_enhance_failed 兜底")
    void invalidJsonFallsBackToEnhanceFailed() {
        responseJson.set("not-json<");

        Throwable thrown = catchThrowable(this::callMax);

        assertThat(((ImageEnhanceError) thrown).getCode())
                .isEqualTo(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED);
    }
}
