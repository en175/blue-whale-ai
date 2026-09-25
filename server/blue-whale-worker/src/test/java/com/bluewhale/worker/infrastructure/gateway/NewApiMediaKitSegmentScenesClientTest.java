package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoSceneSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSceneSplitError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient.SceneSplitTaskObservation;
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
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * NewApiMediaKitSegmentScenesClient 接口级 mock 网关测试（IKH8BP，父规格 IKH86V）。
 * <p>
 * 覆盖：出站映射（官方 PDF「提交任务」+「调整切分粒度」节：video_url 透传、granularity →
 * 契约 SEGMENT_THRESHOLD 数值、对客模型名、契约 SUBMIT_PATH 路由——IKH67T 红线：网关
 * 路径 ≠ 火山上游路径）、高级参数不暴露（min_duration / max_duration / enable_clip_fade /
 * return_segment_videos 不出站）、标准请求头三元组、submit 响应 task_id 解析与缺失兜底、
 * 官方错误结构 error{code,type,message,param} 的 §5 分类与上游原因透传、poll 端点路径
 * （契约 POLL_PATH_PREFIX 拼 taskId）与三态解析（completed 含 result.segments[] 一对多 /
 * failed / running 中间态）。不连真实网关。参数名以火山官方 PDF
 * 「提交场景切分任务 API」为准。
 */
class NewApiMediaKitSegmentScenesClientTest {

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
        // 官方「任务提交成功响应」示例形状（PDF「响应说明」节同构）
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-segment-scenes-1400500\","
                + "\"request_id\":\"20260325160000A8DE7F57A9B3E17A0DD2\"}");
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

    private String callSubmit(String granularity) {
        return new NewApiMediaKitSegmentScenesClient(new UpstreamBaseUrl(baseUrl)).submit(
                "sk-token", "https://example.com/source_video.mp4", granularity);
    }

    // ========== submit：出站映射（官方 PDF「提交任务」+「调整切分粒度」节） ==========

    @Test
    @DisplayName("standard：契约 SUBMIT_PATH 网关路由 + 对客模型名 + video_url + threshold=10")
    void submitStandardMapsOfficialParams() {
        String taskId = callSubmit("standard");

        assertThat(taskId).isEqualTo("amk-tool-segment-scenes-1400500");
        // IKH67T 红线：网关对客路由（契约常量），不是火山上游 /api/v1/tools/segment-scenes
        assertThat(lastPath.get()).isEqualTo(VideoSceneSplitContract.SUBMIT_PATH);
        assertThat(lastMethod.get()).isEqualTo("POST");
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"" + VideoSceneSplitContract.MODEL_NAME + "\"");
        assertThat(body).contains("\"video_url\":\"https://example.com/source_video.mp4\"");
        assertThat(body).contains("\"segment_threshold\":10");
        // 高级参数一律不暴露（规格「高级参数不暴露」：走服务端默认）
        assertThat(body).doesNotContain("min_duration");
        assertThat(body).doesNotContain("max_duration");
        assertThat(body).doesNotContain("enable_clip_fade");
        assertThat(body).doesNotContain("return_segment_videos");
        assertThat(body).doesNotContain("client_token");
        assertThat(body).doesNotContain("callback");
    }

    @Test
    @DisplayName("fine / coarse：threshold 分别映射 5 / 20（契约 SEGMENT_THRESHOLD 单源）")
    void submitGranularityThresholdMapping() {
        callSubmit("fine");
        assertThat(lastBody.get()).contains("\"segment_threshold\":5");

        callSubmit("coarse");
        assertThat(lastBody.get()).contains("\"segment_threshold\":20");
    }

    @Test
    @DisplayName("鉴权与生成家族同构：Bearer + X-Client-System: bluewhale + X-Trace-Id")
    void standardHeadersSameAsGenerationFamily() {
        callSubmit("standard");

        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
    }

    @Test
    @DisplayName("submit 粒度枚举外 → invalid_input（兜底防御）")
    void submitUnknownGranularity_invalidInput() {
        Throwable thrown = catchThrowable(() -> callSubmit("ultra"));

        assertThat(((VideoSceneSplitError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_INVALID_INPUT);
    }

    // ========== submit：响应与错误分类（官方错误结构 error{code,message,param,type}） ==========

    @Test
    @DisplayName("网关 400（官方同步错误结构）→ 抛错，上游可读原因透传到 message")
    void gateway400_transportsUpstreamReason() {
        lastStatus.set(400);
        responseJson.set("{\"success\":false,\"error\":{\"code\":\"InvalidParameter\","
                + "\"message\":\"video_url 格式不受支持\",\"param\":\"video_url\",\"type\":\"ApiError\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("standard"));

        assertThat(thrown).isInstanceOf(VideoSceneSplitError.class);
        assertThat(thrown.getMessage()).contains("video_url 格式不受支持");
    }

    @Test
    @DisplayName("网关 400 内容政策信号 → content_rejected（§5 分类保留）")
    void gateway400ContentPolicy_contentRejected() {
        lastStatus.set(400);
        responseJson.set("{\"error\":{\"message\":\"sensitive content detected\",\"code\":\"x\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("standard"));

        assertThat(((VideoSceneSplitError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("网关 402 额度信号 → quota_exhausted（§5 分类保留）")
    void gateway402Quota_quotaExhausted() {
        lastStatus.set(402);
        responseJson.set("{\"error\":{\"message\":\"剩余额度不足\",\"code\":\"QuotaExceeded\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("standard"));

        assertThat(((VideoSceneSplitError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("200 但缺 task_id → 1046 兜底")
    void missingTaskId_fallsBackToContractCode() {
        responseJson.set("{\"success\":true}");

        Throwable thrown = catchThrowable(() -> callSubmit("standard"));

        assertThat(((VideoSceneSplitError) thrown).getCode())
                .isEqualTo(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED);
    }

    @Test
    @DisplayName("非 JSON 响应 → 1046 兜底")
    void nonJsonResponse_fallsBack() {
        responseJson.set("not-json<");

        Throwable thrown = catchThrowable(() -> callSubmit("standard"));

        assertThat(((VideoSceneSplitError) thrown).getCode())
                .isEqualTo(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED);
    }

    // ========== poll：查询路径与三态解析 ==========

    @Test
    @DisplayName("poll completed：GET 契约 POLL_PATH_PREFIX 拼 taskId，解析 duration + segments[]")
    void pollCompletedParsesSegments() {
        responseJson.set("{\"task_id\":\"amk-task-1\",\"status\":\"completed\","
                + "\"result\":{\"duration\":95.5,\"segments\":["
                + "{\"start_time\":0.0,\"end_time\":31.2,\"segment_video_url\":\"https://volc/seg1.mp4\"},"
                + "{\"start_time\":31.2,\"end_time\":64.8,\"segment_video_url\":\"https://volc/seg2.mp4\"},"
                + "{\"start_time\":64.8,\"end_time\":95.5,\"segment_video_url\":\"https://volc/seg3.mp4\"}]}}");

        SceneSplitTaskObservation observation = new NewApiMediaKitSegmentScenesClient(new UpstreamBaseUrl(baseUrl))
                .poll("sk-token", "amk-task-1");

        assertThat(lastPath.get())
                .isEqualTo(VideoSceneSplitContract.POLL_PATH_PREFIX + "amk-task-1");
        assertThat(lastMethod.get()).isEqualTo("GET");
        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.durationSec()).isEqualTo(95.5);
        assertThat(observation.segments()).hasSize(3);
        assertThat(observation.segments().get(0).startTimeSec()).isEqualTo(0.0);
        assertThat(observation.segments().get(0).endTimeSec()).isEqualTo(31.2);
        assertThat(observation.segments().get(0).segmentVideoUrl()).isEqualTo("https://volc/seg1.mp4");
        assertThat(observation.segments().get(2).endTimeSec()).isEqualTo(95.5);
    }

    @Test
    @DisplayName("poll completed 仅 1 段 → segments 单元素（照单全收不特判）")
    void pollCompletedSingleSegment() {
        responseJson.set("{\"task_id\":\"amk-task-1\",\"status\":\"completed\","
                + "\"result\":{\"duration\":95.0,\"segments\":["
                + "{\"start_time\":0.0,\"end_time\":95.0,\"segment_video_url\":\"https://volc/whole.mp4\"}]}}");

        SceneSplitTaskObservation observation = new NewApiMediaKitSegmentScenesClient(new UpstreamBaseUrl(baseUrl))
                .poll("sk-token", "amk-task-1");

        assertThat(observation.segments()).hasSize(1);
    }

    @Test
    @DisplayName("段行缺 segment_video_url → 1046 整体失败（与转存环节口径对齐，不静默跳过）")
    void segmentRowMissingUrl_wholeJobFails() {
        responseJson.set("{\"task_id\":\"amk-task-1\",\"status\":\"completed\","
                + "\"result\":{\"duration\":95.0,\"segments\":["
                + "{\"start_time\":0.0,\"end_time\":31.2,\"segment_video_url\":\"https://volc/seg1.mp4\"},"
                + "{\"start_time\":31.2,\"end_time\":64.8}]}}");

        VideoSceneSplitError error = catchThrowableOfType(
                () -> new NewApiMediaKitSegmentScenesClient(new UpstreamBaseUrl(baseUrl)).poll("sk-token", "amk-task-1"),
                VideoSceneSplitError.class);

        assertThat(error.getCode())
                .isEqualTo(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED);
        assertThat(error.getMessage()).contains("第 2 段");
    }

    @Test
    @DisplayName("段行 start_time 非数字 → 1046 整体失败（任一行形状非法即失败，带段序）")
    void segmentRowNonNumericStart_wholeJobFails() {
        responseJson.set("{\"task_id\":\"amk-task-1\",\"status\":\"completed\","
                + "\"result\":{\"duration\":95.0,\"segments\":["
                + "{\"start_time\":\"0.0\",\"end_time\":31.2,\"segment_video_url\":\"https://volc/seg1.mp4\"}]}}");

        VideoSceneSplitError error = catchThrowableOfType(
                () -> new NewApiMediaKitSegmentScenesClient(new UpstreamBaseUrl(baseUrl)).poll("sk-token", "amk-task-1"),
                VideoSceneSplitError.class);

        assertThat(error.getCode())
                .isEqualTo(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED);
        assertThat(error.getMessage()).contains("第 1 段");
    }

    @Test
    @DisplayName("poll 中间态（running）→ processing，无结果字段")
    void pollRunning_processing() {
        responseJson.set("{\"task_id\":\"amk-task-1\",\"status\":\"running\"}");

        SceneSplitTaskObservation observation = new NewApiMediaKitSegmentScenesClient(new UpstreamBaseUrl(baseUrl))
                .poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("processing");
        assertThat(observation.segments()).isNullOrEmpty();
        assertThat(observation.durationSec()).isNull();
    }

    @Test
    @DisplayName("poll failed → failed + 上游错误码与可读原因（透传给前端投影）")
    void pollFailed_transportsUpstreamError() {
        responseJson.set("{\"task_id\":\"amk-task-1\",\"status\":\"failed\","
                + "\"error\":{\"code\":\"VideoParseFailed\",\"message\":\"输入视频解析失败\","
                + "\"param\":\"\",\"type\":\"TaskError\"}}");

        SceneSplitTaskObservation observation = new NewApiMediaKitSegmentScenesClient(new UpstreamBaseUrl(baseUrl))
                .poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.upstreamCode()).isEqualTo("VideoParseFailed");
        assertThat(observation.upstreamMessage()).contains("输入视频解析失败");
    }

    @Test
    @DisplayName("poll 网关 data 信封 → 解包后仍取到 status / result.segments")
    void pollUnwrapsDataEnvelope() {
        responseJson.set("{\"data\":{\"task_id\":\"amk-task-1\",\"status\":\"completed\","
                + "\"result\":{\"duration\":12.0,\"segments\":["
                + "{\"start_time\":0.0,\"end_time\":12.0,\"segment_video_url\":\"https://volc/s.mp4\"}]}}}");

        SceneSplitTaskObservation observation = new NewApiMediaKitSegmentScenesClient(new UpstreamBaseUrl(baseUrl))
                .poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.segments()).hasSize(1);
    }

    @Test
    @DisplayName("poll 网关 500 → provider_failed，cause 携带 HTTP 状态（瞬时判定输入）")
    void pollGateway500_carriesHttpStatus() {
        lastStatus.set(500);
        responseJson.set("{\"error\":{\"message\":\"upstream down\"}}");

        Throwable thrown = catchThrowable(() -> new NewApiMediaKitSegmentScenesClient(new UpstreamBaseUrl(baseUrl))
                .poll("sk-token", "amk-task-1"));

        assertThat(((VideoSceneSplitError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(thrown.getCause()).isInstanceOf(NewApiVideoClient.HttpStatusException.class);
        assertThat(((NewApiVideoClient.HttpStatusException) thrown.getCause()).getStatus()).isEqualTo(500);
    }
}
