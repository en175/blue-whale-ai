package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.mq.BillingEventPublisher;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

class JobSettlementPublisherTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final List<String[]> sent = new ArrayList<>();

    private final BillingEventPublisher producer =
            (topic, body) -> sent.add(new String[]{topic, body});

    private final JobSettlementPublisher publisher =
            new JobSettlementPublisher(producer, new MockEnvironment());

    private static GenerationJobEntity job(long id, long userId, String status) {
        GenerationJobEntity job = new GenerationJobEntity();
        job.setId(id);
        job.setUserId(userId);
        job.setStatus(status);
        return job;
    }

    private static GenerationJobEntity job(long id, long userId, String status,
                                           String type, String inputJson) {
        GenerationJobEntity job = job(id, userId, status);
        job.setType(type);
        job.setInput(inputJson);
        return job;
    }

    private JsonNode body(int index) throws Exception {
        return JSON.readTree(sent.get(index)[1]);
    }


    @Test
    @DisplayName("★ succeeded 发到 completed topic，成功槽数 = 产物数，并带上按槽用量")
    void succeeded发结算事件() throws Exception {
        publisher.publishTerminal(
                job(101, 42, "succeeded", "video",
                        "{\"prompt\":\"一只猫\",\"model_id\":\"doubao-seedance-2-5-260628\",\"duration\":5}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("7", "8", "9")));

        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)[0]).isEqualTo("generation-job-completed");
        JsonNode json = body(0);
        assertThat(json.get("jobId").asLong()).isEqualTo(101);
        assertThat(json.get("userId").asLong()).isEqualTo(42);
        assertThat(json.get("status").asText()).isEqualTo("succeeded");
        assertThat(json.get("succeededSlots").asInt()).isEqualTo(3);

        assertThat(json.get("usage")).hasSize(1);
        JsonNode line = json.get("usage").get(0);
        assertThat(line.get("modelId").asText()).isEqualTo("doubao-seedance-2-5-260628");
        assertThat(line.get("taskType").asText()).isEqualTo("video");
        assertThat(line.get("quantities").get("usage.succeededSlots").asLong()).isEqualTo(3);
        assertThat(line.get("specs").get("prompt")).isNull();
        assertThat(line.get("specs").get("model_id").asText())
                .isEqualTo("doubao-seedance-2-5-260628");
        assertThat(line.get("specs").get("duration").asText()).isEqualTo("5");
    }

    @Test
    @DisplayName("★ partially_succeeded 走结算而不是返还 —— 部分成功按实际成功槽收费")
    void 部分成功走结算() throws Exception {
        publisher.publishTerminal(
                job(102, 42, "partially_succeeded", "image",
                        "{\"model_id\":\"seedream-4.0\",\"size\":\"2K\"}"),
                Map.of("status", "partially_succeeded", "output_asset_ids", List.of("7")));

        assertThat(sent.get(0)[0]).isEqualTo("generation-job-completed");
        JsonNode json = body(0);
        assertThat(json.get("status").asText()).isEqualTo("partially_succeeded");
        assertThat(json.get("succeededSlots").asInt()).isEqualTo(1);
        assertThat(json.get("usage").get(0).get("quantities").get("usage.succeededSlots").asLong())
                .isEqualTo(1);
    }

    @Test
    @DisplayName("★ 规格键值统一小写、只取标量 —— 与 billing-specs.ts 的 extractSpecs 逐条一致")
    void 规格归一与Hold侧同源() throws Exception {
        publisher.publishTerminal(
                job(104, 42, "succeeded", "video",
                        "{\"model_id\":\"m\",\"RESOLUTION\":\"1080P\",\"duration\":5.0,"
                                + "\"generate_audio\":true,\"references\":[{\"a\":1}],"
                                + "\"target_node_id\":null,\"title\":\"标题\"}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));

        JsonNode specs = body(0).get("usage").get(0).get("specs");
        assertThat(specs.get("resolution").asText()).isEqualTo("1080p");
        assertThat(specs.get("duration").asText()).isEqualTo("5");
        assertThat(specs.get("generate_audio").asText()).isEqualTo("true");
        assertThat(specs.has("references")).isFalse();
        assertThat(specs.has("target_node_id")).isFalse();
        assertThat(specs.has("title")).isFalse();
    }

    @Test
    @DisplayName("★ 视频：参考素材数只认 references —— 旧分字段路径一律不计入")
    void 视频参考素材数只认references() throws Exception {
        publisher.publishTerminal(
                job(106, 42, "succeeded", "video",
                        "{\"model_id\":\"m\",\"references\":["
                                + "{\"role\":\"first_frame\",\"asset_id\":\"11\",\"type\":\"image\"},"
                                + "{\"role\":\"reference\",\"asset_id\":\"12\",\"type\":\"image\"}],"
                                + "\"reference_asset_ids\":[\"21\",\"22\"],"
                                + "\"first_frame_asset_id\":\"31\"}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));

        JsonNode quantities = body(0).get("usage").get(0).get("quantities");
        assertThat(quantities.get("usage.referenceCount").asLong()).isEqualTo(2);
        assertThat(quantities).hasSize(2);
        assertThat(body(0).get("usage").get(0).get("specs").has("references")).isFalse();
    }

    @Test
    @DisplayName("★ 图片：参考素材数认 input_asset_ids（图片的参考落这个键，不是 references）")
    void 图片参考素材数认inputAssetIds() throws Exception {
        publisher.publishTerminal(
                job(107, 42, "succeeded", "image",
                        "{\"model_id\":\"doubao-seedream-5-0-pro-260628\","
                                + "\"input_asset_ids\":[\"996217\",\"996218\",\"996219\"]}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));

        assertThat(body(0).get("usage").get(0).get("quantities")
                .get("usage.referenceCount").asLong()).isEqualTo(3);
    }

    @Test
    @DisplayName("★ 视频不认 input_asset_ids —— 那个键对视频不是参考列表")
    void 视频不认inputAssetIds() throws Exception {
        publisher.publishTerminal(
                job(109, 42, "succeeded", "video",
                        "{\"model_id\":\"m\",\"input_asset_ids\":[\"1\",\"2\",\"3\"]}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));

        assertThat(body(0).get("usage").get(0).get("quantities")
                .get("usage.referenceCount").asLong()).isZero();
    }

    @Test
    @DisplayName("参考素材数恒上报（含 0）—— 账面上看得出「这个量我们算过，就是 0」")
    void 无参考素材时报零() throws Exception {
        publisher.publishTerminal(
                job(110, 42, "succeeded", "image", "{\"model_id\":\"m\",\"size\":\"2k\"}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));

        assertThat(body(0).get("usage").get(0).get("quantities")
                .get("usage.referenceCount").asLong()).isZero();
    }

    @Test
    @DisplayName("references 为空数组时也报 0 —— 与 extractSpecs 的 Array.isArray 分支一致")
    void 空references报零() throws Exception {
        publisher.publishTerminal(
                job(108, 42, "succeeded", "image",
                        "{\"model_id\":\"m\",\"references\":[]}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));

        assertThat(body(0).get("usage").get(0).get("quantities")
                .get("usage.referenceCount").asLong()).isZero();
    }

    @Test
    @DisplayName("报不出 model_id 时 usage 发空数组，billing 退回按预扣额结算")
    void 报不出用量时发空数组() throws Exception {
        publisher.publishTerminal(job(105, 42, "succeeded", "video", null),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));

        assertThat(body(0).get("usage")).isEmpty();
        assertThat(body(0).get("succeededSlots").asInt()).isEqualTo(1);
    }


    @Test
    @DisplayName("★ 音频上报产出秒数（usage.seconds）—— 官方「0.3 元/分钟、精确至秒」的权威用量")
    void 上报音频秒数() throws Exception {
        publisher.publishTerminal(
                job(121, 42, "succeeded", "audio", "{\"model_id\":\"seed-audio-1.0\"}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")),
                null, 42L);

        JsonNode quantities = body(0).get("usage").get(0).get("quantities");
        assertThat(quantities.get("usage.seconds").asLong()).isEqualTo(42L);
        assertThat(quantities.get("usage.succeededSlots").asLong()).isEqualTo(1);
        assertThat(quantities.has("usage.c")).isFalse();
    }

    @Test
    @DisplayName("★ 音频取不到时长时**整个维度不出现** —— billing 会因此拒绝计价（吵，不是白送）")
    void 音频无时长不报该维度() throws Exception {
        publisher.publishTerminal(
                job(122, 42, "succeeded", "audio", "{\"model_id\":\"seed-audio-1.0\"}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")),
                null, null);

        JsonNode quantities = body(0).get("usage").get(0).get("quantities");
        assertThat(quantities.has("usage.seconds")).isFalse();
    }


    @Test
    @DisplayName("★ 上报**上游返回**的真实 token（usage.c）—— 结算的权威用量，不是我们估的")
    void 上报上游真实token() throws Exception {
        publisher.publishTerminal(
                job(111, 42, "succeeded", "video",
                        "{\"model_id\":\"doubao-seedance-2-0-fast-260128\",\"resolution\":\"480p\","
                                + "\"aspect_ratio\":\"16:9\",\"duration\":4}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")),
                40_594L);

        JsonNode quantities = body(0).get("usage").get(0).get("quantities");
        assertThat(quantities.get("usage.c").asLong()).isEqualTo(40_594L);
        assertThat(quantities.get("usage.succeededSlots").asLong()).isEqualTo(1);
    }

    @Test
    @DisplayName("★ 上游没报 token 时**整个维度不出现**，不填 0 —— 填 0 是一笔免费生成")
    void 没有上游token时不报该维度() throws Exception {
        publisher.publishTerminal(
                job(112, 42, "succeeded", "video",
                        "{\"model_id\":\"m\",\"resolution\":\"480p\"}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")),
                null);

        JsonNode quantities = body(0).get("usage").get(0).get("quantities");
        assertThat(quantities.has("usage.c")).isFalse();
        assertThat(quantities.get("usage.succeededSlots").asLong()).isEqualTo(1);
    }

    @Test
    @DisplayName("★ 视频输入档（video=0 / video=1）按 references 里的 video 条目折算 —— 决定视频 token 的单价档")
    void 含视频输入折算() throws Exception {
        publisher.publishTerminal(
                job(113, 42, "succeeded", "video",
                        "{\"model_id\":\"m\",\"references\":["
                                + "{\"role\":\"reference\",\"type\":\"image\",\"asset_id\":\"1\"},"
                                + "{\"role\":\"reference\",\"type\":\"video\",\"asset_id\":\"2\"}]}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));
        assertThat(body(0).get("usage").get(0).get("specs").get("video").asText())
                .isEqualTo("1");

        publisher.publishTerminal(
                job(114, 42, "succeeded", "video",
                        "{\"model_id\":\"m\",\"references\":["
                                + "{\"role\":\"reference\",\"type\":\"image\",\"asset_id\":\"1\"}]}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));
        assertThat(body(1).get("usage").get(0).get("specs").get("video").asText())
                .isEqualTo("0");

        publisher.publishTerminal(
                job(115, 42, "succeeded", "video",
                        "{\"model_id\":\"m\",\"reference_asset_ids\":[\"21\"]}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));
        assertThat(body(2).get("usage").get(0).get("specs").get("video").asText())
                .isEqualTo("0");
    }

    @Test
    @DisplayName("payload 没有 output_asset_ids 时成功槽数为 0，不抛异常")
    void 缺产物键不炸() throws Exception {
        publisher.publishTerminal(job(103, 42, "succeeded"), Map.of("status", "succeeded"));

        assertThat(body(0).get("succeededSlots").asInt()).isZero();
    }


    @Test
    @DisplayName("★ failed 发到 failed topic，reason 取自 status_changed 的 error.message")
    void failed发返还事件() throws Exception {
        publisher.publishTerminal(job(201, 7, "failed"),
                Map.of("status", "failed",
                        "error", Map.of("code", "1102", "message", "上游返回超时")));

        assertThat(sent.get(0)[0]).isEqualTo("generation-job-failed");
        JsonNode json = body(0);
        assertThat(json.get("jobId").asLong()).isEqualTo(201);
        assertThat(json.get("userId").asLong()).isEqualTo(7);
        assertThat(json.get("reason").asText()).isEqualTo("上游返回超时");
    }

    @Test
    @DisplayName("★ cancelled 也走返还 —— 取消的 job 预扣同样要解冻")
    void cancelled走返还() {
        publisher.publishTerminal(job(202, 7, "cancelled"), Map.of("status", "cancelled"));

        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)[0]).isEqualTo("generation-job-failed");
    }

    @Test
    @DisplayName("error 缺失或 message 为空时给兜底文案，不发空 reason")
    void 失败原因兜底() throws Exception {
        publisher.publishTerminal(job(203, 7, "failed"), Map.of("status", "failed"));
        publisher.publishTerminal(job(204, 7, "failed"),
                Map.of("status", "failed", "error", Map.of("code", "1102", "message", "  ")));

        assertThat(body(0).get("reason").asText()).isEqualTo("未提供原因");
        assertThat(body(1).get("reason").asText()).isEqualTo("未提供原因");
    }


    @Test
    @DisplayName("★ 非终态一条都不发 —— 发早了等于在任务还没干完时就解冻了钱")
    void 非终态不发() {
        publisher.publishTerminal(job(301, 1, "processing"), Map.of("status", "processing"));
        publisher.publishTerminal(job(302, 1, "queued"), Map.of("status", "queued"));

        assertThat(sent).isEmpty();
    }

    @Test
    @DisplayName("★ 发布失败不外抛 —— 否则终态事务回滚，job 重跑会再花一次上游的钱")
    void 发布失败不滚终态() {
        JobSettlementPublisher failing = new JobSettlementPublisher(
                (topic, b) -> {
                    throw new IllegalStateException("broker 不可达");
                },
                new MockEnvironment());

        assertThatCode(() -> failing.publishTerminal(job(401, 1, "succeeded"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1"))))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("★ 默认 topic 名不含点号 —— RocketMQ 只收 [%|a-zA-Z0-9_-]，含点会让消费者起不来")
    void 默认topic名合法() {
        String allowed = "^[%|a-zA-Z0-9_-]+$";
        assertThat(sent).isEmpty();
        publisher.publishTerminal(job(1, 1, "succeeded"), Map.of("status", "succeeded"));
        publisher.publishTerminal(job(2, 1, "failed"), Map.of("status", "failed"));
        assertThat(sent.get(0)[0]).matches(allowed);
        assertThat(sent.get(1)[0]).matches(allowed);
        assertThat(sent.get(0)[0]).isNotEqualTo(sent.get(1)[0]);
    }

    @Test
    @DisplayName("topic 名可配置，且默认值与 billing consumer 的默认值一致")
    void topic可配置() throws Exception {
        MockEnvironment env = new MockEnvironment()
                .withProperty("worker.billing.topic-completed", "custom.completed")
                .withProperty("worker.billing.topic-failed", "custom.failed");
        List<String[]> captured = new ArrayList<>();
        JobSettlementPublisher custom =
                new JobSettlementPublisher((t, b) -> captured.add(new String[]{t, b}), env);

        custom.publishTerminal(job(1, 1, "succeeded"), Map.of("status", "succeeded"));
        custom.publishTerminal(job(2, 1, "failed"), Map.of("status", "failed"));

        assertThat(captured.get(0)[0]).isEqualTo("custom.completed");
        assertThat(captured.get(1)[0]).isEqualTo("custom.failed");
        assertThat(sent).isEmpty();
    }
}
