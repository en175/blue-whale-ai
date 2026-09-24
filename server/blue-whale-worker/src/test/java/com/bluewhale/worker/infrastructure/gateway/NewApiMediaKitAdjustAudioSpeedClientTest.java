package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.AudioSpeedContract;
import com.bluewhale.worker.domain.error.AudioSpeedError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitAdjustAudioSpeedClient.AudioSpeedTaskObservation;
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
 * NewApiMediaKitAdjustAudioSpeedClient 接口级 mock 网关测试（IKHW5A，父单 IKHVYO；模板
 * NewApiMediaKitTrimAudioClientTest 一对一平移）。
 * <p>
 * 覆盖：出站映射（官方 CLI 参考文档 submit 参数节：audio_url + speed 可选、对客模型名、
 * 契约 SUBMIT_PATH 路径——**≠火山上游 /api/v1/tools/adjust-audio-speed**，IKH67T 404 教训）、
 * 不发 format / media_output_destination / client_token / callback（父单决策：无格式下拉、
 * 无幂等回调）、标准请求头三元组、submit 响应 task_id 解析与缺失兜底、官方错误结构
 * error{code,type,message,param} 的 §5 分类与上游原因透传、poll 端点路径与三态解析
 * （completed / failed / 中间态，result.audio_url / result.duration）、HTTP 错误携带状态
 * （瞬时判定输入）。不连真实网关。参数名以火山官方 CLI 参考文档（volcengine/mediakit-cli
 * adjust-audio-speed.md）为准。
 */
class NewApiMediaKitAdjustAudioSpeedClientTest {

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
        // 官方「任务提交成功响应」示例形状（task_id 换 adjust-audio-speed 前缀）
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-adjust-audio-speed-1399300\","
                + "\"request_id\":\"20260324140000B9CF8E68B9A4F28F1EC0\"}");
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

    private String callSubmit(Double speed) {
        return new NewApiMediaKitAdjustAudioSpeedClient(baseUrl).submit(
                "sk-token", "https://example.com/full_podcast.mp3", speed);
    }

    // ========== submit：出站映射（官方 CLI 参考文档 submit 参数节） ==========

    @Test
    @DisplayName("官方示例形态：契约 SUBMIT_PATH 路径 + 对客模型名 + audio_url + speed 同名透传")
    void submitMapsOfficialParams() {
        String taskId = callSubmit(1.35);

        assertThat(taskId).isEqualTo("amk-tool-adjust-audio-speed-1399300");
        // 网关对客路径独立常量，≠火山上游 /api/v1/tools/adjust-audio-speed（IKH67T 404 教训）
        assertThat(lastPath.get()).isEqualTo(AudioSpeedContract.SUBMIT_PATH);
        assertThat(lastPath.get()).isNotEqualTo("/api/v1/tools/adjust-audio-speed");
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"mediakit-adjust-audio-speed\"");
        assertThat(body).contains("\"audio_url\":\"https://example.com/full_podcast.mp3\"");
        assertThat(body).contains("\"speed\":1.35");
        // 不发 format（父单决策无格式下拉，产物跟随官方默认 m4a）、media_output_destination
        // （默认临时链接 + 自家转存）与其余可选参数
        assertThat(body).doesNotContain("format");
        assertThat(body).doesNotContain("media_output_destination");
        assertThat(body).doesNotContain("client_token");
        assertThat(body).doesNotContain("callback");
    }

    @Test
    @DisplayName("贴原速省略：speed null 即不出键（走官方默认 1）")
    void submitSpeedOmittedOmitsKey() {
        callSubmit(null);

        assertThat(lastPath.get()).isEqualTo(AudioSpeedContract.SUBMIT_PATH);
        // 带引号的键名形态——对客模型名 mediakit-adjust-audio-speed 本身含 speed 子串
        assertThat(lastBody.get()).doesNotContain("\"speed\"");
    }

    @Test
    @DisplayName("鉴权三件套与生成家族同构：Bearer + X-Client-System: bluewhale + X-Trace-Id")
    void standardHeadersSameAsGenerationFamily() {
        callSubmit(1.35);

        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
    }

    // ========== submit：响应与错误分类（官方错误结构 error{code,message,param,type}） ==========

    @Test
    @DisplayName("网关 400（官方同步错误结构）→ 抛错，上游可读原因透传到 message")
    void gateway400TransportsUpstreamReason() {
        lastStatus.set(400);
        // 官方错误结构示例形态（InvalidParameter speed 形态：范围 [0.1, 4] 官方约束）
        responseJson.set("{\"success\":false,\"task_id\":\"\",\"request_id\":\"20240520153500XYZW54321\","
                + "\"error\":{\"code\":\"InvalidParameter\",\"message\":\"The parameter `speed` must be"
                + " in range [0.1, 4].\",\"param\":\"speed\",\"type\":\"BadRequest\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit(1.35));

        assertThat(thrown).isInstanceOf(AudioSpeedError.class);
        assertThat(((AudioSpeedError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(thrown.getMessage()).contains("HTTP 400");
        assertThat(thrown.getMessage()).contains("must be in range [0.1, 4]");
    }

    @Test
    @DisplayName("网关 400 内容政策信号 → content_rejected（§5 分类保留）")
    void gateway400ContentPolicySignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"error\":{\"message\":\"content policy violation\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit(1.35));

        assertThat(((AudioSpeedError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("网关 402 额度信号 → quota_exhausted（§5 分类保留）")
    void gateway402QuotaSignalKept() {
        lastStatus.set(402);
        responseJson.set("{\"message\":\"insufficient balance\"}");

        Throwable thrown = catchThrowable(() -> callSubmit(1.35));

        assertThat(((AudioSpeedError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("200 但缺 task_id → 1051 兜底")
    void missingTaskIdFallsBack() {
        responseJson.set("{\"success\":true,\"request_id\":\"req-3\"}");

        Throwable thrown = catchThrowable(() -> callSubmit(1.35));

        assertThat(((AudioSpeedError) thrown).getCode())
                .isEqualTo(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
    }

    @Test
    @DisplayName("非 JSON 响应 → 1051 兜底")
    void invalidJsonFallsBack() {
        responseJson.set("not-json<");

        Throwable thrown = catchThrowable(() -> callSubmit(1.35));

        assertThat(((AudioSpeedError) thrown).getCode())
                .isEqualTo(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
    }

    // ========== poll：端点路径与三态解析（官方「查询任务」节） ==========

    @Test
    @DisplayName("poll completed：GET 查询路径拼 taskId，解析 result.audio_url 与 duration 秒")
    void pollCompletedParsesResult() {
        // 官方「查询任务」节形状（result.audio_url / result.duration 已对官方 CLI 参考文档
        // 逐字复核证实）+ 查询端点的 status 字段（按家族先例容错解析）
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-adjust-audio-speed-1399300\","
                + "\"request_id\":\"20260324140000B9CF8E68B9A4F28F1EC0\","
                + "\"status\":\"completed\","
                + "\"result\":{\"audio_url\":\"https://example.volcvideo.com/sped_output.m4a"
                + "?auth_key=1774504841-...\",\"duration\":47.5},"
                + "\"expires_at\":1777464650,\"created_at\":1777291767,\"finished_at\":1777291851}");

        AudioSpeedTaskObservation observation =
                new NewApiMediaKitAdjustAudioSpeedClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(lastMethod.get()).isEqualTo("GET");
        assertThat(lastPath.get())
                .isEqualTo(AudioSpeedContract.POLL_PATH_PREFIX + "amk-tool-1");
        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.audioUrl())
                .isEqualTo("https://example.volcvideo.com/sped_output.m4a?auth_key=1774504841-...");
        assertThat(observation.durationSec()).isEqualTo(47.5);
    }

    @Test
    @DisplayName("poll completed 兜底形态（output.*）：result 缺失时 output 兜底双读，不误判")
    void pollCompletedReadsOutputFallback() {
        // 调速官方文档正文与示例均为 result.*（无 trim-audio 那种文档自相矛盾记录）；
        // output 兜底纯为家族同构容错（网关转发形状不受本仓控制），防 completed 被读成
        // 无 audio_url 的成功
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-adjust-audio-speed-1399300\","
                + "\"request_id\":\"20260324140000B9CF8E68B9A4F28F1EC0\","
                + "\"status\":\"completed\","
                + "\"output\":{\"audio_url\":\"https://example.volcvideo.com/sped_output.m4a"
                + "?auth_key=1774504841-...\",\"duration\":47.5},"
                + "\"expires_at\":1777464650,\"created_at\":1777291767,\"finished_at\":1777291851}");

        AudioSpeedTaskObservation observation =
                new NewApiMediaKitAdjustAudioSpeedClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.audioUrl())
                .isEqualTo("https://example.volcvideo.com/sped_output.m4a?auth_key=1774504841-...");
        assertThat(observation.durationSec()).isEqualTo(47.5);
    }

    @Test
    @DisplayName("poll 中间态（queued）→ processing，无结果字段")
    void pollQueuedIsProcessing() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-1\",\"status\":\"queued\","
                + "\"request_id\":\"req-5\"}");

        AudioSpeedTaskObservation observation =
                new NewApiMediaKitAdjustAudioSpeedClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(observation.status()).isEqualTo("processing");
        assertThat(observation.audioUrl()).isNull();
    }

    @Test
    @DisplayName("poll failed → failed + 上游错误码与可读原因（透传给前端投影）")
    void pollFailedCarriesUpstreamError() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-1\",\"status\":\"failed\","
                + "\"error\":{\"code\":\"AudioParseFailed\",\"message\":\"输入音频解析失败\"}}");

        AudioSpeedTaskObservation observation =
                new NewApiMediaKitAdjustAudioSpeedClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.upstreamCode()).isEqualTo("AudioParseFailed");
        assertThat(observation.upstreamMessage()).contains("输入音频解析失败");
    }

    @Test
    @DisplayName("poll 网关 data 信封 → 解包后仍取到 status / result")
    void pollUnwrapsDataEnvelope() {
        responseJson.set("{\"data\":{\"task_id\":\"amk-tool-1\",\"status\":\"completed\","
                + "\"result\":{\"audio_url\":\"https://volc/out.m4a\",\"duration\":24.0}}}");

        AudioSpeedTaskObservation observation =
                new NewApiMediaKitAdjustAudioSpeedClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.audioUrl()).isEqualTo("https://volc/out.m4a");
    }

    @Test
    @DisplayName("poll HTTP 500 → provider_failed 且 cause 携带状态（processor 判瞬时重排）")
    void pollServerErrorCarriesStatus() {
        lastStatus.set(500);
        responseJson.set("{\"message\":\"upstream busy\"}");

        Throwable thrown = catchThrowable(() ->
                new NewApiMediaKitAdjustAudioSpeedClient(baseUrl).poll("sk-token", "amk-tool-1"));

        assertThat(thrown).isInstanceOf(AudioSpeedError.class);
        AudioSpeedError error = (AudioSpeedError) thrown;
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(error.getCause()).isInstanceOf(NewApiVideoClient.HttpStatusException.class);
        assertThat(((NewApiVideoClient.HttpStatusException) error.getCause()).getStatus()).isEqualTo(500);
    }

    @Test
    @DisplayName("poll 响应缺 status → provider_failed（非瞬时，不静默当 processing）")
    void pollMissingStatusFails() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-1\"}");

        Throwable thrown = catchThrowable(() ->
                new NewApiMediaKitAdjustAudioSpeedClient(baseUrl).poll("sk-token", "amk-tool-1"));

        assertThat(((AudioSpeedError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }
}
