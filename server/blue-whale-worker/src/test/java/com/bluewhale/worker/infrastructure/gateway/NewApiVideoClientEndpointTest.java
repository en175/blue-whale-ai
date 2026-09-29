package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.SubmitResult;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoReference;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoSubmitInput;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import okhttp3.OkHttpClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
                        new VideoReference("audio", "asset://asset-audio-1", null)),
                null);

        SubmitResult result = new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", input);

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
    @DisplayName("IKG0LP：generateAudio true/false 下发 metadata.generate_audio；null 则完全不下发")
    void generateAudioDispatchedOnlyWhenPresent() throws Exception {
        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "seedance-2", "一只猫在跑步", 5.0, "720p", "16:9",
                null, null, List.of(), Boolean.TRUE));
        assertThat(JSON.readTree(lastBody.get()).get("metadata").get("generate_audio").asBoolean())
                .isTrue();

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "seedance-2", "一只猫在跑步", 5.0, "720p", "16:9",
                null, null, List.of(), Boolean.FALSE));
        assertThat(JSON.readTree(lastBody.get()).get("metadata").get("generate_audio").asBoolean())
                .isFalse();

        // 能力位不允许（或旧快照）→ null → 字段缺席，维持上游默认
        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "seedance-2", "一只猫在跑步", 5.0, "720p", "16:9",
                null, null, List.of(), null));
        assertThat(JSON.readTree(lastBody.get()).get("metadata").has("generate_audio")).isFalse();
    }

    @Test
    @DisplayName("TEMP FIX：doubao-seedance-2-5 带参考视频 → duration 强制 -1、ratio 强制 adaptive")
    void seedance25WithVideoReferenceForcesAdaptiveAndAutoDuration() throws Exception {
        VideoSubmitInput input = new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "把杯子换成红色", 5.0, "720p", "16:9", null, null,
                List.of(new VideoReference("video", "https://tos.test/ref.mp4", null)),
                null);

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", input);

        JsonNode body = JSON.readTree(lastBody.get());
        assertThat(body.get("duration").asDouble()).isEqualTo(-1.0);
        assertThat(body.get("metadata").get("duration").asDouble()).isEqualTo(-1.0);
        assertThat(body.get("metadata").get("ratio").asText()).isEqualTo("adaptive");
        // 其余字段不受影响
        assertThat(body.get("model").asText()).isEqualTo("doubao-seedance-2-5-260628");
        assertThat(body.get("metadata").get("resolution").asText()).isEqualTo("720p");
    }

    @Test
    @DisplayName("TEMP FIX 边界：无参考视频的 seedance-2-5、或其他模型带参考视频 → 原值不动")
    void seedance25OverrideOnlyWhenVideoReferencePresent() throws Exception {
        // 只有图片参考（含首尾帧）→ 不触发
        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "一只猫在跑步", 5.0, "720p", "16:9", null, null,
                List.of(new VideoReference("image", "https://tos.test/a.png", null)),
                null));
        JsonNode imageOnly = JSON.readTree(lastBody.get());
        assertThat(imageOnly.get("duration").asDouble()).isEqualTo(5.0);
        assertThat(imageOnly.get("metadata").get("ratio").asText()).isEqualTo("16:9");

        // 其他 model id 带参考视频 → 不触发
        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "doubao-seedance-2-0-260128", "把杯子换成红色", 5.0, "720p", "16:9", null, null,
                List.of(new VideoReference("video", "https://tos.test/ref.mp4", null)),
                null));
        JsonNode otherModel = JSON.readTree(lastBody.get());
        assertThat(otherModel.get("duration").asDouble()).isEqualTo(5.0);
        assertThat(otherModel.get("metadata").get("ratio").asText()).isEqualTo("16:9");
    }

    @Test
    @DisplayName("回归：旧字段路径的独立首尾帧仍转 first_frame/last_frame，本地参考 role 不变")
    void legacyFrameFieldsKeepRoles() throws Exception {
        VideoSubmitInput input = new VideoSubmitInput(
                "seedance-2", "一只猫在跑步", 5.0, "720p", "16:9",
                "https://tos.test/first.png", "https://tos.test/last.png",
                List.of(new VideoReference("image", "https://tos.test/ref.png", null)),
                null);

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", input);

        JsonNode content = JSON.readTree(lastBody.get()).get("metadata").get("content");
        assertThat(content).hasSize(3);
        assertThat(content.get(0).get("role").asText()).isEqualTo("first_frame");
        assertThat(content.get(0).get("image_url").get("url").asText())
                .isEqualTo("https://tos.test/first.png");
        assertThat(content.get(1).get("role").asText()).isEqualTo("last_frame");
        assertThat(content.get(2).get("role").asText()).isEqualTo("reference_image");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   ", " \t "})
    @DisplayName("IKIDEP: 成功响应的缺失或空白 URL 原样交给重试处理器判断")
    void pollSucceededWithBlankUrl(String resultUrl) throws Exception {
        server.createContext("/v1/video/generations/task-blank", exchange -> {
            String urlField = resultUrl == null ? "" : "\"url\":" + JSON.writeValueAsString(resultUrl) + ",";
            byte[] resp = ("{\"task_id\":\"task-blank\",\"status\":\"SUCCESS\"," + urlField
                    + "\"progress\":100}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation = new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-blank");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.url()).isEqualTo(resultUrl);
    }

    @Test
    @DisplayName("上游真实 token：实测信封 data.usage.total_tokens 被取出（结算的权威用量）")
    void pollExtractsUpstreamTotalTokens() throws Exception {
        // 逐字取自线上实测（2026-09-25，task_FIwJhbur…，doubao-seedance-2-0-fast 480p 16:9 4s）：
        // 外层信封与内层任务结果**各带一份** usage，外层优先。
        server.createContext("/v1/video/generations/task-tokens", exchange -> {
            byte[] resp = ("{\"code\":\"success\",\"data\":{\"task_id\":\"task-tokens\","
                    + "\"status\":\"SUCCESS\",\"result_url\":\"https://tos/v.mp4\","
                    + "\"usage\":{\"total_tokens\":40594,\"completion_tokens\":40594},"
                    + "\"data\":{\"usage\":{\"total_tokens\":40594,\"completion_tokens\":40594},"
                    + "\"framespersecond\":24,\"resolution\":\"480p\"}}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-tokens");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.totalTokens()).isEqualTo(40_594L);
    }

    @Test
    @DisplayName("token 兜底：只有 completion_tokens、或只有字符串形态、或扁平 usage_total_tokens 都读得到")
    void pollTokenFallbacks() throws Exception {
        server.createContext("/v1/video/generations/task-completion-only", exchange -> {
            byte[] resp = ("{\"task_id\":\"task-completion-only\",\"status\":\"SUCCESS\","
                    + "\"usage\":{\"completion_tokens\":108900}}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });
        // ADR-0063 记的 new-api Task 信封形态：token 字段**扁平**（不带 usage 对象），
        // 且值可能是字符串（上游 flexInt 序列化）。只认一种形态就会静默丢 token。
        server.createContext("/v1/video/generations/task-flat", exchange -> {
            byte[] resp = ("{\"task_id\":\"task-flat\",\"status\":\"SUCCESS\","
                    + "\"usage_total_tokens\":\"46875000\"}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });
        server.createContext("/v1/video/generations/task-none", exchange -> {
            byte[] resp = "{\"task_id\":\"task-none\",\"status\":\"SUCCESS\"}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        NewApiVideoClient client = new NewApiVideoClient(new UpstreamBaseUrl(baseUrl));
        assertThat(client.poll("t", "task-completion-only").totalTokens()).isEqualTo(108_900L);
        assertThat(client.poll("t", "task-flat").totalTokens()).isEqualTo(46_875_000L);
        // ★ 取不到就是 null，**不是 0**：0 会被下游当成「报过、且真的是 0」→ 免费生成
        assertThat(client.poll("t", "task-none").totalTokens()).isNull();
    }

    @Test
    @DisplayName("IKFL53: poll FAILURE + 顶层 fail_reason 版权拒绝 → content_rejected_reference + 上游原文透出")
    void pollTopLevelFailReasonCopyrightMapsToContentRejected() throws Exception {
        String copyrightText = "The request failed because the output video may be related to copyright restrictions. Request id: req-2048";
        server.createContext("/v1/video/generations/task-2048", exchange -> {
            byte[] resp = ("{\"task_id\":\"task-2048\",\"status\":\"FAILURE\"," +
                    "\"fail_reason\":\"" + copyrightText + "\"}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-2048");
        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.error()).isNotNull();
        assertThat(observation.error().code()).isEqualTo("content_rejected_reference");
        // message 保留上游原文，不再默认「视频生成失败」
        assertThat(observation.error().message()).contains("copyright restrictions");
    }

    @Test
    @DisplayName("IKFL53: poll data.error 输出敏感码 → content_rejected(1018)")
    void pollDataErrorOutputSensitiveMapsToContentRejected() throws Exception {
        server.createContext("/v1/video/generations/task-sensitive", exchange -> {
            byte[] resp = ("{\"task_id\":\"task-sensitive\",\"status\":\"FAILURE\"," +
                    "\"error\":{\"code\":\"OutputVideoSensitiveContentDetected.PolicyViolation\"," +
                    "\"message\":\"The output video contains sensitive content.\"}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-sensitive");
        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.error()).isNotNull();
        assertThat(observation.error().code()).isEqualTo("content_rejected");
        assertThat(observation.error().message()).contains("sensitive content");
    }

    @Test
    @DisplayName("IKFL53: poll data.error + 顶层 fail_reason 双源合并 → 版权1038 优先于 quota")
    void pollMergedTwoSourceSignalCopyrightWins() throws Exception {
        server.createContext("/v1/video/generations/task-merge", exchange -> {
            byte[] resp = ("{\"task_id\":\"task-merge\",\"status\":\"FAILURE\"," +
                    "\"fail_reason\":\"This content violates copyright restrictions\"," +
                    "\"error\":{\"code\":\"account_balance_insufficient\",\"message\":\"余额不足\"}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-merge");
        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.error()).isNotNull();
        // 合并信号里 copyright 优先于 quota → 1038
        assertThat(observation.error().code()).isEqualTo("content_rejected_reference");
    }

    @Test
    @DisplayName("IKJ80M: submit 超时 ≥120s 且经 submitClient 配置生效（网关带视频参考提交实测 ~51s）")
    void submitTimeoutAtLeast120sAppliedToClient() throws Exception {
        Field timeoutField = NewApiVideoClient.class.getDeclaredField("SUBMIT_TIMEOUT_MS");
        timeoutField.setAccessible(true);
        int submitTimeoutMs = timeoutField.getInt(null);

        // 旧值 30s 会误杀带视频参考的提交；120s 为实测 ~51s 留足余量
        assertThat(submitTimeoutMs).isGreaterThanOrEqualTo(120_000);

        // 常量必须真实落到 submitClient 的 read/write 超时（防构造函数改丢）
        Field clientField = NewApiVideoClient.class.getDeclaredField("submitClient");
        clientField.setAccessible(true);
        OkHttpClient submitClient =
                (OkHttpClient) clientField.get(new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)));
        assertThat(submitClient.readTimeoutMillis()).isEqualTo(submitTimeoutMs);
        assertThat(submitClient.writeTimeoutMillis()).isEqualTo(submitTimeoutMs);
    }

    @Test
    @DisplayName("IKJ80P: submit 读超时 → VideoProviderError 携带 SocketTimeoutException cause（孤儿判定信号）")
    void submitReadTimeoutCarriesSocketTimeoutCause() throws Exception {
        // 模拟「提交超时但网关随后成功」：响应延迟到客户端放弃之后才发出（网关侧建单仍完成）
        server.createContext("/v1/video/generations", exchange -> {
            try {
                Thread.sleep(1_500);
                byte[] resp = "{\"task_id\":\"task-late\",\"status\":\"queued\"}"
                        .getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, resp.length);
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(resp);
                }
            } catch (Exception ignored) {
                // 客户端已超时断开，写出失败是预期
            }
        });

        NewApiVideoClient client = new NewApiVideoClient(new UpstreamBaseUrl(baseUrl));
        // 测试时限内复现读超时：把 submitClient 换成 300ms 短超时实例（生产 120s 不动）
        Field clientField = NewApiVideoClient.class.getDeclaredField("submitClient");
        clientField.setAccessible(true);
        clientField.set(client, NewApiHttpSupport.buildClient(1_000, 300, 300));

        assertThatThrownBy(() -> client.submit("t", new VideoSubmitInput(
                "seedance-2", "一只猫在跑步", 5.0, "720p", "16:9",
                null, null, List.of(), null)))
                .isInstanceOf(VideoProviderError.class)
                .hasMessage("new-api 视频提交超时")
                // IKJ80P：cause 链是 processor 侧「疑似上游已建单孤儿」的唯一机器可读信号
                .hasCauseInstanceOf(java.net.SocketTimeoutException.class);
    }
}
