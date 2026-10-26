package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.infrastructure.config.GenerationWatermarkConfig.GenerationWatermarkPolicy;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.SubmitResult;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoReference;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoSubmitInput;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "seedance-2", "一只猫在跑步", 5.0, "720p", "16:9",
                null, null, List.of(), null));
        assertThat(JSON.readTree(lastBody.get()).get("metadata").has("generate_audio")).isFalse();
    }

    @Test
    @DisplayName("IKK1T4 编辑单：edit → omni=edit，出站 ratio/duration 原样透传（不再静默改写）")
    void seedance25EditTaskKeepsUserRatioAndDuration() throws Exception {
        VideoSubmitInput input = new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "把杯子换成红色", -1.0, "720p", "adaptive", null, null,
                List.of(new VideoReference("video", "https://tos.test/ref.mp4", null)),
                null, false, "edit");

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", input);

        JsonNode body = JSON.readTree(lastBody.get());
        assertThat(body.get("metadata").get("omni_reference_task_type").asText()).isEqualTo("edit");
        assertThat(body.get("duration").asDouble()).isEqualTo(-1.0);
        assertThat(body.get("metadata").get("duration").asDouble()).isEqualTo(-1.0);
        assertThat(body.get("metadata").get("ratio").asText()).isEqualTo("adaptive");
        assertThat(body.get("model").asText()).isEqualTo("doubao-seedance-2-5-260628");
        assertThat(body.get("metadata").get("resolution").asText()).isEqualTo("720p");
    }

    @ParameterizedTest
    @ValueSource(doubles = {-1, 4, 10, 30})
    @DisplayName("IKLUVP 延长单：extend → omni=extend，ratio/duration 均原样透传")
    void seedance25ProlongTaskKeepsUserRatioAndDuration(double duration) throws Exception {
        VideoSubmitInput input = new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "把视频向后延长", duration, "720p", "adaptive", null, null,
                List.of(new VideoReference("video", "https://tos.test/ref.mp4", null)),
                null, false, "extend");

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", input);

        JsonNode body = JSON.readTree(lastBody.get());
        assertThat(body.get("metadata").get("omni_reference_task_type").asText()).isEqualTo("extend");
        assertThat(body.get("metadata").get("ratio").asText()).isEqualTo("adaptive");
        assertThat(body.get("duration").asDouble()).isEqualTo(duration);
        assertThat(body.get("metadata").get("duration").asDouble()).isEqualTo(duration);
    }

    @Test
    @DisplayName("IKJ79A 纯参考单：default → omni=reference 且用户比例/时长原样透传（首次真正生效）")
    void seedance25ReferenceTaskPassesThroughUserRatioAndDuration() throws Exception {
        VideoSubmitInput input = new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "一只猫在海边跑步", 8.0, "720p", "9:16", null, null,
                List.of(new VideoReference("video", "https://tos.test/ref.mp4", null),
                        new VideoReference("image", "https://tos.test/a.png", null)),
                null, false, "default");

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", input);

        JsonNode body = JSON.readTree(lastBody.get());
        assertThat(body.get("metadata").get("omni_reference_task_type").asText()).isEqualTo("reference");
        assertThat(body.get("metadata").get("ratio").asText()).isEqualTo("9:16");
        assertThat(body.get("duration").asDouble()).isEqualTo(8.0);
        assertThat(body.get("metadata").get("duration").asDouble()).isEqualTo(8.0);
    }

    @Test
    @DisplayName("IKK1T4 存量快照：无能力位冻结 → 不下发 omni；位为 true 时按模式下发")
    void legacySnapshotWithoutCapabilityFlagSendsNoOmniTaskType() throws Exception {
        VideoSubmitInput legacy = new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "一只猫在跑步", 5.0, "720p", "16:9", null, null,
                List.of(new VideoReference("video", "https://tos.test/ref.mp4", null)),
                null);

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", legacy);

        JsonNode body = JSON.readTree(lastBody.get());
        assertThat(body.get("metadata").has("omni_reference_task_type")).isFalse();
        assertThat(body.get("metadata").get("ratio").asText()).isEqualTo("16:9");
        assertThat(body.get("duration").asDouble()).isEqualTo(5.0);

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "一只猫在跑步", 5.0, "720p", "16:9", null, null,
                List.of(new VideoReference("video", "https://tos.test/ref.mp4", null)),
                null, false, "banana", true));
        assertThat(JSON.readTree(lastBody.get()).get("metadata").get("omni_reference_task_type").asText())
                .isEqualTo("reference");
    }

    @Test
    @DisplayName("IKK1T4 边界：能力位 false 与首尾帧/无参考视频均不下发 omni、原值不动")
    void omniTaskTypeGatedByCapabilityFlagAndVideoReference() throws Exception {
        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "doubao-seedance-2-0-260128", "把杯子换成红色", 5.0, "720p", "16:9", null, null,
                List.of(new VideoReference("video", "https://tos.test/ref.mp4", null)),
                null, false, "edit", false));
        JsonNode seedance20 = JSON.readTree(lastBody.get());
        assertThat(seedance20.get("metadata").has("omni_reference_task_type")).isFalse();
        assertThat(seedance20.get("duration").asDouble()).isEqualTo(5.0);
        assertThat(seedance20.get("metadata").get("ratio").asText()).isEqualTo("16:9");

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "一只猫在跑步", 5.0, "720p", "adaptive",
                "https://tos.test/first.png", "https://tos.test/last.png",
                List.of(), null, false, "first_last_frame"));
        JsonNode firstLast = JSON.readTree(lastBody.get());
        assertThat(firstLast.get("metadata").has("omni_reference_task_type")).isFalse();
        assertThat(firstLast.get("duration").asDouble()).isEqualTo(5.0);

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "把杯子换成红色", 5.0, "720p", "16:9", null, null,
                List.of(new VideoReference("image", "https://tos.test/a.png", null)),
                null, false, "edit"));
        JsonNode imageOnly = JSON.readTree(lastBody.get());
        assertThat(imageOnly.get("metadata").has("omni_reference_task_type")).isFalse();
        assertThat(imageOnly.get("metadata").get("ratio").asText()).isEqualTo("16:9");
    }

    @Test
    @DisplayName("IKJ79A: poll 异步 TaskTypeMismatch/TaskTypeConstraint → task_type_param_constraint")
    void pollTaskTypeMismatchMapsToUserFacingConstraintCode() throws Exception {
        server.createContext("/v1/video/generations/task-mismatch", exchange -> {
            byte[] resp = ("{\"task_id\":\"task-mismatch\",\"status\":\"FAILURE\"," +
                    "\"error\":{\"code\":\"InvalidParameter.TaskTypeMismatch\"," +
                    "\"message\":\"The actual task type is inconsistent with the specified omni_reference_task_type.\"}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });
        server.createContext("/v1/video/generations/task-constraint", exchange -> {
            byte[] resp = ("{\"task_id\":\"task-constraint\",\"status\":\"FAILURE\"," +
                    "\"fail_reason\":\"InvalidParameter.TaskTypeConstraint: ratio must be adaptive when omni_reference_task_type is edit.\"}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        NewApiVideoClient client = new NewApiVideoClient(new UpstreamBaseUrl(baseUrl));
        VideoTaskObservation mismatch = client.poll("t", "task-mismatch");
        assertThat(mismatch.status()).isEqualTo("failed");
        assertThat(mismatch.error().code()).isEqualTo("task_type_param_constraint");

        VideoTaskObservation constraint = client.poll("t", "task-constraint");
        assertThat(constraint.status()).isEqualTo("failed");
        assertThat(constraint.error().code()).isEqualTo("task_type_param_constraint");
    }

    @Test
    @DisplayName("IKPPYX: submit 400 视频编辑英文正文 → task_type_param_constraint")
    void submitVideoEditProseMapsToTaskTypeConstraint() throws Exception {
        String text = "The parameters `ratio` and `duration` specified in the request are not valid. "
                + "Seedance identified your task as video editing based on your prompt. "
                + "Issues: [0] `ratio` must be `adaptive`. [1] `duration` must be -1.";
        server.createContext("/v1/video/generations", exchange -> {
            byte[] resp = ("{\"error\":{\"message\":\"" + text + "\"}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(400, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoSubmitInput input = new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "把背景改成海边", 5.0, "720p", "16:9",
                null, null,
                List.of(new VideoReference("video", "https://tos.test/src.mp4", null)),
                null);

        assertThatThrownBy(() -> new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", input))
                .isInstanceOf(VideoProviderError.class)
                .satisfies(e -> assertThat(((VideoProviderError) e).getCode())
                        .isEqualTo("task_type_param_constraint"));
    }

    @Test
    @DisplayName("IKPPYX: submit 400 视频编辑正文 + 额度信号 → platform_quota_exhausted（守卫不覆盖）")
    void submitVideoEditProseWithQuotaSignalKeepsQuota() throws Exception {
        String text = "余额不足。The parameters `ratio` and `duration` specified in the request are not valid. "
                + "Seedance identified your task as video editing based on your prompt.";
        server.createContext("/v1/video/generations", exchange -> {
            byte[] resp = ("{\"error\":{\"message\":\"" + text + "\"}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(400, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoSubmitInput input = new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "把背景改成海边", 5.0, "720p", "16:9",
                null, null,
                List.of(new VideoReference("video", "https://tos.test/src.mp4", null)),
                null);

        assertThatThrownBy(() -> new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", input))
                .isInstanceOf(VideoProviderError.class)
                .satisfies(e -> assertThat(((VideoProviderError) e).getCode())
                        .isEqualTo("platform_quota_exhausted"));
    }

    @Test
    @DisplayName("IKPPYX: submit 400 普通 InvalidParameter → provider_failed")
    void submitPlainInvalidParameterKeepsProviderFailed() throws Exception {
        server.createContext("/v1/video/generations", exchange -> {
            byte[] resp = "{\"error\":{\"message\":\"InvalidParameter: The request parameter is not valid.\"}}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(400, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoSubmitInput input = new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "一只猫在跑步", 5.0, "720p", "16:9",
                null, null, List.of(), null);

        assertThatThrownBy(() -> new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", input))
                .isInstanceOf(VideoProviderError.class)
                .satisfies(e -> assertThat(((VideoProviderError) e).getCode())
                        .isEqualTo("provider_failed"));
    }

    @Test
    @DisplayName("IKPPYX: poll FAILURE 视频编辑英文正文 → task_type_param_constraint")
    void pollVideoEditProseMapsToTaskTypeConstraint() throws Exception {
        String text = "The parameters `ratio` and `duration` specified in the request are not valid. "
                + "Seedance identified your task as video editing based on your prompt. "
                + "Issues: [0] `ratio` must be `adaptive`. [1] `duration` must be -1.";
        server.createContext("/v1/video/generations/task-edit-prose", exchange -> {
            byte[] resp = ("{\"task_id\":\"task-edit-prose\",\"status\":\"FAILURE\"," +
                    "\"fail_reason\":\"" + text + "\"}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-edit-prose");
        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.error()).isNotNull();
        assertThat(observation.error().code()).isEqualTo("task_type_param_constraint");
    }

    @ParameterizedTest
    @ValueSource(strings = {"InvalidParameter.TaskTypeConstraint", "InvalidParameter.TaskTypeMismatch"})
    @DisplayName("IKNB96: 网关任务内层上游错误映射参数约束，保留任务层状态与用量")
    void pollNestedProviderTaskTypeErrorKeepsGatewayTask(String upstreamCode) throws Exception {
        server.createContext("/v1/video/generations/task-nested-error", exchange -> {
            byte[] resp = ("""
                    {"data":{"task_id":"task-nested-error","status":"FAILURE",
                    "fail_reason":"The task does not meet the duration requirements.",
                    "quota":120,"usage":{"total_tokens":345},"created_at":1790647200,
                    "data":{"id":"provider-task","status":"SUCCESS","result_url":"https://provider/ignored.mp4",
                    "error":{"code":"%s","message":"Please check the video mode and duration."}}}}
                    """).formatted(upstreamCode).getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-nested-error");

        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.error().code()).isEqualTo("task_type_param_constraint");
        assertThat(observation.error().message()).isEqualTo("Please check the video mode and duration.");
        assertThat(observation.quota()).isEqualTo(120);
        assertThat(observation.totalTokens()).isEqualTo(345L);
        assertThat(observation.upstreamCreatedAtMs()).isEqualTo(1_790_647_200_000L);
        assertThat(observation.url()).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"SUCCESS", "PROCESSING"})
    @DisplayName("IKNB96: 内层供应商失败不覆盖网关成功或处理中状态与结果")
    void pollNestedErrorDoesNotReplaceGatewayStatusAndResult(String status) throws Exception {
        server.createContext("/v1/video/generations/task-gateway-status", exchange -> {
            byte[] resp = ("""
                    {"data":{"task_id":"task-gateway-status","status":"%s",
                    "result_url":"https://gateway/result.mp4","quota":120,
                    "data":{"id":"provider-task","status":"FAILURE","result_url":"https://provider/ignored.mp4",
                    "error":{"code":"InvalidParameter.TaskTypeConstraint","message":"rejected"}}}}
                    """).formatted(status).getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-gateway-status");

        boolean succeeded = "SUCCESS".equals(status);
        assertThat(observation.status()).isEqualTo(succeeded ? "succeeded" : "processing");
        assertThat(observation.url()).isEqualTo(succeeded ? "https://gateway/result.mp4" : null);
        assertThat(observation.error()).isNull();
        assertThat(observation.quota()).isEqualTo(120);
    }

    @ParameterizedTest
    @ValueSource(strings = {"task", "provider", "top"})
    @DisplayName("IKNB96: 结构化错误按任务层、供应商层、信封顶层顺序选取")
    void pollStructuredErrorPrecedence(String layer) throws Exception {
        ObjectNode envelope = JSON.createObjectNode();
        envelope.putObject("error").put("code", "top_error").put("message", "top message");
        ObjectNode task = envelope.putObject("data");
        task.put("task_id", "task-error-priority").put("status", "FAILURE");
        if (!"top".equals(layer)) {
            task.putObject("data").putObject("error")
                    .put("code", "provider_error").put("message", "provider message");
        }
        if ("task".equals(layer)) {
            task.putObject("error").put("code", "task_error").put("message", "task message");
        }
        server.createContext("/v1/video/generations/task-error-priority", exchange -> {
            byte[] resp = envelope.toString().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-error-priority");

        assertThat(observation.error().code()).isEqualTo(layer + "_error");
        assertThat(observation.error().message()).isEqualTo(layer + " message");
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
        assertThat(observation.error().code()).isEqualTo("content_rejected_reference");
    }

    @Test
    @DisplayName("IKJ8J8: poll FAILURE + OutputAudioSensitiveContentDetected → content_rejected_audio（1059）")
    void pollOutputAudioCodeMapsToContentRejectedAudio() throws Exception {
        server.createContext("/v1/video/generations/task-audio-copyright", exchange -> {
            byte[] resp = ("{\"task_id\":\"task-audio-copyright\",\"status\":\"FAILURE\"," +
                    "\"error\":{\"code\":\"OutputAudioSensitiveContentDetected.PolicyViolation\"," +
                    "\"message\":\"The generated audio may involve copyright restrictions. Please revise your input and retry.\"}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-audio-copyright");
        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.error()).isNotNull();
        assertThat(observation.error().code()).isEqualTo("content_rejected_audio");
        assertThat(observation.error().message()).contains("copyright restrictions");
    }

    @Test
    @DisplayName("IKJ8J8: poll 顶层 fail_reason 含 output audio 版权（data.error 缺 code）→ content_rejected_audio")
    void pollTopLevelFailReasonOutputAudioMapsToContentRejectedAudio() throws Exception {
        server.createContext("/v1/video/generations/task-audio-failreason", exchange -> {
            byte[] resp = ("{\"task_id\":\"task-audio-failreason\",\"status\":\"FAILURE\"," +
                    "\"fail_reason\":\"The request failed because the output audio may be related to copyright restrictions. Request id: req-audio\"," +
                    "\"error\":{\"message\":\"audio generation rejected\"}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-audio-failreason");
        assertThat(observation.status()).isEqualTo("failed");
        assertThat(observation.error()).isNotNull();
        assertThat(observation.error().code()).isEqualTo("content_rejected_audio");
    }

    @Test
    @DisplayName("IKJ80M: submit 超时 ≥120s 且经 submitClient 配置生效（网关带视频参考提交实测 ~51s）")
    void submitTimeoutAtLeast120sAppliedToClient() throws Exception {
        Field timeoutField = NewApiVideoClient.class.getDeclaredField("SUBMIT_TIMEOUT_MS");
        timeoutField.setAccessible(true);
        int submitTimeoutMs = timeoutField.getInt(null);

        assertThat(submitTimeoutMs).isGreaterThanOrEqualTo(120_000);

        Field clientField = NewApiVideoClient.class.getDeclaredField("submitClient");
        clientField.setAccessible(true);
        OkHttpClient submitClient =
                (OkHttpClient) clientField.get(new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)));
        assertThat(submitClient.readTimeoutMillis()).isEqualTo(submitTimeoutMs);
        assertThat(submitClient.writeTimeoutMillis()).isEqualTo(submitTimeoutMs);
    }

    @Test
    @DisplayName("IKJ80I: video 租约 > submit 三超时串行最坏耗时（防 recovery 重投双扣回归）")
    void videoLeaseExceedsSubmitWorstCase() throws Exception {
        Field leaseField = JobClaimService.class.getDeclaredField("VIDEO_LEASE_SECONDS");
        leaseField.setAccessible(true);
        int videoLeaseSeconds = leaseField.getInt(null);

        Field clientField = NewApiVideoClient.class.getDeclaredField("submitClient");
        clientField.setAccessible(true);
        OkHttpClient submitClient =
                (OkHttpClient) clientField.get(new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)));
        long submitWorstCaseMs = (long) submitClient.connectTimeoutMillis()
                + submitClient.writeTimeoutMillis() + submitClient.readTimeoutMillis();

        assertThat(videoLeaseSeconds * 1000L).isGreaterThan(submitWorstCaseMs);
    }

    @Test
    @DisplayName("IKJ80P: submit 读超时 → VideoProviderError 携带 SocketTimeoutException cause（孤儿判定信号）")
    void submitReadTimeoutCarriesSocketTimeoutCause() throws Exception {
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
            }
        });

        NewApiVideoClient client = new NewApiVideoClient(new UpstreamBaseUrl(baseUrl));
        Field clientField = NewApiVideoClient.class.getDeclaredField("submitClient");
        clientField.setAccessible(true);
        clientField.set(client, NewApiHttpSupport.buildClient(1_000, 300, 300));

        assertThatThrownBy(() -> client.submit("t", new VideoSubmitInput(
                "seedance-2", "一只猫在跑步", 5.0, "720p", "16:9",
                null, null, List.of(), null)))
                .isInstanceOf(VideoProviderError.class)
                .hasMessage("new-api 视频提交超时")
                .hasCauseInstanceOf(java.net.SocketTimeoutException.class);
    }


    @Test
    @DisplayName("IKIZQ8: draft=true → 提交体带顶层 draft:true（网关读它开启 480p Draft 语义）")
    void draftSubmitCarriesTopLevelFlag() throws Exception {
        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "一只猫在跑步", 5.0, "480p", "16:9",
                null, null, List.of(), null, true, null));
        JsonNode draftBody = JSON.readTree(lastBody.get());
        assertThat(draftBody.get("draft").asBoolean()).isTrue();
        assertThat(draftBody.get("metadata").get("resolution").asText()).isEqualTo("480p");

        new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).submit("t", new VideoSubmitInput(
                "doubao-seedance-2-5-260628", "一只猫在跑步", 5.0, "1080p", "16:9",
                null, null, List.of(), null));
        assertThat(JSON.readTree(lastBody.get()).has("draft")).isFalse();
    }

    @Test
    @DisplayName("IKIZQ8: 轮询响应内层上游任务回显 data.data.created_at（Unix 秒）→ 毫秒")
    void pollExtractsUpstreamCreatedAtFromInnerEcho() throws Exception {
        server.createContext("/v1/video/generations/task-created", exchange -> {
            byte[] resp = ("{\"code\":\"success\",\"data\":{\"task_id\":\"task-created\","
                    + "\"status\":\"SUCCESS\",\"result_url\":\"https://tos/v.mp4\","
                    + "\"usage\":{\"total_tokens\":40594},"
                    + "\"data\":{\"created_at\":1790647200,\"resolution\":\"480p\"}}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-created");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.upstreamCreatedAtMs()).isEqualTo(1_790_647_200_000L);
    }

    @Test
    @DisplayName("IKIZQ8: 外层 created_at 优先；字符串毫秒/数值毫秒都认")
    void pollCreatedAtOuterFirstAndMsForms() throws Exception {
        server.createContext("/v1/video/generations/task-created-outer", exchange -> {
            byte[] resp = ("{\"data\":{\"task_id\":\"task-created-outer\",\"status\":\"SUCCESS\","
                    + "\"created_at\":1790647200,\"data\":{\"created_at\":9999999999}}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });
        server.createContext("/v1/video/generations/task-created-ms", exchange -> {
            byte[] resp = ("{\"data\":{\"task_id\":\"task-created-ms\",\"status\":\"SUCCESS\","
                    + "\"created_at\":\"1790647200000\"}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        NewApiVideoClient client = new NewApiVideoClient(new UpstreamBaseUrl(baseUrl));
        assertThat(client.poll("t", "task-created-outer").upstreamCreatedAtMs())
                .isEqualTo(1_790_647_200_000L);
        assertThat(client.poll("t", "task-created-ms").upstreamCreatedAtMs())
                .isEqualTo(1_790_647_200_000L);
    }

    @Test
    @DisplayName("IKIZQ8: 缺可信 created_at → null（不是 0）：样片仍交付、成片禁用")
    void pollMissingCreatedAtIsNull() throws Exception {
        server.createContext("/v1/video/generations/task-no-created", exchange -> {
            byte[] resp = ("{\"data\":{\"task_id\":\"no-created\",\"status\":\"SUCCESS\","
                    + "\"result_url\":\"https://tos/v.mp4\"}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        VideoTaskObservation observation =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).poll("t", "task-no-created");

        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.upstreamCreatedAtMs()).isNull();
    }


    @Test
    @DisplayName("IKIZQC: finalize → POST /v1/videos/{样片公开任务ID}/finalize，体仅 resolution=1080p")
    void finalizePostsToVideoFinalizePathWithResolutionOnly() throws Exception {
        SubmitResult result =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).finalize("t", "task-sample-9");

        assertThat(result.taskId()).isEqualTo("task-1");
        assertThat(result.status()).isEqualTo("queued");
        assertThat(lastPath.get()).isEqualTo("/v1/videos/task-sample-9/finalize");

        JsonNode body = JSON.readTree(lastBody.get());
        assertThat(body).hasSize(1);
        assertThat(body.get("resolution").asText()).isEqualTo("1080p");
    }

    @Test
    @DisplayName("IKIZQC: finalize 网关 data 信封响应 → 公开任务 ID 取出（轮询句柄）")
    void finalizeParsesGatewayEnvelope() throws Exception {
        server.createContext("/v1/videos/task-env/finalize", exchange -> {
            byte[] resp = ("{\"code\":\"success\",\"data\":{\"task_id\":\"task-final-77\","
                    + "\"status\":\"queued\"}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        SubmitResult result =
                new NewApiVideoClient(new UpstreamBaseUrl(baseUrl)).finalize("t", "task-env");

        assertThat(result.taskId()).isEqualTo("task-final-77");
        assertThat(result.status()).isEqualTo("queued");
    }

    @Test
    @DisplayName("IKIZQC: finalize 网关非 200（样片过期/非 Draft 等）→ VideoProviderError 分类码透出")
    void finalizeNon2xxSurfacesClassifiedError() {
        server.createContext("/v1/videos/task-expired/finalize", exchange -> {
            byte[] resp = ("{\"error\":{\"message\":\"draft task expired\",\"type\":\"new_api_error\"}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(400, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });

        NewApiVideoClient client = new NewApiVideoClient(new UpstreamBaseUrl(baseUrl));
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> client.finalize("t", "task-expired"))
                .isInstanceOf(com.bluewhale.worker.domain.error.VideoProviderError.class)
                .hasMessageContaining("HTTP 400");
    }

    @Test
    @DisplayName("水印开关开启 → submit 的 metadata 带 watermark:true")
    void submitAddsWatermarkWhenEnabled() throws Exception {
        VideoSubmitInput input = new VideoSubmitInput(
                "doubao-seedance-2-0-260128", "猫", 5, "720p", "16:9",
                null, null, List.of(), null);

        new NewApiVideoClient(
                new UpstreamBaseUrl(baseUrl),
                new GenerationWatermarkPolicy(key -> "{\"enabled\":true}"))
                .submit("t", input);

        JsonNode body = JSON.readTree(lastBody.get());
        assertThat(body.get("metadata").get("watermark").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("水印开关关闭 → submit 的 metadata 不带 watermark")
    void submitOmitsWatermarkWhenDisabled() throws Exception {
        VideoSubmitInput input = new VideoSubmitInput(
                "doubao-seedance-2-0-260128", "猫", 5, "720p", "16:9",
                null, null, List.of(), null);

        new NewApiVideoClient(
                new UpstreamBaseUrl(baseUrl),
                new GenerationWatermarkPolicy(key -> "{\"enabled\":false}"))
                .submit("t", input);

        JsonNode body = JSON.readTree(lastBody.get());
        assertThat(body.get("metadata").has("watermark")).isFalse();
    }

    @Test
    @DisplayName("水印开关开启 → finalize 顶层带 watermark（不是 metadata）")
    void finalizeAddsWatermarkWhenEnabled() throws Exception {
        new NewApiVideoClient(
                new UpstreamBaseUrl(baseUrl),
                new GenerationWatermarkPolicy(key -> "{\"enabled\":true}"))
                .finalize("t", "task-final");

        JsonNode body = JSON.readTree(lastBody.get());
        assertThat(body.get("watermark").asBoolean()).isTrue();
        assertThat(body.has("metadata")).isFalse();
    }
}
