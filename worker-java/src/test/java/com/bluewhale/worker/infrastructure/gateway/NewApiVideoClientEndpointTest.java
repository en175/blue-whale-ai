package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.SubmitResult;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoReference;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoSubmitInput;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
 * 视频提交出站协议钉桩测试（IKFFWH）。
 * <p>
 * 覆盖 metadata.content 的角色映射与素材库引用载体：
 * <ul>
 *   <li>单数组路径：帧以带 role 的 reference 条目提交 → {@code role: first_frame/last_frame}；
 *       素材库引用 url 为 {@code asset://<素材ID>}，按 type 推导 reference_image/audio/video。</li>
 *   <li>旧字段路径：独立首尾帧字段照旧转 first_frame/last_frame（回归不动）。</li>
 * </ul>
 */
class NewApiVideoClientEndpointTest {

    private static final ObjectMapper JSON = new ObjectMapper();

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
            byte[] resp = "{\"task_id\":\"task-1\",\"status\":\"queued\"}"
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
    @DisplayName("单数组路径：素材库首帧与参考图以 asset:// + role 提交上游")
    void singleArrayMaterialRefsEmitAssetUriWithRole() throws Exception {
        VideoSubmitInput input = new VideoSubmitInput(
                "seedance-2", "改成蓝色发卡", 5.0, "720p", "16:9", null, null,
                List.of(
                        new VideoReference("image", "asset://asset-face-1", "first_frame"),
                        new VideoReference("image", "asset://asset-mat-1", null),
                        new VideoReference("audio", "asset://asset-audio-1", null)));

        SubmitResult result = new NewApiVideoClient(baseUrl).submit("t", input);

        assertThat(result.taskId()).isEqualTo("task-1");
        assertThat(lastPath.get()).isEqualTo("/v1/video/generations");

        JsonNode content = JSON.readTree(lastBody.get()).get("metadata").get("content");
        assertThat(content).hasSize(3);

        assertThat(content.get(0).get("role").asText()).isEqualTo("first_frame");
        assertThat(content.get(0).get("type").asText()).isEqualTo("image_url");
        assertThat(content.get(0).get("image_url").get("url").asText())
                .isEqualTo("asset://asset-face-1");

        // 素材库普通参考：url 走 asset:// 载体，role 按 type 推导（reference_image）。
        assertThat(content.get(1).get("role").asText()).isEqualTo("reference_image");
        assertThat(content.get(1).get("image_url").get("url").asText())
                .isEqualTo("asset://asset-mat-1");

        assertThat(content.get(2).get("role").asText()).isEqualTo("reference_audio");
        assertThat(content.get(2).get("type").asText()).isEqualTo("audio_url");
        assertThat(content.get(2).get("audio_url").get("url").asText())
                .isEqualTo("asset://asset-audio-1");
    }

    @Test
    @DisplayName("回归：旧字段路径的独立首尾帧仍转 first_frame/last_frame，本地参考 role 不变")
    void legacyFrameFieldsKeepRoles() throws Exception {
        VideoSubmitInput input = new VideoSubmitInput(
                "seedance-2", "一只猫在跑步", 5.0, "720p", "16:9",
                "https://tos.test/first.png", "https://tos.test/last.png",
                List.of(new VideoReference("image", "https://tos.test/ref.png", null)));

        new NewApiVideoClient(baseUrl).submit("t", input);

        JsonNode content = JSON.readTree(lastBody.get()).get("metadata").get("content");
        assertThat(content).hasSize(3);
        assertThat(content.get(0).get("role").asText()).isEqualTo("first_frame");
        assertThat(content.get(0).get("image_url").get("url").asText())
                .isEqualTo("https://tos.test/first.png");
        assertThat(content.get(1).get("role").asText()).isEqualTo("last_frame");
        assertThat(content.get(2).get("role").asText()).isEqualTo("reference_image");
    }
}
