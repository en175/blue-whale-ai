package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient.GeneratedImage;
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
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 端点选择钉桩测试（缺陷修复回归，对齐 TS 活路径 ark-image-provider.ts:123 / IKDMQE）：
 * 有无参考图都恒走 POST /v1/images/generations，参考图以 JSON image 字段透传
 * （单张=字符串、多张=数组）。jiekouAI 渠道（blue-whale-api highwayapi adaptor）
 * 设计上拒绝 /v1/images/edits，任何 edits 请求即回归。
 */
class NewApiImageClientEndpointTest {

    private HttpServer server;
    private final AtomicReference<String> lastPath = new AtomicReference<>();
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    private String baseUrl;

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            lastPath.set(exchange.getRequestURI().getPath());
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (InputStream in = exchange.getRequestBody()) {
                in.transferTo(buf);
            }
            lastBody.set(buf.toString(StandardCharsets.UTF_8));
            if (lastBody.get().contains("sleep-trig")) {
                try {
                    Thread.sleep(3000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
            byte[] resp = "{\"data\":[{\"url\":\"https://gen/x.png\"}]}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
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

    @Test
    @DisplayName("无参考图 → generations，body 无 image 字段")
    void noRefsUsesGenerationsWithoutImage() {
        List<GeneratedImage> images = new NewApiImageClient(baseUrl)
                .generate("t", "gpt-image-2-text-to-image", "猫", 1,
                        "1024x1024", null, false, false, List.of());

        assertThat(lastPath.get()).isEqualTo("/v1/images/generations");
        assertThat(lastBody.get()).doesNotContain("\"image\"");
        assertThat(images).hasSize(1);
    }

    @Test
    @DisplayName("单张参考图 → 仍 generations，image=字符串（非 edits multipart）")
    void singleRefKeepsGenerationsWithStringImage() {
        new NewApiImageClient(baseUrl).generate("t", "gpt-image-2-edit", "猫", 1,
                "1024x1024", null, false, false, List.of("https://a/1.png"));

        assertThat(lastPath.get()).isEqualTo("/v1/images/generations");
        assertThat(lastBody.get()).contains("\"image\":\"https://a/1.png\"");
    }

    @Test
    @DisplayName("多张参考图 → image=数组；字段序 image 在 quality 之后 n 之前（TS 逐字）")
    void multiRefsUseArrayImage() {
        new NewApiImageClient(baseUrl).generate("t", "nano-banana-2-i2i", "猫", 1,
                null, "hd", false, false, List.of("https://a/1.png", "https://a/2.png"));

        assertThat(lastPath.get()).isEqualTo("/v1/images/generations");
        String body = lastBody.get();
        assertThat(body).contains("\"image\":[\"https://a/1.png\",\"https://a/2.png\"]");
        assertThat(body.indexOf("\"quality\"")).isLessThan(body.indexOf("\"image\""));
        assertThat(body.indexOf("\"image\"")).isLessThan(body.indexOf("\"n\""));
    }

    @Test
    @DisplayName("读超时 → provider_timeout 终态不重试（2026-09-11 政策：重试=双扣风险）")
    void readTimeoutIsTerminalProviderTimeout() {
        NewApiImageClient client = new NewApiImageClient(baseUrl, 300);
        com.bluewhale.worker.domain.error.ImageProviderError error = null;
        try {
            client.generate("t", "nano-banana-2-i2i", "sleep-trig 猫", 1,
                    null, null, false, false, List.of());
        } catch (com.bluewhale.worker.domain.error.ImageProviderError e) {
            error = e;
        }
        assertThat(error).isNotNull();
        assertThat(error.getCode()).isEqualTo(
                com.bluewhale.worker.domain.error.GenerationError.ERROR_PROVIDER_TIMEOUT);
    }

    @Test
    @DisplayName("连接失败（请求未达上游，零扣费风险）→ provider_failed 瞬态可重试")
    void connectFailureIsTransientProviderFailed() {
        // 端口 1 无监听 → ConnectException（非 SocketTimeout）→ 通用 IO 分支归瞬态。
        NewApiImageClient client = new NewApiImageClient("http://127.0.0.1:1", 300);
        com.bluewhale.worker.domain.error.ImageProviderError error = null;
        try {
            client.generate("t", "nano-banana-2-i2i", "猫", 1,
                    null, null, false, false, List.of());
        } catch (com.bluewhale.worker.domain.error.ImageProviderError e) {
            error = e;
        }
        assertThat(error).isNotNull();
        assertThat(error.getCode()).isEqualTo(
                com.bluewhale.worker.domain.error.GenerationError.ERROR_PROVIDER_FAILED);
    }
}
