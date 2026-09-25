package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoMattingError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient.MatteVideoTaskObservation;
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
 * NewApiMediaKitMatteVideoClient 接口级 mock 网关测试（IKHK99，父规格 IKHJRC，契约 IKHK7F）。
 * <p>
 * 覆盖：**双端点按模式分流**（portrait → 契约 SUBMIT_PATHS.portrait、greenscreen →
 * SUBMIT_PATHS.greenscreen——IKH67T 红线：网关路径 ≠ 火山上游路径）、模式 → 模型名映射
 * （契约 MODEL_NAMES 单源）、出站参数形状（video_url / format 透传；**background_color 仅
 * MP4 时显式携带**——两端点官方默认底色不同，本仓冻结 white 防歧义；WEBM 不带）、
 * 幂等与回调参数不出站（client_token / callback_url / callback_args / queue_id /
 * media_output_destination——家族轮询口径 + worker 转存自家 TOS，ADR-0112）、标准请求头
 * 三元组、submit 响应 task_id 解析与缺失兜底、官方错误结构 error{code,type,message,param}
 * 的 §5 分类与上游原因透传、poll 端点路径（契约 POLL_PATH_PREFIX 拼 taskId）与三态解析
 * （completed 含 result 三键 / failed / running 中间态）。不连真实网关。参数名以火山官方
 * 开发指南 PDF 为准。
 */
class NewApiMediaKitMatteVideoClientTest {

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
        // 官方「提交成功响应」示例形状（开发指南 PDF 同构）
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-matte-portrait-video-123456789\","
                + "\"request_id\":\"20240521100000ABCDEFG12345\"}");
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

    private String callSubmit(String mode, String format, String backgroundColor) {
        return new NewApiMediaKitMatteVideoClient(new UpstreamBaseUrl(baseUrl)).submit(
                "sk-token", "https://example.com/your_portrait_video.mp4",
                mode, format, backgroundColor);
    }

    // ========== submit：双端点按模式分流 + 出站映射（官方开发指南 PDF「快速入门」节） ==========

    @Test
    @DisplayName("portrait/WEBM：契约 SUBMIT_PATHS 分流 + 按模式模型名 + video_url/format 透传，无 background_color")
    void submitPortraitWebm_mapsOfficialParamsWithoutBackgroundColor() {
        String taskId = callSubmit("portrait", "WEBM", null);

        assertThat(taskId).isEqualTo("amk-tool-matte-portrait-video-123456789");
        // IKH67T 红线：网关对客路由（契约常量映射），不是火山上游 /api/v1/tools/matte-portrait-video
        assertThat(lastPath.get())
                .isEqualTo(VideoMattingContract.SUBMIT_PATHS.get("portrait"));
        assertThat(lastMethod.get()).isEqualTo("POST");
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"" + VideoMattingContract.MODEL_NAMES.get("portrait") + "\"");
        assertThat(body).contains("\"video_url\":\"https://example.com/your_portrait_video.mp4\"");
        assertThat(body).contains("\"format\":\"WEBM\"");
        // WEBM 透明：不带 background_color（官方两端点默认底色不同，仅 MP4 显式携带）
        assertThat(body).doesNotContain("background_color");
        // 幂等与回调参数一律不出站（家族轮询口径 + worker 转存自家 TOS，ADR-0112）
        assertThat(body).doesNotContain("client_token");
        assertThat(body).doesNotContain("callback");
        assertThat(body).doesNotContain("queue_id");
        assertThat(body).doesNotContain("media_output_destination");
    }

    @Test
    @DisplayName("greenscreen/MP4：分流到绿幕端点 + 显式携带 background_color（防两端点默认底色歧义）")
    void submitGreenscreenMp4_routesSecondEndpointWithBackgroundColor() {
        callSubmit("greenscreen", "MP4", "white");

        assertThat(lastPath.get())
                .isEqualTo(VideoMattingContract.SUBMIT_PATHS.get("greenscreen"));
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"" + VideoMattingContract.MODEL_NAMES.get("greenscreen") + "\"");
        assertThat(body).contains("\"format\":\"MP4\"");
        assertThat(body).contains("\"background_color\":\"white\"");
    }

    @Test
    @DisplayName("portrait/MP4/显式 black：人像端点也显式携带（不依赖官方人像默认 green）")
    void submitPortraitMp4BlackBackground_explicitlyCarried() {
        callSubmit("portrait", "MP4", "black");

        assertThat(lastPath.get())
                .isEqualTo(VideoMattingContract.SUBMIT_PATHS.get("portrait"));
        assertThat(lastBody.get()).contains("\"background_color\":\"black\"");
    }

    @Test
    @DisplayName("鉴权与生成家族同构：Bearer + X-Client-System: bluewhale + X-Trace-Id")
    void standardHeadersSameAsGenerationFamily() {
        callSubmit("portrait", "WEBM", null);

        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
    }

    @Test
    @DisplayName("模式枚举外 → invalid_input（兜底防御）")
    void submitUnknownMode_invalidInput() {
        Throwable thrown = catchThrowable(() -> callSubmit("cutout", "WEBM", null));

        assertThat(((VideoMattingError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("格式枚举外（含未暴露的 MOV）→ invalid_input（兜底防御）")
    void submitUnknownFormat_invalidInput() {
        Throwable thrown = catchThrowable(() -> callSubmit("portrait", "MOV", null));

        assertThat(((VideoMattingError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("WEBM 携带背景色 → invalid_input（透明输出不接受，契约 refine 同款）")
    void submitWebmWithBackgroundColor_invalidInput() {
        Throwable thrown = catchThrowable(() -> callSubmit("portrait", "WEBM", "white"));

        assertThat(((VideoMattingError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_INVALID_INPUT);
    }

    // ========== submit：响应与错误分类（官方错误结构 error{code,message,param,type}） ==========

    @Test
    @DisplayName("网关 400（官方同步错误结构）→ 抛错，上游可读原因透传到 message")
    void gateway400_transportsUpstreamReason() {
        lastStatus.set(400);
        responseJson.set("{\"success\":false,\"error\":{\"code\":\"InvalidParameter\","
                + "\"message\":\"video_url 格式不受支持\",\"param\":\"video_url\",\"type\":\"ApiError\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("portrait", "WEBM", null));

        assertThat(thrown).isInstanceOf(VideoMattingError.class);
        assertThat(thrown.getMessage()).contains("video_url 格式不受支持");
    }

    @Test
    @DisplayName("网关 400 内容政策信号 → content_rejected（§5 分类保留）")
    void gateway400ContentPolicy_contentRejected() {
        lastStatus.set(400);
        responseJson.set("{\"error\":{\"message\":\"sensitive content detected\",\"code\":\"x\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("portrait", "WEBM", null));

        assertThat(((VideoMattingError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("网关 402 额度信号 → quota_exhausted（§5 分类保留）")
    void gateway402Quota_quotaExhausted() {
        lastStatus.set(402);
        responseJson.set("{\"error\":{\"message\":\"剩余额度不足\",\"code\":\"QuotaExceeded\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("greenscreen", "MP4", "white"));

        assertThat(((VideoMattingError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("200 但缺 task_id → 1050 兜底")
    void missingTaskId_fallsBackToContractCode() {
        responseJson.set("{\"success\":true}");

        Throwable thrown = catchThrowable(() -> callSubmit("portrait", "WEBM", null));

        assertThat(((VideoMattingError) thrown).getCode())
                .isEqualTo(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
    }

    @Test
    @DisplayName("非 JSON 响应 → 1050 兜底")
    void nonJsonResponse_fallsBack() {
        responseJson.set("not-json<");

        Throwable thrown = catchThrowable(() -> callSubmit("portrait", "WEBM", null));

        assertThat(((VideoMattingError) thrown).getCode())
                .isEqualTo(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
    }

    // ========== poll：查询路径与三态解析（两工具共用同一条查询路由） ==========

    @Test
    @DisplayName("poll completed：GET 契约 POLL_PATH_PREFIX 拼 taskId，解析 result 三键")
    void pollCompletedParsesResultKeys() {
        responseJson.set("{\"task_id\":\"amk-tool-matte-portrait-video-123456789\","
                + "\"status\":\"completed\",\"result\":{"
                + "\"video_url\":\"https://example.volcvideo.com/matted_output.webm?auth_key=...\","
                + "\"resolution\":\"1080p\",\"duration\":15.5}}");

        MatteVideoTaskObservation observation = new NewApiMediaKitMatteVideoClient(new UpstreamBaseUrl(baseUrl))
                .poll("sk-token", "amk-tool-matte-portrait-video-123456789");

        assertThat(lastPath.get())
                .isEqualTo(VideoMattingContract.POLL_PATH_PREFIX + "amk-tool-matte-portrait-video-123456789");
        assertThat(lastMethod.get()).isEqualTo("GET");
        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.videoUrl())
                .isEqualTo("https://example.volcvideo.com/matted_output.webm?auth_key=...");
        assertThat(observation.resolution()).isEqualTo("1080p");
        assertThat(observation.durationSec()).isEqualTo(15.5);
    }

    @Test
    @DisplayName("poll failed：读 error 对象 code/message（TaskError / ApiError 信封）")
    void pollFailedReadsErrorEnvelope() {
        responseJson.set("{\"task_id\":\"amk-task-1\",\"status\":\"failed\","
                + "\"error\":{\"code\":\"VideoQualityTooLow\",\"message\":\"视频画质过低\","
                + "\"param\":\"\",\"type\":\"TaskError\"}}");

        MatteVideoTaskObservation observation = new NewApiMediaKitMatteVideoClient(new UpstreamBaseUrl(baseUrl))
                .poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.upstreamCode()).isEqualTo("VideoQualityTooLow");
        assertThat(observation.upstreamMessage()).contains("视频画质过低");
    }

    @Test
    @DisplayName("poll running（status 大小写未冻结，小写归一）→ processing 中间态")
    void pollRunning_normalizesToProcessing() {
        responseJson.set("{\"task_id\":\"amk-task-1\",\"status\":\"RUNNING\"}");

        MatteVideoTaskObservation observation = new NewApiMediaKitMatteVideoClient(new UpstreamBaseUrl(baseUrl))
                .poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("processing");
        assertThat(observation.videoUrl()).isNull();
    }

    @Test
    @DisplayName("poll completed 缺 result.video_url → 观测返回 null（processor 判形态兜底失败）")
    void pollCompletedWithoutVideoUrl_returnsNullUrl() {
        responseJson.set("{\"task_id\":\"amk-task-1\",\"status\":\"completed\","
                + "\"result\":{\"resolution\":\"1080p\",\"duration\":15.5}}");

        MatteVideoTaskObservation observation = new NewApiMediaKitMatteVideoClient(new UpstreamBaseUrl(baseUrl))
                .poll("sk-token", "amk-task-1");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.videoUrl()).isNull();
        assertThat(observation.resolution()).isEqualTo("1080p");
    }

    @Test
    @DisplayName("poll 网关 404 → 抛错且 cause 携带状态（processor 瞬时判定用）")
    void pollGateway404_throwsWithHttpStatusCause() {
        lastStatus.set(404);
        responseJson.set("{\"error\":{\"message\":\"task not found\"}}");

        VideoMattingError error = (VideoMattingError) catchThrowable(
                () -> new NewApiMediaKitMatteVideoClient(new UpstreamBaseUrl(baseUrl)).poll("sk-token", "amk-gone"));

        assertThat(error.getCause()).isInstanceOf(NewApiVideoClient.HttpStatusException.class);
        assertThat(((NewApiVideoClient.HttpStatusException) error.getCause()).getStatus())
                .isEqualTo(404);
    }
}
