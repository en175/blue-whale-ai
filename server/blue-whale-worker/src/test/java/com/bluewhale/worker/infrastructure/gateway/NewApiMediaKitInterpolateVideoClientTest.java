package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoFrameInterpolationError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitInterpolateVideoClient.InterpolateVideoTaskObservation;
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
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * NewApiMediaKitInterpolateVideoClient 接口级 mock 网关测试（IKHLKJ，父需求 IKHLES；
 * 以 {@code NewApiMediaKitEnhanceVideoClientTest} 的 HttpServer 假网关模式为模板）。
 * <p>
 * 覆盖：出站仅 model + video_url + **整型 fps**（无 resolution / bitrate_level / 其余官方可选
 * 参数）、三档帧率整型透传、标准请求头三元组、submit 响应 task_id 解析与缺失兜底、§5 错误分类
 * 与上游原因透传、poll 端点路径与三态解析（completed 解析官方 result 四键 video_url / duration /
 * resolution / fps）、HTTP 错误携带状态（瞬时判定输入）。不连真实网关。
 * <p>
 * 参数名以官方参数级 API 参考页 Body 参数节为准（契约票 IKHLK3 已冻结口径）。
 */
class NewApiMediaKitInterpolateVideoClientTest {

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

    @BeforeEach
    void startServer() throws Exception {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-video-frame-interpolation-987654\","
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

    private String callSubmit(int fps) {
        return new NewApiMediaKitInterpolateVideoClient(baseUrl).submit(
                "sk-token", "https://example.com/src.mp4", fps);
    }

    // ========== submit：出站映射（官方参数级 API 参考页 Body 参数节 + 本仓参数裁剪） ==========

    @Test
    @DisplayName("提交：官方逐字路径 + video_url + 整型 fps 透传，不发出任何其他参数")
    void submitMapsOfficialParameters() {
        String taskId = callSubmit(60);

        assertThat(taskId).isEqualTo("amk-tool-video-frame-interpolation-987654");
        assertThat(lastPath.get()).isEqualTo(VideoFrameInterpolationContract.SUBMIT_PATH);
        assertThat(lastMethod.get()).isEqualTo("POST");
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"mediakit-video-frame-interpolation\"");
        assertThat(body).contains("\"video_url\":\"https://example.com/src.mp4\"");
        // 整型直传（无小数点）：fps=60 序列化为 60 而非 60.0
        assertThat(body).contains("\"fps\":60");
        assertThat(body).doesNotContain("\"fps\":60.0");
        // 插帧无档位概念（HD 的 resolution / bitrate_level 不复制）
        assertThat(body).doesNotContain("resolution");
        assertThat(body).doesNotContain("bitrate");
        // 官方可选参数一律不发（产物存储 / 幂等 / 回调 / 队列）
        assertThat(body).doesNotContain("media_output_destination");
        assertThat(body).doesNotContain("client_token");
        assertThat(body).doesNotContain("callback");
        assertThat(body).doesNotContain("queue_id");
    }

    @Test
    @DisplayName("三档帧率 30 / 60 / 120 原样整型透传（契约 VIDEO_FRAME_INTERPOLATION_FPS_VALUES）")
    void submitAllFpsValuesPassThroughAsIntegers() {
        for (Integer fps : VideoFrameInterpolationContract.SUPPORTED_FPS) {
            callSubmit(fps);
            assertThat(lastBody.get())
                    .as("fps=%s 应整型透传", fps)
                    .contains("\"fps\":" + fps)
                    .doesNotContain("\"fps\":" + fps + ".0");
        }
    }

    @Test
    @DisplayName("鉴权与生成家族同构：Bearer + X-Client-System: bluewhale + X-Trace-Id")
    void standardHeadersSameAsGenerationFamily() {
        callSubmit(30);

        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
    }

    @Test
    @DisplayName("submit 帧率枚举外（官方合法但产品未暴露的 45、越界值）→ invalid_input（兜底防御）")
    void submitUnknownFps_invalidInput() {
        for (int fps : new int[]{45, 12, 121, 0, -60}) {
            Throwable thrown = catchThrowable(() -> callSubmit(fps));
            assertThat(((VideoFrameInterpolationError) thrown).getCode())
                    .as("fps=%d 应 invalid_input", fps)
                    .isEqualTo(GenerationError.ERROR_INVALID_INPUT);
        }
    }

    // ========== submit：响应与错误分类（§5） ==========

    @Test
    @DisplayName("网关 400（官方失败示例逐字：fps 越界）→ 抛错，上游可读原因透传到 message")
    void gateway400TransportsUpstreamReason() {
        lastStatus.set(400);
        responseJson.set("{\"success\":false,\"task_id\":\"\",\"request_id\":\"req-2\","
                + "\"error\":{\"code\":\"InvalidParameter\",\"type\":\"BadRequest\","
                + "\"message\":\"The 'fps' parameter is out of range [15, 120]\",\"param\":\"fps\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit(60));

        assertThat(thrown).isInstanceOf(VideoFrameInterpolationError.class);
        assertThat(((VideoFrameInterpolationError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(thrown.getMessage()).contains("HTTP 400");
        assertThat(thrown.getMessage()).contains("out of range");
    }

    @Test
    @DisplayName("网关 400 内容政策信号 → content_rejected（§5 分类保留）")
    void gateway400ContentPolicySignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"error\":{\"message\":\"content policy violation\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit(60));

        assertThat(((VideoFrameInterpolationError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("网关 400 额度信号 → quota_exhausted（§5 分类保留）")
    void gateway400QuotaSignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"message\":\"剩余额度不足\"}");

        Throwable thrown = catchThrowable(() -> callSubmit(60));

        assertThat(((VideoFrameInterpolationError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("200 但缺 task_id → 1049 兜底")
    void missingTaskIdFallsBack() {
        responseJson.set("{\"success\":true,\"request_id\":\"req-3\"}");

        Throwable thrown = catchThrowable(() -> callSubmit(60));

        assertThat(((VideoFrameInterpolationError) thrown).getCode())
                .isEqualTo(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED);
    }

    @Test
    @DisplayName("非 JSON 响应 → 1049 兜底")
    void invalidJsonFallsBack() {
        responseJson.set("not-json<");

        Throwable thrown = catchThrowable(() -> callSubmit(60));

        assertThat(((VideoFrameInterpolationError) thrown).getCode())
                .isEqualTo(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED);
    }

    // ========== poll：端点路径与三态解析（官方 query API / result 四键） ==========

    @Test
    @DisplayName("poll completed：GET 查询路径拼 taskId，解析 result.video_url / duration / resolution / fps")
    void pollCompletedParsesResult() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-video-frame-interpolation-987654\","
                + "\"request_id\":\"20240522110000ABCDEFG67890\",\"status\":\"completed\","
                + "\"result\":{\"video_url\":\"https://example.volcvideo.com/interpolated.mp4?auth_key=...\","
                + "\"duration\":65.5,\"resolution\":\"1080p\",\"fps\":60},"
                + "\"expires_at\":1777464650,\"created_at\":1777291767,\"finished_at\":1777291851}");

        InterpolateVideoTaskObservation observation =
                new NewApiMediaKitInterpolateVideoClient(baseUrl).poll("sk-token", "amk-task-1");

        assertThat(lastMethod.get()).isEqualTo("GET");
        assertThat(lastPath.get())
                .isEqualTo(VideoFrameInterpolationContract.POLL_PATH_PREFIX + "amk-task-1");
        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.videoUrl())
                .isEqualTo("https://example.volcvideo.com/interpolated.mp4?auth_key=...");
        assertThat(observation.durationSec()).isEqualTo(65.5);
        assertThat(observation.resolution()).isEqualTo("1080p");
        assertThat(observation.fps()).isEqualTo(60.0);
    }

    @Test
    @DisplayName("poll 中间态（running）→ processing，无结果字段")
    void pollRunningIsProcessing() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-task-1\",\"status\":\"running\","
                + "\"request_id\":\"req-5\"}");

        InterpolateVideoTaskObservation observation =
                new NewApiMediaKitInterpolateVideoClient(baseUrl).poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("processing");
        assertThat(observation.videoUrl()).isNull();
        assertThat(observation.fps()).isNull();
    }

    @Test
    @DisplayName("poll failed → failed + 上游错误码与可读原因（透传给前端投影）")
    void pollFailedCarriesUpstreamError() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-task-1\",\"status\":\"failed\","
                + "\"error\":{\"code\":\"InvalidParameter\","
                + "\"message\":\"The 'fps' parameter is out of range [15, 120]\"}}");

        InterpolateVideoTaskObservation observation =
                new NewApiMediaKitInterpolateVideoClient(baseUrl).poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.upstreamCode()).isEqualTo("InvalidParameter");
        assertThat(observation.upstreamMessage()).contains("out of range");
    }

    @Test
    @DisplayName("poll 网关 data 信封 → 解包后仍取到 status / result 四键")
    void pollUnwrapsDataEnvelope() {
        responseJson.set("{\"data\":{\"task_id\":\"amk-task-1\",\"status\":\"completed\","
                + "\"result\":{\"video_url\":\"https://volc/out.mp4\",\"duration\":12.0,"
                + "\"resolution\":\"2k\",\"fps\":120}}}");

        InterpolateVideoTaskObservation observation =
                new NewApiMediaKitInterpolateVideoClient(baseUrl).poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.videoUrl()).isEqualTo("https://volc/out.mp4");
        assertThat(observation.durationSec()).isEqualTo(12.0);
        assertThat(observation.resolution()).isEqualTo("2k");
        assertThat(observation.fps()).isEqualTo(120.0);
    }

    @Test
    @DisplayName("poll HTTP 500 → provider_failed 且 cause 携带状态（processor 判瞬时重排）")
    void pollServerErrorCarriesStatus() {
        lastStatus.set(500);
        responseJson.set("{\"message\":\"upstream busy\"}");

        Throwable thrown = catchThrowable(() ->
                new NewApiMediaKitInterpolateVideoClient(baseUrl).poll("sk-token", "amk-task-1"));

        assertThat(thrown).isInstanceOf(VideoFrameInterpolationError.class);
        VideoFrameInterpolationError error = (VideoFrameInterpolationError) thrown;
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(error.getCause()).isInstanceOf(NewApiVideoClient.HttpStatusException.class);
        assertThat(((NewApiVideoClient.HttpStatusException) error.getCause()).getStatus()).isEqualTo(500);
    }

    @Test
    @DisplayName("poll 响应缺 status → provider_failed（非瞬时，不静默当 processing）")
    void pollMissingStatusFails() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-task-1\"}");

        Throwable thrown = catchThrowable(() ->
                new NewApiMediaKitInterpolateVideoClient(baseUrl).poll("sk-token", "amk-task-1"));

        assertThat(((VideoFrameInterpolationError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }

    @Test
    @DisplayName("completed 缺 result.video_url → 观测 videoUrl 为 null（processor 归并 1049）")
    void pollCompletedWithoutVideoUrlYieldsNull() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-task-1\",\"status\":\"completed\","
                + "\"result\":{\"duration\":12.0,\"resolution\":\"1080p\",\"fps\":60}}");

        InterpolateVideoTaskObservation observation =
                new NewApiMediaKitInterpolateVideoClient(baseUrl).poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.videoUrl()).isNull();
        assertThat(observation.fps()).isEqualTo(60.0);
    }
}
