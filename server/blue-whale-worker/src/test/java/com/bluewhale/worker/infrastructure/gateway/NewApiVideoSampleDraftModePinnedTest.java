package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
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

class NewApiVideoSampleDraftModePinnedTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private HttpServer server;
    private final AtomicReference<String> lastBody = new AtomicReference<>();
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

        JsonNode actualBody = JSON.readTree(lastBody.get());
        assertThat(actualBody)
                .as("组 %s（%s）Draft 出站请求体", caseId, testCase.get("mode_zh").asText())
                .isEqualTo(testCase.get("expected_submit_body"));

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", taskId);
        assertThat(observation.status()).isEqualTo(expect.get("status").asText());
        assertThat(observation.totalTokens()).isEqualTo(expect.get("total_tokens").asLong());
        assertThat(observation.upstreamCreatedAtMs())
                .isEqualTo(expect.get("upstream_created_at_ms").asLong());
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
