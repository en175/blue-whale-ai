package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.infrastructure.gateway.NewApiMaterialClient.MaterialStatusResult;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class NewApiMaterialClientTest {

    private HttpServer server;
    private final AtomicReference<String> lastPath = new AtomicReference<>();
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    private final AtomicReference<String> lastAuthorization = new AtomicReference<>();
    private final AtomicReference<String> lastClientSystem = new AtomicReference<>();
    private final AtomicReference<String> lastTraceId = new AtomicReference<>();
    private final AtomicReference<Integer> responseCode = new AtomicReference<>(200);
    private final AtomicReference<String> responseBody = new AtomicReference<>("{}");
    private String baseUrl;

    @BeforeEach
    void startServer() throws Exception {
        responseCode.set(200);
        responseBody.set("""
                {"ResponseMetadata":{"RequestId":"req-1","Action":"GetAsset"},
                 "Result":{"Id":"asset-abc","Status":"Active"}}""");
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/material/GetAsset", exchange -> {
            lastPath.set(exchange.getRequestURI().getPath());
            lastBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            lastAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            lastClientSystem.set(exchange.getRequestHeaders().getFirst("X-Client-System"));
            lastTraceId.set(exchange.getRequestHeaders().getFirst("X-Trace-Id"));
            byte[] bytes = responseBody.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(responseCode.get(), bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    @DisplayName("请求形状：路径 + body + 标准头三元组；Status 透传")
    void sendsExpectedRequestAndParsesStatus() {
        MaterialStatusResult result = new NewApiMaterialClient(new UpstreamBaseUrl(baseUrl))
                .getAsset("sk-user9", "asset-abc");

        assertThat(lastPath.get()).isEqualTo("/api/material/GetAsset");
        assertThat(lastBody.get()).isEqualTo("{\"Id\":\"asset-abc\"}");
        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-user9");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
        assertThat(result).isNotNull();
        assertThat(result.status()).isEqualTo("Active");
        assertThat(result.errorCode()).isNull();
    }

    @Test
    @DisplayName("Failed 带 Error 信封：Code/Message 原文带回（不映射、不解释）")
    void carriesRawErrorFields() {
        responseBody.set("""
                {"Result":{"Id":"asset-abc","Status":"Failed",
                 "Error":{"Code":"InvalidParameter","Message":"人脸不清晰"}}}""");

        MaterialStatusResult result = new NewApiMaterialClient(new UpstreamBaseUrl(baseUrl))
                .getAsset("sk-user9", "asset-abc");

        assertThat(result).isNotNull();
        assertThat(result.status()).isEqualTo("Failed");
        assertThat(result.errorCode()).isEqualTo("InvalidParameter");
        assertThat(result.errorMessage()).isEqualTo("人脸不清晰");
    }

    @Test
    @DisplayName("非 2xx → null（本轮未知，不写库）")
    void non2xxReturnsNull() {
        responseCode.set(502);
        responseBody.set("{\"ResponseError\":{\"Code\":\"BadGateway\"}}");

        assertThat(new NewApiMaterialClient(new UpstreamBaseUrl(baseUrl)).getAsset("sk-user9", "asset-abc")).isNull();
    }

    @Test
    @DisplayName("只有 ResponseError 没有 Result → null")
    void responseErrorEnvelopeReturnsNull() {
        responseBody.set("{\"ResponseError\":{\"Code\":\"InvalidAction\",\"Message\":\"素材不存在\"}}");

        assertThat(new NewApiMaterialClient(new UpstreamBaseUrl(baseUrl)).getAsset("sk-user9", "asset-abc")).isNull();
    }

    @Test
    @DisplayName("非 JSON 响应 → null")
    void nonJsonReturnsNull() {
        responseBody.set("<html>502</html>");

        assertThat(new NewApiMaterialClient(new UpstreamBaseUrl(baseUrl)).getAsset("sk-user9", "asset-abc")).isNull();
    }

    @Test
    @DisplayName("Result 缺 Status → null（不与「Processing」混淆）")
    void missingStatusReturnsNull() {
        responseBody.set("{\"Result\":{\"Id\":\"asset-abc\"}}");

        assertThat(new NewApiMaterialClient(new UpstreamBaseUrl(baseUrl)).getAsset("sk-user9", "asset-abc")).isNull();
    }

    @Test
    @DisplayName("token/materialId 为空是调用方 bug，直接抛（不静默成「本轮未知」）")
    void blankArgumentsThrow() {
        NewApiMaterialClient client = new NewApiMaterialClient(new UpstreamBaseUrl(baseUrl));

        assertThatThrownBy(() -> client.getAsset("", "asset-abc"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> client.getAsset("sk-user9", " "))
                .isInstanceOf(IllegalArgumentException.class);
    }
    @Test
    @DisplayName("上游指认素材不可用（NotFound.asset_id / InvalidParameter.AssetID）→ 收敛为 Failed")
    void materialLevelRejectionBecomesFailed() {
        responseCode.set(404);
        responseBody.set("""
                {"ResponseError":{"Code":"NotFound.asset_id",
                 "Message":"The specified asset asset-x is not found."}}""");

        MaterialStatusResult result = new NewApiMaterialClient(new UpstreamBaseUrl(baseUrl))
                .getAsset("sk-user9", "asset-x");

        assertThat(result).isNotNull();
        assertThat(result.status()).isEqualTo("Failed");
        assertThat(result.errorCode()).isEqualTo("NotFound.asset_id");
        assertThat(result.errorMessage()).contains("not found");
    }

    @Test
    @DisplayName("其余非 2xx（鉴权/限流/5xx）→ 仍是 null，不把账号级故障误标成素材失败")
    void otherNon2xxStaysUnknown() {
        for (String body : new String[] {
                "{\"error\":{\"code\":\"\",\"message\":\"Invalid token\"}}",
                "{\"ResponseError\":{\"Code\":\"FeatureNotEnabled\"}}",
                "{\"ResponseError\":{\"Code\":\"LimitExceeded\"}}",
                "{\"ResponseError\":{\"Code\":\"InternalError\"}}",
                "{\"ResponseError\":{\"Code\":\"NotFound\"}}",
        }) {
            responseCode.set(401);
            responseBody.set(body);
            assertThat(new NewApiMaterialClient(new UpstreamBaseUrl(baseUrl)).getAsset("sk-user9", "asset-x"))
                    .as("body=%s", body)
                    .isNull();
        }
    }
}
