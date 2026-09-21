package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.VocalSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VocalSplitError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSeparateVoiceClient.SeparateVoiceTaskObservation;
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
 * NewApiMediaKitSeparateVoiceClient 接口级 mock 网关测试（IKHA2J；模板
 * NewApiMediaKitExtractAudioClientTest）。
 * <p>
 * 覆盖：出站映射（官方 PDF「第 1 步：提交任务」+「进阶使用：选择分离场景」节：scene 四档
 * 出站换算官方首字母大写枚举 + output_format 同名同值——**不是 extract-audio 的 format**、
 * video_url / audio_url 按源类型分叉、对客模型名、契约 SUBMIT_PATH 路径）、标准请求头
 * 三元组、submit 响应 task_id 解析与缺失兜底、官方错误结构 error{code,type,message,param}
 * 的 §5 分类与上游原因透传、poll 端点路径与三态解析（completed 两轨 / 三轨结果字段、
 * failed、中间态，result.duration）、HTTP 错误携带状态（瞬时判定输入）。不连真实网关。
 * 参数名以火山官方 PDF「人声背景音分离」节为准。
 */
class NewApiMediaKitSeparateVoiceClientTest {

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
        // 官方「请求成功后」示例形状（PDF「第 1 步：提交任务」节逐字，task_id 前缀 separate-voice）
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-separate-voice-12345678\","
                + "\"request_id\":\"20260417110000A1B2C3D4E5F6G7H8\"}");
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

    private String callSubmit(String scene, String outputFormat) {
        return new NewApiMediaKitSeparateVoiceClient(baseUrl).submit(
                "sk-token", "https://example.com/source_video.mp4", true, scene, outputFormat);
    }

    // ========== submit：出站映射（官方 PDF「第 1 步」+「选择分离场景」节） ==========

    @Test
    @DisplayName("契约 SUBMIT_PATH 路径 + 对客模型名 + video_url + scene 四档出站映射 + output_format 同名透传")
    void submitMapsOfficialParamsAllScenes() {
        // 四档产品小写键全部出站映射官方首字母大写枚举（契约 SCENE_UPSTREAM_MAP 单源）
        String[][] cases = {
                {"audio", "Audio"}, {"music", "Music"}, {"drama", "Drama"}, {"narrate", "Narrate"}};
        for (String[] c : cases) {
            String taskId = callSubmit(c[0], "aac");

            assertThat(taskId).isEqualTo("amk-tool-separate-voice-12345678");
            assertThat(lastPath.get()).isEqualTo(VocalSplitContract.SUBMIT_PATH);
            String body = lastBody.get();
            assertThat(body).contains("\"model\":\"mediakit-separate-voice\"");
            assertThat(body).contains("\"video_url\":\"https://example.com/source_video.mp4\"");
            assertThat(body).contains("\"scene\":\"" + c[1] + "\"");
            assertThat(body).contains("\"output_format\":\"aac\"");
            // 出站键是 output_format（不是 extract-audio 的 format）；不发可选参数
            assertThat(body).doesNotContain("\"format\":");
            assertThat(body).doesNotContain("media_output_destination");
            assertThat(body).doesNotContain("client_token");
            assertThat(body).doesNotContain("callback");
        }
    }

    @Test
    @DisplayName("纯音频源 → 出站 audio_url（官方双协议输入二选一），不发 video_url")
    void submitAudioSourceUsesAudioUrl() {
        new NewApiMediaKitSeparateVoiceClient(baseUrl).submit(
                "sk-token", "https://example.com/source_audio.mp3", false, "music", "mp3");

        assertThat(lastBody.get()).contains("\"audio_url\":\"https://example.com/source_audio.mp3\"");
        assertThat(lastBody.get()).doesNotContain("video_url");
        assertThat(lastBody.get()).contains("\"scene\":\"Music\"");
        assertThat(lastBody.get()).contains("\"output_format\":\"mp3\"");
    }

    @Test
    @DisplayName("鉴权与生成家族同构：Bearer + X-Client-System: bluewhale + X-Trace-Id")
    void standardHeadersSameAsGenerationFamily() {
        callSubmit("audio", "aac");

        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
    }

    @Test
    @DisplayName("submit 场景枚举外 → invalid_input（兜底防御）")
    void submitUnknownScene_invalidInput() {
        Throwable thrown = catchThrowable(() -> callSubmit("Audio", "aac"));

        assertThat(((VocalSplitError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("submit 输出格式枚举外 → invalid_input（兜底防御；ogg 是 media_extract 面）")
    void submitUnknownFormat_invalidInput() {
        Throwable thrown = catchThrowable(() -> callSubmit("audio", "ogg"));

        assertThat(((VocalSplitError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_INVALID_INPUT);
    }

    // ========== submit：响应与错误分类（官方错误结构 error{code,message,param,type}） ==========

    @Test
    @DisplayName("网关 400（官方同步错误结构）→ 抛错，上游可读原因透传到 message")
    void gateway400TransportsUpstreamReason() {
        lastStatus.set(400);
        responseJson.set("{\"success\":false,\"task_id\":\"\",\"request_id\":\"req-1\","
                + "\"error\":{\"code\":\"InvalidParameter\",\"message\":\"The parameter `scene` is invalid."
                + " Supported values are: Audio, Music, Drama, Narrate.\","
                + "\"param\":\"scene\",\"type\":\"BadRequest\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("audio", "aac"));

        assertThat(thrown).isInstanceOf(VocalSplitError.class);
        assertThat(((VocalSplitError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(thrown.getMessage()).contains("HTTP 400");
        assertThat(thrown.getMessage()).contains("Supported values are: Audio, Music, Drama, Narrate");
    }

    @Test
    @DisplayName("网关 400 内容政策信号 → content_rejected（§5 分类保留）")
    void gateway400ContentPolicySignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"error\":{\"message\":\"content policy violation\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("audio", "aac"));

        assertThat(((VocalSplitError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("网关 402 额度信号 → quota_exhausted（§5 分类保留）")
    void gateway402QuotaSignalKept() {
        lastStatus.set(402);
        responseJson.set("{\"message\":\"insufficient balance\"}");

        Throwable thrown = catchThrowable(() -> callSubmit("audio", "aac"));

        assertThat(((VocalSplitError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("200 但缺 task_id → 1047 兜底")
    void missingTaskIdFallsBack() {
        responseJson.set("{\"success\":true,\"request_id\":\"req-3\"}");

        Throwable thrown = catchThrowable(() -> callSubmit("audio", "aac"));

        assertThat(((VocalSplitError) thrown).getCode())
                .isEqualTo(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
    }

    @Test
    @DisplayName("非 JSON 响应 → 1047 兜底")
    void invalidJsonFallsBack() {
        responseJson.set("not-json<");

        Throwable thrown = catchThrowable(() -> callSubmit("audio", "aac"));

        assertThat(((VocalSplitError) thrown).getCode())
                .isEqualTo(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
    }

    // ========== poll：端点路径与三态解析（官方「第 2 步：获取结果」节） ==========

    @Test
    @DisplayName("poll completed 二分法（Audio/Music）：GET 查询路径拼 taskId，解析两轨 URL 与 duration")
    void pollCompletedParsesTwoTracks() {
        // 官方 PDF「第 2 步」示例逐字形状（二分法 result 仅 voice/background 两键）
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-separate-voice-12345678\","
                + "\"task_type\":\"separate-voice\",\"status\":\"completed\","
                + "\"result\":{\"voice_audio_url\":\"https://example.volcvideo.com/voice.aac?auth_key=...\","
                + "\"background_audio_url\":\"https://example.volcvideo.com/background.aac?auth_key=...\","
                + "\"duration\":120.5},"
                + "\"expires_at\":1777464650,\"created_at\":1777291767,\"finished_at\":1777291851,"
                + "\"request_id\":\"20260417110100F1G2H3I4J5K6L7M8N9\"}");

        SeparateVoiceTaskObservation observation =
                new NewApiMediaKitSeparateVoiceClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(lastMethod.get()).isEqualTo("GET");
        assertThat(lastPath.get())
                .isEqualTo(VocalSplitContract.POLL_PATH_PREFIX + "amk-tool-1");
        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.trackUrls()).hasSize(2);
        assertThat(observation.trackUrls().get("voice"))
                .isEqualTo("https://example.volcvideo.com/voice.aac?auth_key=...");
        assertThat(observation.trackUrls().get("background"))
                .isEqualTo("https://example.volcvideo.com/background.aac?auth_key=...");
        assertThat(observation.durationSec()).isEqualTo(120.5);
    }

    @Test
    @DisplayName("poll completed 三分法（Drama/Narrate）：解析 voice/music/sfx 三轨 URL")
    void pollCompletedParsesThreeTracks() {
        // 官方 PDF「选择分离场景」节：三分法 result 含 voice/music/sfx 三键（无 background）
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-separate-voice-8\","
                + "\"task_type\":\"separate-voice\",\"status\":\"completed\","
                + "\"result\":{\"voice_audio_url\":\"https://volc/voice.aac\","
                + "\"music_audio_url\":\"https://volc/music.aac\","
                + "\"sfx_audio_url\":\"https://volc/sfx.aac\","
                + "\"duration\":95.0}}");

        SeparateVoiceTaskObservation observation =
                new NewApiMediaKitSeparateVoiceClient(baseUrl).poll("sk-token", "amk-tool-8");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.trackUrls()).hasSize(3);
        assertThat(observation.trackUrls().get("voice")).isEqualTo("https://volc/voice.aac");
        assertThat(observation.trackUrls().get("music")).isEqualTo("https://volc/music.aac");
        assertThat(observation.trackUrls().get("sfx")).isEqualTo("https://volc/sfx.aac");
        assertThat(observation.trackUrls()).doesNotContainKey("background");
        assertThat(observation.durationSec()).isEqualTo(95.0);
    }

    @Test
    @DisplayName("poll 中间态（running）→ processing，无结果字段")
    void pollRunningIsProcessing() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-1\",\"status\":\"running\","
                + "\"request_id\":\"req-5\"}");

        SeparateVoiceTaskObservation observation =
                new NewApiMediaKitSeparateVoiceClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(observation.status()).isEqualTo("processing");
        assertThat(observation.trackUrls()).isNull();
    }

    @Test
    @DisplayName("poll failed → failed + 上游错误码与可读原因（透传给前端投影）")
    void pollFailedCarriesUpstreamError() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-1\",\"status\":\"failed\","
                + "\"error\":{\"code\":\"AudioParseFailed\",\"message\":\"输入音频解析失败\"}}");

        SeparateVoiceTaskObservation observation =
                new NewApiMediaKitSeparateVoiceClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.upstreamCode()).isEqualTo("AudioParseFailed");
        assertThat(observation.upstreamMessage()).contains("输入音频解析失败");
    }

    @Test
    @DisplayName("poll 网关 data 信封 → 解包后仍取到 status / result 多轨")
    void pollUnwrapsDataEnvelope() {
        responseJson.set("{\"data\":{\"task_id\":\"amk-tool-1\",\"status\":\"completed\","
                + "\"result\":{\"voice_audio_url\":\"https://volc/v.aac\","
                + "\"background_audio_url\":\"https://volc/b.aac\",\"duration\":12.0}}}");

        SeparateVoiceTaskObservation observation =
                new NewApiMediaKitSeparateVoiceClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.trackUrls()).hasSize(2);
        assertThat(observation.trackUrls().get("voice")).isEqualTo("https://volc/v.aac");
    }

    @Test
    @DisplayName("poll 网关 data 信封 failed → 解包后仍取到上游可读原因")
    void pollFailedDataEnvelopeKeepsUpstreamMessage() {
        responseJson.set("{\"data\":{\"task_id\":\"amk-tool-1\",\"status\":\"failed\","
                + "\"error\":{\"code\":\"AudioParseFailed\",\"message\":\"输入音频解析失败\"}}}");

        SeparateVoiceTaskObservation observation =
                new NewApiMediaKitSeparateVoiceClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.upstreamCode()).isEqualTo("AudioParseFailed");
        assertThat(observation.upstreamMessage()).contains("输入音频解析失败");
    }

    @Test
    @DisplayName("poll HTTP 500 → provider_failed 且 cause 携带状态（processor 判瞬时重排）")
    void pollServerErrorCarriesStatus() {
        lastStatus.set(500);
        responseJson.set("{\"message\":\"upstream busy\"}");

        Throwable thrown = catchThrowable(() ->
                new NewApiMediaKitSeparateVoiceClient(baseUrl).poll("sk-token", "amk-tool-1"));

        assertThat(thrown).isInstanceOf(VocalSplitError.class);
        VocalSplitError error = (VocalSplitError) thrown;
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(error.getCause()).isInstanceOf(NewApiVideoClient.HttpStatusException.class);
        assertThat(((NewApiVideoClient.HttpStatusException) error.getCause()).getStatus()).isEqualTo(500);
    }

    @Test
    @DisplayName("poll 响应缺 status → provider_failed（非瞬时，不静默当 processing）")
    void pollMissingStatusFails() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-1\"}");

        Throwable thrown = catchThrowable(() ->
                new NewApiMediaKitSeparateVoiceClient(baseUrl).poll("sk-token", "amk-tool-1"));

        assertThat(((VocalSplitError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }
}
