package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.ImageOutpaintContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageOutpaintError;
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
 * NewApiMediaKitOutpaintClient 接口级 mock 网关测试（IKGOQW）。
 * <p>
 * 覆盖：请求映射（model / image_url / 四个 expand 比例 / 不带 queue_id）、标准请求头三元组、
 * 错误分类（网关 400 且不扣费 → §5 分类 + 上游原因透传）、result.image_url 解析与缺失兜底。
 * 不连真实网关。
 */
class NewApiMediaKitOutpaintClientTest {

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
        responseJson.set("{\"success\":true,\"result\":{\"image_url\":\"https://volc/expanded.png\"}}");
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

    private NewApiMediaKitOutpaintClient.OutpaintResult callExpand() {
        return new NewApiMediaKitOutpaintClient(baseUrl).expandImageCanvas(
                "sk-token", "https://example.com/src.png",
                0.1, 0.25, 0.4, 0.0);
    }

    // ========== 请求映射（AC：image_url 为源素材公网地址、四值与冻结输入一致、不带 queue_id） ==========

    @Test
    @DisplayName("全字段：路径 /v1/mediakit/sync/expand-image-canvas + model + image_url + 四个 expand 比例")
    void sendsAllFields() {
        callExpand();

        assertThat(lastPath.get()).isEqualTo("/v1/mediakit/sync/expand-image-canvas");
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"mediakit-expand-image-canvas\"");
        assertThat(body).contains("\"image_url\":\"https://example.com/src.png\"");
        assertThat(body).contains("\"expand_top\":0.1");
        assertThat(body).contains("\"expand_bottom\":0.25");
        assertThat(body).contains("\"expand_left\":0.4");
        assertThat(body).contains("\"expand_right\":0.0");
    }

    @Test
    @DisplayName("queue_id 不传（用火山默认队列；零扩展方向显式传 0，不依赖官方默认 0.1）")
    void neverSendsQueueId() {
        callExpand();

        assertThat(lastBody.get()).doesNotContain("queue_id");
    }

    @Test
    @DisplayName("鉴权与图片生成同构：Bearer + X-Client-System: bluewhale + X-Trace-Id")
    void standardHeadersSameAsImageGeneration() {
        callExpand();

        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
    }

    // ========== 响应与错误分类（网关 success=false 返 400 且不扣费） ==========

    @Test
    @DisplayName("成功：解析 result.image_url（火山托管 URL，24h 有效）")
    void parsesResultImageUrl() {
        NewApiMediaKitOutpaintClient.OutpaintResult result = callExpand();

        assertThat(result.imageUrl()).isEqualTo("https://volc/expanded.png");
    }

    @Test
    @DisplayName("网关 400（success=false 且不扣费）→ 抛错，上游可读原因透传到 message")
    void gateway400TransportsUpstreamReason() {
        lastStatus.set(400);
        responseJson.set("{\"success\":false,\"error\":{\"code\":\"InvalidParameter\","
                + "\"type\":\"BadRequest\",\"message\":\"The value of 'expand_left' must be between 0 and 0.4.\"}}");

        Throwable thrown = catchThrowable(this::callExpand);

        assertThat(thrown).isInstanceOf(ImageOutpaintError.class);
        ImageOutpaintError error = (ImageOutpaintError) thrown;
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(error.getMessage()).contains("HTTP 400");
        assertThat(error.getMessage()).contains("must be between 0 and 0.4");
    }

    @Test
    @DisplayName("网关 400 内容政策信号 → content_rejected（§5 分类保留）")
    void gateway400ContentPolicySignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"error\":{\"message\":\"content policy violation\"}}");

        Throwable thrown = catchThrowable(this::callExpand);

        assertThat(((ImageOutpaintError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("额度信号（余额不足文案）→ quota_exhausted（§5 分类保留）")
    void quotaSignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"message\":\"剩余额度不足\"}");

        Throwable thrown = catchThrowable(this::callExpand);

        assertThat(((ImageOutpaintError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("200 但 error 信封 → 业务失败（§5 分类）")
    void successEnvelopeErrorClassified() {
        responseJson.set("{\"error\":{\"message\":\"sensitive content detected\"}}");

        Throwable thrown = catchThrowable(this::callExpand);

        assertThat(((ImageOutpaintError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("200 但 result.image_url 缺失 → image_outpaint_failed 兜底")
    void missingResultUrlFallsBackToOutpaintFailed() {
        responseJson.set("{\"success\":true,\"result\":{}}");

        Throwable thrown = catchThrowable(this::callExpand);

        assertThat(((ImageOutpaintError) thrown).getCode())
                .isEqualTo(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED);
    }

    @Test
    @DisplayName("非 JSON 响应 → image_outpaint_failed 兜底")
    void invalidJsonFallsBackToOutpaintFailed() {
        responseJson.set("not-json<");

        Throwable thrown = catchThrowable(this::callExpand);

        assertThat(((ImageOutpaintError) thrown).getCode())
                .isEqualTo(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED);
    }
}
