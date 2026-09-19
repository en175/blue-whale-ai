package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.entity.MediaExtractContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitExtractAudioClient.ExtractAudioTaskObservation;
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
 * NewApiMediaKitExtractAudioClient 接口级 mock 网关测试（迁移契约 §18 / IKH28W）。
 * <p>
 * 覆盖：出站映射（官方 PDF Body 参数节：video_url + format 透传、对客模型名、契约
 * SUBMIT_PATH 路径）、标准请求头三元组、submit 响应 task_id 解析与缺失兜底、官方错误
 * 结构 error{code,type,message,param} 的 §5 分类与上游原因透传、poll 端点路径与三态解析
 * （completed / failed / 中间态，result.audio_url / result.duration）、HTTP 错误携带状态
 * （瞬时判定输入）。不连真实网关。参数名以火山官方 PDF「提交音频提取任务 API」为准。
 */
class NewApiMediaKitExtractAudioClientTest {

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
        // 官方「任务提交成功响应」示例形状（PDF「响应说明」节逐字）
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-extract-audio-1400500\","
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

    private String callSubmit(String outputFormat) {
        return new NewApiMediaKitExtractAudioClient(baseUrl).submit(
                "sk-token", "https://example.com/source_video.mp4", outputFormat);
    }

    // ========== submit：出站映射（官方 PDF Body 参数节） ==========

    @Test
    @DisplayName("mp3：契约 SUBMIT_PATH 路径 + 对客模型名 + video_url + format 同名透传")
    void submitMp3MapsOfficialParams() {
        String taskId = callSubmit("mp3");

        assertThat(taskId).isEqualTo("amk-tool-extract-audio-1400500");
        assertThat(lastPath.get()).isEqualTo(MediaExtractContract.SUBMIT_PATH);
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"mediakit-extract-audio\"");
        assertThat(body).contains("\"video_url\":\"https://example.com/source_video.mp4\"");
        assertThat(body).contains("\"format\":\"mp3\"");
        // 不发 media_output_destination（默认临时链接 + 自家转存）与其余可选参数
        assertThat(body).doesNotContain("media_output_destination");
        assertThat(body).doesNotContain("client_token");
        assertThat(body).doesNotContain("callback");
    }

    @Test
    @DisplayName("m4a（缺省格式）：format=m4a 透传；ogg/flac/wav 同链路（枚举单源在契约）")
    void submitM4aMapsFormat() {
        callSubmit("m4a");

        assertThat(lastPath.get()).isEqualTo(MediaExtractContract.SUBMIT_PATH);
        assertThat(lastBody.get()).contains("\"format\":\"m4a\"");
    }

    @Test
    @DisplayName("鉴权与生成家族同构：Bearer + X-Client-System: bluewhale + X-Trace-Id")
    void standardHeadersSameAsGenerationFamily() {
        callSubmit("mp3");

        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(lastClientSystem.get()).isEqualTo("bluewhale");
        assertThat(lastTraceId.get()).isNotBlank();
    }

    @Test
    @DisplayName("submit 输出格式枚举外 → invalid_input（兜底防御）")
    void submitUnknownFormat_invalidInput() {
        Throwable thrown = catchThrowable(() -> callSubmit("aac"));

        assertThat(((MediaExtractError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_INVALID_INPUT);
    }

    // ========== submit：响应与错误分类（官方错误结构 error{code,message,param,type}） ==========

    @Test
    @DisplayName("网关 400（官方同步错误结构）→ 抛错，上游可读原因透传到 message")
    void gateway400TransportsUpstreamReason() {
        lastStatus.set(400);
        // 官方 PDF「错误处理」节示例逐字（InvalidParameter format）
        responseJson.set("{\"success\":false,\"task_id\":\"\",\"request_id\":\"20240520184500BBCCDD112233\","
                + "\"error\":{\"code\":\"InvalidParameter\",\"message\":\"The parameter `format` is invalid."
                + " Supported values are: mp3, m4a.\",\"param\":\"format\",\"type\":\"BadRequest\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("mp3"));

        assertThat(thrown).isInstanceOf(MediaExtractError.class);
        assertThat(((MediaExtractError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(thrown.getMessage()).contains("HTTP 400");
        assertThat(thrown.getMessage()).contains("Supported values are: mp3, m4a");
    }

    @Test
    @DisplayName("网关 400 内容政策信号 → content_rejected（§5 分类保留）")
    void gateway400ContentPolicySignalKept() {
        lastStatus.set(400);
        responseJson.set("{\"error\":{\"message\":\"content policy violation\"}}");

        Throwable thrown = catchThrowable(() -> callSubmit("mp3"));

        assertThat(((MediaExtractError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("网关 402 额度信号 → quota_exhausted（§5 分类保留）")
    void gateway402QuotaSignalKept() {
        lastStatus.set(402);
        responseJson.set("{\"message\":\"insufficient balance\"}");

        Throwable thrown = catchThrowable(() -> callSubmit("mp3"));

        assertThat(((MediaExtractError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("200 但缺 task_id → 1044 兜底")
    void missingTaskIdFallsBack() {
        responseJson.set("{\"success\":true,\"request_id\":\"req-3\"}");

        Throwable thrown = catchThrowable(() -> callSubmit("mp3"));

        assertThat(((MediaExtractError) thrown).getCode())
                .isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
    }

    @Test
    @DisplayName("非 JSON 响应 → 1044 兜底")
    void invalidJsonFallsBack() {
        responseJson.set("not-json<");

        Throwable thrown = catchThrowable(() -> callSubmit("mp3"));

        assertThat(((MediaExtractError) thrown).getCode())
                .isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
    }

    // ========== poll：端点路径与三态解析（官方「异步任务结果」节） ==========

    @Test
    @DisplayName("poll completed：GET 查询路径拼 taskId，解析 result.audio_url 与 duration 秒")
    void pollCompletedParsesResult() {
        // 官方 PDF「最终的完整任务信息示例」节逐字形状 + 查询端点的 status 字段
        //（官方 PDF 无查询端点文档，status 按去字幕家族先例容错解析）
        responseJson.set("{\"success\":true,\"task_id\":\"amk_tool_extract_audio_1400500\","
                + "\"request_id\":\"20260325160000A8DE7F57A9B3E17A0DD2\","
                + "\"status\":\"completed\","
                + "\"result\":{\"audio_url\":\"https://example.volcvideo.com/extracted_output.mp3"
                + "?auth_key=1774612861-...\",\"duration\":360.5},"
                + "\"expires_at\":1777464650,\"created_at\":1777291767,\"finished_at\":1777291851}");

        ExtractAudioTaskObservation observation =
                new NewApiMediaKitExtractAudioClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(lastMethod.get()).isEqualTo("GET");
        assertThat(lastPath.get())
                .isEqualTo(MediaExtractContract.POLL_PATH_PREFIX + "amk-tool-1");
        assertThat(lastAuthorization.get()).isEqualTo("Bearer sk-token");
        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.audioUrl())
                .isEqualTo("https://example.volcvideo.com/extracted_output.mp3?auth_key=1774612861-...");
        assertThat(observation.durationSec()).isEqualTo(360.5);
    }

    @Test
    @DisplayName("poll 中间态（running）→ processing，无结果字段")
    void pollRunningIsProcessing() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-1\",\"status\":\"running\","
                + "\"request_id\":\"req-5\"}");

        ExtractAudioTaskObservation observation =
                new NewApiMediaKitExtractAudioClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(observation.status()).isEqualTo("processing");
        assertThat(observation.audioUrl()).isNull();
    }

    @Test
    @DisplayName("poll failed → failed + 上游错误码与可读原因（透传给前端投影）")
    void pollFailedCarriesUpstreamError() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-1\",\"status\":\"failed\","
                + "\"error\":{\"code\":\"VideoParseFailed\",\"message\":\"输入视频解析失败\"}}");

        ExtractAudioTaskObservation observation =
                new NewApiMediaKitExtractAudioClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.upstreamCode()).isEqualTo("VideoParseFailed");
        assertThat(observation.upstreamMessage()).contains("输入视频解析失败");
    }

    @Test
    @DisplayName("poll 网关 data 信封 → 解包后仍取到 status / result")
    void pollUnwrapsDataEnvelope() {
        responseJson.set("{\"data\":{\"task_id\":\"amk-tool-1\",\"status\":\"completed\","
                + "\"result\":{\"audio_url\":\"https://volc/out.m4a\",\"duration\":12.0}}}");

        ExtractAudioTaskObservation observation =
                new NewApiMediaKitExtractAudioClient(baseUrl).poll("sk-token", "amk-tool-1");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.audioUrl()).isEqualTo("https://volc/out.m4a");
    }

    @Test
    @DisplayName("poll HTTP 500 → provider_failed 且 cause 携带状态（processor 判瞬时重排）")
    void pollServerErrorCarriesStatus() {
        lastStatus.set(500);
        responseJson.set("{\"message\":\"upstream busy\"}");

        Throwable thrown = catchThrowable(() ->
                new NewApiMediaKitExtractAudioClient(baseUrl).poll("sk-token", "amk-tool-1"));

        assertThat(thrown).isInstanceOf(MediaExtractError.class);
        MediaExtractError error = (MediaExtractError) thrown;
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
        assertThat(error.getCause()).isInstanceOf(NewApiVideoClient.HttpStatusException.class);
        assertThat(((NewApiVideoClient.HttpStatusException) error.getCause()).getStatus()).isEqualTo(500);
    }

    @Test
    @DisplayName("poll 响应缺 status → provider_failed（非瞬时，不静默当 processing）")
    void pollMissingStatusFails() {
        responseJson.set("{\"success\":true,\"task_id\":\"amk-tool-1\"}");

        Throwable thrown = catchThrowable(() ->
                new NewApiMediaKitExtractAudioClient(baseUrl).poll("sk-token", "amk-tool-1"));

        assertThat(((MediaExtractError) thrown).getCode())
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }
}
