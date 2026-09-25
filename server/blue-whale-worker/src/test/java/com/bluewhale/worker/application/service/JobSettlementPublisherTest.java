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

/**
 * 终态结算事件测试。
 *
 * <p>钉的是**钱路径上的一次性动作**：job 到终态时那条事件发不发得出去、发到哪个
 * topic、带什么字段。发错或漏发都不会有任何自动补偿——用户的钱一直冻着。
 * 所以这里的断言比一般单测细（连 topic 名都钉）。
 */
class JobSettlementPublisherTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    /** 记录每次发布的 (topic, body)。 */
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

    /** 建任务时冻结了 input 的 job —— 用量行要靠 job.input 里的 model_id 与规格。 */
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

    // ========== 成功 → 结算 ==========

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

        // ★ 用量行：billing 拿它去**冻结目录**里计价（worker 只报原始量，不报积分）
        assertThat(json.get("usage")).hasSize(1);
        JsonNode line = json.get("usage").get(0);
        assertThat(line.get("modelId").asText()).isEqualTo("doubao-seedance-2-5-260628");
        assertThat(line.get("taskType").asText()).isEqualTo("video");
        assertThat(line.get("quantities").get("usage.succeededSlots").asLong()).isEqualTo(3);
        // 规格与 Hold 侧同源：prompt 是内容字段不进规格，model_id / duration 进
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
        // ★ 报的是**实际成功的槽数**（1），不是这张单本来要出几张 ——
        //   这个数就是 billing 算 actualCredits 的基数，报错了就是收错钱
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
        // 5.0 经 MySQL JSON 列往返回来仍是 5.0，而 TS 侧 String(5.0) === "5" —— 必须对齐
        assertThat(specs.get("duration").asText()).isEqualTo("5");
        assertThat(specs.get("generate_audio").asText()).isEqualTo("true");
        // 数组不是标量、null 不是标量、title 是内容字段 —— 三者都不进规格
        assertThat(specs.has("references")).isFalse();
        assertThat(specs.has("target_node_id")).isFalse();
        assertThat(specs.has("title")).isFalse();
    }

    @Test
    @DisplayName("★ 参考素材数按 references 数组长度上报 —— 与预扣侧的 reference_count 同一口径")
    void 参考素材数按references长度上报() throws Exception {
        // 这个 job 的 input 里**同时**有单数组 references（2 项）和旧分字段路径的参考
        // （input_asset_ids 5 项 + reference_asset_ids 2 项 + 首尾帧 1 项）。
        // 预扣侧 billing-specs.ts 的 extractSpecs 只把 `references` 的长度折算成
        // reference_count（旧字段不进那个数），结算侧必须**只有同一个数**——
        // 统计得更宽就会出现「预扣按 2 个参考加价、结算按 10 个收回」，比不加价更糟。
        publisher.publishTerminal(
                job(106, 42, "succeeded", "video",
                        "{\"model_id\":\"m\",\"references\":["
                                + "{\"role\":\"first_frame\",\"asset_id\":\"11\",\"type\":\"image\"},"
                                + "{\"role\":\"reference\",\"asset_id\":\"12\",\"type\":\"image\"}],"
                                + "\"input_asset_ids\":[1,2,3,4,5],"
                                + "\"reference_asset_ids\":[\"21\",\"22\"],"
                                + "\"first_frame_asset_id\":\"31\"}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));

        JsonNode quantities = body(0).get("usage").get(0).get("quantities");
        // ⚠️ 键名是字面量，必须是 UsageDim.REFERENCE_COUNT 的 key（billing 侧
        // ReferenceCountSurchargeTest 钉住了那个枚举值与 "usage.referenceCount" 相等）：
        // 写错一个字母 billing 会以 UnknownUsageDimException 拒绝计价，整单结算不出去
        assertThat(quantities.get("usage.referenceCount").asLong()).isEqualTo(2);
        // 只是长度，不是别的数组的长度
        assertThat(quantities).hasSize(2);
        // 数组不进规格（与 extractSpecs 一致），所以规格里也不该冒出这个键
        assertThat(body(0).get("usage").get(0).get("specs").has("references")).isFalse();
    }

    @Test
    @DisplayName("没有 references 时参考素材数报 0 —— 与预扣侧折算出的 reference_count=0 同口径")
    void 无参考素材时报零() throws Exception {
        // 旧分字段路径建出来的 job：input 里没有 references 键。
        // 预扣侧同样只认这一个数组 ⇒ reference_count = "0" ⇒ 倍率 ×1.0；
        // 结算侧报 0（而不是**不报**）让账面上看得出「这个量我们算过，就是 0」，
        // 与 UsageDim.quantityOf「取不到也是 0」两不冲突。
        publisher.publishTerminal(
                job(107, 42, "succeeded", "image",
                        "{\"model_id\":\"m\",\"input_asset_ids\":[1,2,3]}"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));

        assertThat(body(0).get("usage").get(0).get("quantities")
                .get("usage.referenceCount").asLong()).isZero();
    }

    @Test
    @DisplayName("references 为空数组时也报 0 —— 与 extractSpecs 的 Array.isArray 分支一致")
    void 空references报零() throws Exception {
        // { references: [] } 在 TS 侧折算出的 reference_count 是 "0"（长度 0），
        // 不是「没这个键」——两侧都取 0，倍率都 ×1.0
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
        // 没有 input（历史 job / input 损坏）→ 不敢猜一个模型去计价
        publisher.publishTerminal(job(105, 42, "succeeded", "video", null),
                Map.of("status", "succeeded", "output_asset_ids", List.of("1")));

        assertThat(body(0).get("usage")).isEmpty();
        // 槽数照发：标量本身不依赖模型
        assertThat(body(0).get("succeededSlots").asInt()).isEqualTo(1);
    }

    @Test
    @DisplayName("payload 没有 output_asset_ids 时成功槽数为 0，不抛异常")
    void 缺产物键不炸() throws Exception {
        publisher.publishTerminal(job(103, 42, "succeeded"), Map.of("status", "succeeded"));

        assertThat(body(0).get("succeededSlots").asInt()).isZero();
    }

    // ========== 失败 → 全额返还 ==========

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

    // ========== 守卫 ==========

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
        // 契约里原本叫 generation.job.completed / .failed（点号分隔，读起来很自然），
        // 2026-09-25 本地起服务时以 BadRequestException 当场炸出来 ——
        // 编译器不会说、单测不会红，只有进程真去连 broker 才知道。
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
        // 默认值（上面那些测试用的）与 billing 的 billing.mq.topic-* 默认值成对
        assertThat(sent).isEmpty();
    }
}
