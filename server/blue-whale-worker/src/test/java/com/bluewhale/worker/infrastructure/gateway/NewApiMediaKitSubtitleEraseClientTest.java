package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSubtitleEraseError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSubtitleEraseClient.SubtitleEraseTaskObservation;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

class NewApiMediaKitSubtitleEraseClientTest {

    private HttpServer server;
    private final AtomicReference<String> lastPath = new AtomicReference<>();
    private final AtomicReference<String> lastMethod = new AtomicReference<>();
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    private final AtomicReference<String> lastAuthorization = new AtomicReference<>();
    private final AtomicReference<String> lastClientSystem = new AtomicReference<>();
    private final AtomicReference<String> lastTraceId = new AtomicReference<>();
    private final AtomicReference<Integer> lastStatus = new AtomicReference<>(200);
    private final AtomicReference<String> responseJson = new AtomicReference<>();
    private String baseUrl;

    private static Map<String, Object> box(double x1, double y1, double x2, double y2) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put(VideoSubtitleEraseContract.BOX_KEY_TOP_LEFT_X, x1);
        map.put(VideoSubtitleEraseContract.BOX_KEY_TOP_LEFT_Y, y1);
        map.put(VideoSubtitleEraseContract.BOX_KEY_BOTTOM_RIGHT_X, x2);
        map.put(VideoSubtitleEraseContract.BOX_KEY_BOTTOM_RIGHT_Y, y2);
        return map;
    }

    @BeforeEach
    void startServer() throws Exception {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-erase-video-subtitle-pro-123\","
                + "\"request_id\":\"req-1\"}");
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            lastPath.set(exchange.getRequestURI().getPath());
            lastMethod.set(exchange.getRequestMethod());
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

    private String callSubmit(String detectMode, List<Map<String, Object>> boxes) {
        return new NewApiMediaKitSubtitleEraseClient(new UpstreamBaseUrl(baseUrl)).submit(
                "sk-token", "https://example.com/src.mp4", detectMode, boxes);
    }


    @Test
    @DisplayName("无框 subtitle_smart：路径 + 对客模型名 + mode=Subtitle + 固定 v5/Quality，不发 erase_ratio_location 键")
    void submitNoBoxesSubtitleSmart() {
        String taskId = callSubmit("subtitle_smart", List.of());

        assertThat(taskId).isEqualTo("amk-tool-erase-video-subtitle-pro-123");
        assertThat(lastPath.get()).isEqualTo("/v1/mediakit/erase-video-subtitle-pro");
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"mediakit-erase-video-subtitle-pro\"");
        assertThat(body).contains("\"video_url\":\"https://example.com/src.mp4\"");
        assertThat(body).contains("\"mode\":\"Subtitle\"");
        assertThat(body).contains("\"model_version\":\"v5\"");
        assertThat(body).contains("\"output_encode_mode\":\"Quality\"");
        assertThat(body).doesNotContain("erase_ratio_location");
        assertThat(body).doesNotContain("time_segment_filter");
        assertThat(body).doesNotContain("subtitle_filter");
    }

    @Test
    @DisplayName("有框 subtitle_smart：mode=Subtitle + erase_ratio_location 归一化框数组（官方键名透传）")
    void submitWithBoxesSubtitleSmart() {
        callSubmit("subtitle_smart", List.of(box(0.1, 0.8, 0.9, 0.95)));

        String body = lastBody.get();
        assertThat(body).contains("\"mode\":\"Subtitle\"");
        assertThat(body).contains("\"erase_ratio_location\":[{\"top_left_x\":0.1,\"top_left_y\":0.8,"
                + "\"bottom_right_x\":0.9,\"bottom_right_y\":0.95}]");
    }

    @Test
    @DisplayName("无框 text_full：mode=Text（全画面文字检测），不发 erase_ratio_location 键")
    void submitNoBoxesTextFull() {
        callSubmit("text_full", List.of());

        String body = lastBody.get();
        assertThat(body).contains("\"mode\":\"Text\"");
        assertThat(body).doesNotContain("erase_ratio_location");
    }

    @Test
    @DisplayName("有框 text_full：mode=Text + 框数组（仅框内执行擦除的官方联动）")
    void submitWithBoxesTextFull() {
        callSubmit("text_full", List.of(box(0.0, 0.0, 1.0, 0.2)));

        String body = lastBody.get();
        assertThat(body).contains("\"mode\":\"Text\"");
        assertThat(body).contains("\"top_left_x\":0.0");
        assertThat(body).contains("\"bottom_right_y\":0.2");
    }

    @Test
    @DisplayName("鉴权与生成家族同构：Bearer + X-Client-System: bluewhale + X-Trace-Id")
    void standardHeadersSameAsGenerationFamily() {
        callSubmit("subtitle_smart", List.of());

        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
    }

    @Test
    @DisplayName("submit 检测模式枚举外 → invalid_input（兜底防御）")
    void submitUnknownDetectMode_invalidInput() {
        Throwable thrown = catchThrowable(() -> callSubmit("subtitle_pro", List.of()));

        assertThat(((VideoSubtitleEraseError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_INVALID_INPUT);
    }


    @Test
    @DisplayName("网关 400（success=false 且不扣费）→ 抛错，上游可读原因透传到 message")
    void gateway400TransportsUpstreamReason() {
        lastStatus.set(400);
        responseJson.set("{\"success\":false,\"task_id\":\"\",\"request_id\":\"req-2\","
                + "\"error\":{\"code\":\"InvalidParameter\",\"type\":\"BadRequest\","
                + "\"message\":\"The parameter `bottom_right_x` must be less than or equal to 1.\","
                + "\"param\":\"erase_ratio_location[0].bottom_right_x\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("subtitle_smart", List.of()));

        assertThat(thrown).isInstanceOf(VideoSubtitleEraseError.class);
        assertThat(((VideoSubtitleEraseError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(thrown.getMessage()).contains("HTTP 400");
        assertThat(thrown.getMessage()).contains("must be less than or equal to 1");
    }

    @Test
    @DisplayName("网关 400 内容政策信号 → content_rejected（§5 分类保留）")
    void gateway400ContentPolicySignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"error\":{\"message\":\"content policy violation\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("subtitle_smart", List.of()));

        assertThat(((VideoSubtitleEraseError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("网关 400 额度信号 → quota_exhausted（§5 分类保留）")
    void gateway400QuotaSignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"message\":\"剩余额度不足\"}");

        Throwable thrown = catchThrowable(() -> callSubmit("subtitle_smart", List.of()));

        assertThat(((VideoSubtitleEraseError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("200 但缺 task_id → 1043 兜底")
    void missingTaskIdFallsBack() {
        responseJson.set("{\"success\":true,\"request_id\":\"req-3\"}");

        Throwable thrown = catchThrowable(() -> callSubmit("subtitle_smart", List.of()));

        assertThat(((VideoSubtitleEraseError) thrown).getCode())
                .isEqualTo(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED);
    }

    @Test
    @DisplayName("非 JSON 响应 → 1043 兜底")
    void invalidJsonFallsBack() {
        responseJson.set("not-json<");

        Throwable thrown = catchThrowable(() -> callSubmit("subtitle_smart", List.of()));

        assertThat(((VideoSubtitleEraseError) thrown).getCode())
                .isEqualTo(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED);
    }


    @Test
    @DisplayName("poll completed：GET 查询路径拼 taskId，解析 result.video_url 与 duration 秒")
    void pollCompletedParsesResult() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-task-1\",\"status\":\"completed\","
                + "\"result\":{\"video_url\":\"https://example.volcvideo.com/output.mp4?auth_key=...\","
                + "\"duration\":180.5},\"expires_at\":1777464650,\"created_at\":1777291767,"
                + "\"finished_at\":1777291851,\"request_id\":\"req-4\"}");

        SubtitleEraseTaskObservation observation =
                new NewApiMediaKitSubtitleEraseClient(new UpstreamBaseUrl(baseUrl)).poll("sk-token", "amk-task-1");

        assertThat(lastMethod.get()).isEqualTo("GET");
        assertThat(lastPath.get()).isEqualTo("/v1/mediakit/tasks/amk-task-1");
        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.videoUrl())
                .isEqualTo("https://example.volcvideo.com/output.mp4?auth_key=...");
        assertThat(observation.durationSec()).isEqualTo(180.5);
    }

    @Test
    @DisplayName("poll 中间态（running）→ processing，无结果字段")
    void pollRunningIsProcessing() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-task-1\",\"status\":\"running\","
                + "\"request_id\":\"req-5\"}");

        SubtitleEraseTaskObservation observation =
                new NewApiMediaKitSubtitleEraseClient(new UpstreamBaseUrl(baseUrl)).poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("processing");
        assertThat(observation.videoUrl()).isNull();
    }

    @Test
    @DisplayName("poll failed → failed + 上游错误码与可读原因（透传给前端投影）")
    void pollFailedCarriesUpstreamError() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-task-1\",\"status\":\"failed\","
                + "\"error\":{\"code\":\"VideoParseFailed\",\"message\":\"输入视频解析失败\"}}");

        SubtitleEraseTaskObservation observation =
                new NewApiMediaKitSubtitleEraseClient(new UpstreamBaseUrl(baseUrl)).poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.upstreamCode()).isEqualTo("VideoParseFailed");
        assertThat(observation.upstreamMessage()).contains("输入视频解析失败");
    }

    @Test
    @DisplayName("poll 网关 data 信封 → 解包后仍取到 status / result")
    void pollUnwrapsDataEnvelope() {
        responseJson.set("{\"data\":{\"task_id\":\"amk-task-1\",\"status\":\"completed\","
                + "\"result\":{\"video_url\":\"https://volc/out.mp4\",\"duration\":12.0}}}");

        SubtitleEraseTaskObservation observation =
                new NewApiMediaKitSubtitleEraseClient(new UpstreamBaseUrl(baseUrl)).poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.videoUrl()).isEqualTo("https://volc/out.mp4");
    }

    @Test
    @DisplayName("poll HTTP 500 → provider_failed 且 cause 携带状态（processor 判瞬时重排）")
    void pollServerErrorCarriesStatus() {
        lastStatus.set(500);
        responseJson.set("{\"message\":\"upstream busy\"}");

        Throwable thrown = catchThrowable(() ->
                new NewApiMediaKitSubtitleEraseClient(new UpstreamBaseUrl(baseUrl)).poll("sk-token", "amk-task-1"));

        assertThat(thrown).isInstanceOf(VideoSubtitleEraseError.class);
        VideoSubtitleEraseError error = (VideoSubtitleEraseError) thrown;
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(error.getCause()).isInstanceOf(NewApiVideoClient.HttpStatusException.class);
        assertThat(((NewApiVideoClient.HttpStatusException) error.getCause()).getStatus()).isEqualTo(500);
    }

    @Test
    @DisplayName("poll 响应缺 status → provider_failed（非瞬时，不静默当 processing）")
    void pollMissingStatusFails() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-task-1\"}");

        Throwable thrown = catchThrowable(() ->
                new NewApiMediaKitSubtitleEraseClient(new UpstreamBaseUrl(baseUrl)).poll("sk-token", "amk-task-1"));

        assertThat(((VideoSubtitleEraseError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }
}
