package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.SubmitResult;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoReference;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoSubmitInput;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * IKIZQ9：样片（Draft）× 九组模式钉桩测试——HTTP 钉桩断言出站请求体。
 *
 * <p>九组 = 文生（T）、图生首帧（I）、首尾帧（FL）、全能参考图片/纯音频/视频/混合
 * （R1–R4）、视频编辑（E）、视频延长（X），对应 IKIZH2 九组矩阵。每组用例数据
 * （脱敏 submit 输入、期望 Draft 出站体、成功终态轮询响应、费用投影 token）取自
 * {@code src/test/resources/video-sample-draft-pinned-cases.json}，断言四件事：
 * <ol>
 *   <li>Draft 请求：出站体与期望体逐字段一致（含顶层 {@code draft:true}、
 *       {@code metadata.resolution=480p}、content 的 role 映射；R3/R4 组钉
 *       {@code omni_reference_task_type=reference} 且用户比例/时长原样透传、E 组钉
 *       {@code omni=edit} 并按任务类型约束强制 {@code ratio=adaptive}/{@code duration=-1}、
 *       X 组钉 {@code omni=extend} 且时长透传用户所选——IKJ79A 删 TEMP FIX 后按任务类型分派）；</li>
 *   <li>成功终态：轮询观测 {@code succeeded}；</li>
 *   <li>480p 结果：出站体 resolution=480p，且钉桩响应内层上游回显 resolution=480p；</li>
 *   <li>费用投影：{@code usage.total_tokens} 被取出（结算的权威用量输入）。</li>
 * </ol>
 *
 * <p>⚠️ 钉桩≠供应商实测通过：九组数据按 IKIZH2 矩阵的<b>推断候选</b>构造，未发起任何
 * 付费上游调用；样片入口保持关闭，放行仍以九组真实两阶段回执为准（父规格 IKIZPZ
 * 「范围与门控」：任一组合未通过，不部分开放）。
 */
class NewApiVideoSampleDraftModePinnedTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private HttpServer server;
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    /** 当前组的钉桩数据（HttpServer 的 context 只能注册一次，按组切换响应内容）。 */
    private final AtomicReference<String> currentTaskId = new AtomicReference<>();
    private final AtomicReference<byte[]> currentPollResponse = new AtomicReference<>();
    private String baseUrl;

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/video/generations", exchange -> {
            if (exchange.getRequestURI().getPath().equals("/v1/video/generations")) {
                lastBody.set(readBody(exchange));
                byte[] resp = ("{\"task_id\":\"" + currentTaskId.get()
                        + "\",\"status\":\"queued\"}").getBytes(StandardCharsets.UTF_8);
                respond(exchange, resp);
                return;
            }
            respond(exchange, currentPollResponse.get());
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    static Stream<JsonNode> nineModeCases() throws Exception {
        try (InputStream in = NewApiVideoSampleDraftModePinnedTest.class
                .getResourceAsStream("/video-sample-draft-pinned-cases.json")) {
            List<JsonNode> cases = new ArrayList<>();
            for (JsonNode item : JSON.readTree(in)) {
                cases.add(item);
            }
            assertThat(cases).hasSize(9);
            return cases.stream();
        }
    }

    @TestFactory
    @DisplayName("IKIZQ9: 九组模式 Draft 出站与轮询（钉桩≠供应商实测通过）")
    Stream<DynamicTest> nineModesSubmitDraftAndPollSucceeded() throws Exception {
        return nineModeCases().map(testCase -> DynamicTest.dynamicTest(
                testCase.get("case_id").asText() + " · " + testCase.get("mode_zh").asText(),
                () -> runPinnedCase(testCase)));
    }

    private void runPinnedCase(JsonNode testCase) throws Exception {
        String caseId = testCase.get("case_id").asText();
        JsonNode input = testCase.get("submit_input");
        JsonNode expect = testCase.get("expect");
        String taskId = testCase.get("poll_response").get("data").get("task_id").asText();

        // 钉桩：submit 回该组任务 ID；poll 回该组成功终态（脱敏响应原文）。
        currentTaskId.set(taskId);
        currentPollResponse.set(JSON.writeValueAsBytes(testCase.get("poll_response")));

        VideoSubmitInput submitInput = new VideoSubmitInput(
                input.get("model").asText(),
                input.get("prompt").asText(),
                input.get("duration").asDouble(),
                "480p",
                input.get("ratio").asText(),
                textOrNull(input, "first_frame"),
                textOrNull(input, "last_frame"),
                referencesOf(input.get("references")),
                null,
                true, textOrNull(input, "video_task_type"));
        SubmitResult submit = new NewApiVideoClient(new UpstreamBaseUrl(baseUrl))
                .submit("t", submitInput);
        assertThat(submit.taskId()).isEqualTo(taskId);

        // 1) Draft 请求体整体比对（含 draft:true、resolution 480p、role 映射、按任务类型的出站约束）。
        JsonNode actualBody = JSON.readTree(lastBody.get());
        assertThat(actualBody)
                .as("组 %s（%s）Draft 出站请求体", caseId, testCase.get("mode_zh").asText())
                .isEqualTo(testCase.get("expected_submit_body"));

        // 2) 成功终态 + 4) 费用投影 + 可信 created_at。
        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", taskId);
        assertThat(observation.status()).isEqualTo(expect.get("status").asText());
        assertThat(observation.totalTokens()).isEqualTo(expect.get("total_tokens").asLong());
        assertThat(observation.upstreamCreatedAtMs())
                .isEqualTo(expect.get("upstream_created_at_ms").asLong());
        // 3) 480p 结果：钉桩响应内层上游回显 resolution=480p（出站侧已在请求体断言覆盖）。
        assertThat(testCase.get("poll_response").at("/data/data/resolution").asText())
                .isEqualTo("480p");
    }

    private static List<VideoReference> referencesOf(JsonNode refs) {
        List<VideoReference> out = new ArrayList<>();
        for (JsonNode ref : refs) {
            String role = ref.hasNonNull("role") ? ref.get("role").asText() : null;
            out.add(new VideoReference(ref.get("type").asText(), ref.get("url").asText(), role));
        }
        return out;
    }

    private static String textOrNull(JsonNode node, String field) {
        return node.hasNonNull(field) ? node.get(field).asText() : null;
    }

    private static String readBody(com.sun.net.httpserver.HttpExchange exchange) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (InputStream in = exchange.getRequestBody()) {
            in.transferTo(buf);
        }
        return buf.toString(StandardCharsets.UTF_8);
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, byte[] resp)
            throws IOException {
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, resp.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(resp);
        }
    }
}
