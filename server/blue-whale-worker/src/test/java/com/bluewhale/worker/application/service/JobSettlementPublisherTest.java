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

    private static final String FAILED_TOPIC = "generation-job-failed";

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

    @Test
    @DisplayName("★ failed → 发返还事件，带 jobId / userId / 原因")
    void failed发返还事件() throws Exception {
        publisher.publishTerminal(
                job(101, 42, "failed"),
                Map.of("status", "failed",
                        "error", Map.of("code", "UPSTREAM_ERROR", "message", "上游超时")));

        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)[0]).isEqualTo(FAILED_TOPIC);
        JsonNode json = body(0);
        assertThat(json.get("jobId").asLong()).isEqualTo(101);
        assertThat(json.get("userId").asLong()).isEqualTo(42);
        assertThat(json.get("reason").asText()).isEqualTo("上游超时");
    }

    @Test
    @DisplayName("★ cancelled → 也发返还事件（尚未派发到上游，钱要退）")
    void cancelled发返还事件() throws Exception {
        publisher.publishTerminal(job(102, 42, "cancelled"), Map.of("status", "cancelled"));

        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)[0]).isEqualTo(FAILED_TOPIC);
    }

    @Test
    @DisplayName("★ succeeded / partially_succeeded → 不发任何事件（扣款在提交时已完成）")
    void 成功不发事件() {
        publisher.publishTerminal(job(103, 42, "succeeded"),
                Map.of("status", "succeeded", "output_asset_ids", List.of("7", "8", "9")));
        publisher.publishTerminal(job(104, 42, "partially_succeeded"),
                Map.of("status", "partially_succeeded", "output_asset_ids", List.of("7")));

        assertThat(sent).isEmpty();
    }

    @Test
    @DisplayName("★ 非终态 → 不发任何事件")
    void 非终态不发事件() {
        publisher.publishTerminal(job(105, 42, "queued"), Map.of("status", "queued"));
        publisher.publishTerminal(job(106, 42, "processing"), Map.of("status", "processing"));

        assertThat(sent).isEmpty();
    }

    @Test
    @DisplayName("status 为空 → 不发事件，也不抛")
    void status为空不发事件() {
        assertThatCode(() -> publisher.publishTerminal(job(107, 42, null), Map.of()))
                .doesNotThrowAnyException();

        assertThat(sent).isEmpty();
    }

    @Test
    @DisplayName("取不到 error.message → 原因为「未提供原因」")
    void 缺原因时兜底文案() throws Exception {
        publisher.publishTerminal(job(108, 42, "failed"), Map.of("status", "failed"));

        assertThat(body(0).get("reason").asText()).isEqualTo("未提供原因");
    }

    @Test
    @DisplayName("topic 可配：worker.billing.topic-failed")
    void topic可配() {
        MockEnvironment env = new MockEnvironment()
                .withProperty("worker.billing.topic-failed", "custom.failed");
        JobSettlementPublisher custom = new JobSettlementPublisher(producer, env);

        custom.publishTerminal(job(109, 42, "failed"), Map.of("status", "failed"));

        assertThat(sent.get(0)[0]).isEqualTo("custom.failed");
    }

    @Test
    @DisplayName("发布失败 → 吞掉异常（扣款已发生，靠运营端 refund 兜底），不外抛")
    void 发布失败不外抛() {
        BillingEventPublisher broken = (topic, body) -> {
            throw new IllegalStateException("mq down");
        };
        JobSettlementPublisher degraded = new JobSettlementPublisher(broken, new MockEnvironment());

        assertThatCode(() -> degraded.publishTerminal(
                job(110, 42, "failed"), Map.of("status", "failed")))
                .doesNotThrowAnyException();
    }
}
