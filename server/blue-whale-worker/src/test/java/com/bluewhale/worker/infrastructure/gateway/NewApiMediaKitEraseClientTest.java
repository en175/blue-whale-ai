package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.ImageEraseContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageEraseError;
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

class NewApiMediaKitEraseClientTest {

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
        responseJson.set("{\"success\":true,\"result\":{\"image_url\":\"https://volc/erased.png\"}}");
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

    private NewApiMediaKitEraseClient.EraseResult callTextScene() {
        return new NewApiMediaKitEraseClient(new UpstreamBaseUrl(baseUrl)).erase(
                "sk-token", "https://example.com/src.png",
                "full_screen_text_erase", null);
    }


    @Test
    @DisplayName("full_screen_text_erase：路径 erase-image + model + 固定参数，不含 mask_url / standard_erase_text / selected_area")
    void textSceneOmitsMaskAndEraseText() {
        callTextScene();

        assertThat(lastPath.get()).isEqualTo("/v1/mediakit/sync/erase-image");
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"mediakit-erase-image\"");
        assertThat(body).contains("\"image_url\":\"https://example.com/src.png\"");
        assertThat(body).contains("\"tool_version\":\"standard\"");
        assertThat(body).contains("\"standard_scene\":\"full_screen_text_erase\"");
        assertThat(body).contains("\"output_format\":\"png\"");
        assertThat(body).doesNotContain("\"mask_url\"");
        assertThat(body).doesNotContain("\"standard_erase_text\"");
        assertThat(body).doesNotContain("\"selected_area\"");
    }

    @Test
    @DisplayName("selected_area_erase：只传 mask_url（遮罩公网地址），不传 selected_area 矩形")
    void areaSceneSendsMaskUrlOnly() {
        new NewApiMediaKitEraseClient(new UpstreamBaseUrl(baseUrl)).erase(
                "sk-token", "https://example.com/src.png",
                "selected_area_erase", "https://example.com/mask.png");

        String body = lastBody.get();
        assertThat(body).contains("\"standard_scene\":\"selected_area_erase\"");
        assertThat(body).contains("\"mask_url\":\"https://example.com/mask.png\"");
        assertThat(body).doesNotContain("\"selected_area\"");
        assertThat(body).doesNotContain("\"standard_erase_text\"");
        assertThat(body).contains("\"tool_version\":\"standard\"");
        assertThat(body).contains("\"output_format\":\"png\"");
    }

    @Test
    @DisplayName("鉴权与图片生成同构：Bearer + X-Client-System: bluewhale + X-Trace-Id")
    void standardHeadersSameAsImageGeneration() {
        callTextScene();

        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
    }


    @Test
    @DisplayName("成功：解析 result.image_url（火山托管 URL，24h 有效）")
    void parsesResultImageUrl() {
        NewApiMediaKitEraseClient.EraseResult result = callTextScene();

        assertThat(result.imageUrl()).isEqualTo("https://volc/erased.png");
    }

    @Test
    @DisplayName("网关 400（success=false 且不扣费）→ 抛错，上游可读原因透传到 message")
    void gateway400TransportsUpstreamReason() {
        lastStatus.set(400);
        responseJson.set("{\"success\":false,\"message\":\"mask resolution mismatch with image_url\"}");

        Throwable thrown = catchThrowable(this::callTextScene);

        assertThat(thrown).isInstanceOf(ImageEraseError.class);
        ImageEraseError error = (ImageEraseError) thrown;
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(error.getMessage()).contains("HTTP 400");
        assertThat(error.getMessage()).contains("mask resolution mismatch");
    }

    @Test
    @DisplayName("网关 400 内容政策信号 → content_rejected（§5 分类保留）")
    void gateway400ContentPolicySignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"error\":{\"message\":\"content policy violation\"}}");

        Throwable thrown = catchThrowable(this::callTextScene);

        assertThat(((ImageEraseError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("额度信号（余额不足文案）→ quota_exhausted（§5 分类保留）")
    void quotaSignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"message\":\"剩余额度不足\"}");

        Throwable thrown = catchThrowable(this::callTextScene);

        assertThat(((ImageEraseError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("200 但 error 信封 → 业务失败（§5 分类）")
    void successEnvelopeErrorClassified() {
        responseJson.set("{\"error\":{\"message\":\"sensitive content detected\"}}");

        Throwable thrown = catchThrowable(this::callTextScene);

        assertThat(((ImageEraseError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("200 但 result.image_url 缺失 → image_erase_failed 兜底")
    void missingResultUrlFallsBackToEraseFailed() {
        responseJson.set("{\"success\":true,\"result\":{}}");

        Throwable thrown = catchThrowable(this::callTextScene);

        assertThat(((ImageEraseError) thrown).getCode())
                .isEqualTo(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED);
    }

    @Test
    @DisplayName("非 JSON 响应 → image_erase_failed 兜底")
    void invalidJsonFallsBackToEraseFailed() {
        responseJson.set("not-json<");

        Throwable thrown = catchThrowable(this::callTextScene);

        assertThat(((ImageEraseError) thrown).getCode())
                .isEqualTo(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED);
    }
}
