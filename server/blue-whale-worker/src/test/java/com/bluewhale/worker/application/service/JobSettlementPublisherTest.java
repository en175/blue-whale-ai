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

    private JsonNode body(int index) throws Exception {
        return JSON.readTree(sent.get(index)[1]);
    }

    // ========== 成功 → 结算 ==========

    @Test
    @DisplayName("★ succeeded 发到 completed topic，成功槽数 = 产物数，usage 为空数组")
    void succeeded发结算事件() throws Exception {
        publisher.publishTerminal(job(101, 42, "succeeded"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("7", "8", "9")));

        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)[0]).isEqualTo("generation-job-completed");
        JsonNode json = body(0);
        assertThat(json.get("jobId").asLong()).isEqualTo(101);
        assertThat(json.get("userId").asLong()).isEqualTo(42);
        assertThat(json.get("status").asText()).isEqualTo("succeeded");
        assertThat(json.get("succeededSlots").asInt()).isEqualTo(3);
        // ★ 空用量不是漏报：billing 按预扣额结算，这正是媒介类任务的正确取值
        assertThat(json.get("usage")).isEmpty();
    }

    @Test
    @DisplayName("★ partially_succeeded 走结算而不是返还 —— 部分成功也要收钱")
    void 部分成功走结算() throws Exception {
        publisher.publishTerminal(job(102, 42, "partially_succeeded"),
                Map.of("status", "partially_succeeded", "output_asset_ids", List.of("7")));

        assertThat(sent.get(0)[0]).isEqualTo("generation-job-completed");
        assertThat(body(0).get("status").asText()).isEqualTo("partially_succeeded");
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
