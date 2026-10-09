package com.bluewhale.billing.adapter.inbound.mq;

import com.bluewhale.billing.application.command.SettlementCommand;
import com.bluewhale.billing.application.command.SettlementUsageLine;
import com.bluewhale.billing.domain.pricing.UsageDim;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JobEventConsumerMappingTest {

    private static final long JOB = 8801L;
    private static final long USER = 43L;
    private static final String MODEL = "seedream-4.0";
    private static final String TASK = "text2image";

    @Test
    @DisplayName("★ 逐字段搬运：事件上的每个字段都落到应用层入参上，一个不漏")
    void 逐字段搬运_一个不漏() {
        SettlementCommand command = JobEventConsumer.toCommand(new JobEventPayload.JobCompleted(
                JOB, USER, "partially_succeeded", 7, 2,
                List.of(usageLine(Map.of("usage.succeededSlots", 2L)))));

        assertThat(command.jobId()).isEqualTo(JOB);
        assertThat(command.userId()).isEqualTo(USER);
        assertThat(command.status()).isEqualTo("partially_succeeded");
        assertThat(command.catalogVersion()).isEqualTo(7);
        assertThat(command.succeededSlots()).isEqualTo(2);
        assertThat(command.usage()).hasSize(1);
    }

    @Test
    @DisplayName("用量行也逐字段搬运：模型、任务、维度量、规格")
    void 用量行逐字段搬运() {
        SettlementUsageLine line = JobEventConsumer.toCommand(new JobEventPayload.JobCompleted(
                JOB, USER, "succeeded", 1, 1,
                List.of(usageLine(Map.of("usage.succeededSlots", 3L))))).usage().getFirst();

        assertThat(line.modelId()).isEqualTo(MODEL);
        assertThat(line.taskType()).isEqualTo(TASK);
        assertThat(line.quantities()).containsExactly(Map.entry("usage.succeededSlots", 3L));
        assertThat(line.specs()).containsEntry("size", "2k");
    }

    @Test
    @DisplayName("★ 维度键按封闭枚举解释 —— worker 报的 wire 键必须落到 UsageDim 上")
    void 维度键按封闭枚举解释() {
        SettlementUsageLine line = appLine(Map.of("usage.succeededSlots", 5L));

        assertThat(line.toUsage().quantityOf(UsageDim.SUCCEEDED_SLOTS)).isEqualTo(5L);
    }

    @Test
    @DisplayName("★ 枚举之外的维度键 ⇒ 拒绝，不忽略（搬家前后同一条语义）")
    void 枚举之外的维度键_拒绝而不是忽略() {
        SettlementUsageLine line = appLine(Map.of("usage.notADimension", 1L));

        assertThatThrownBy(line::toUsage)
                .isInstanceOf(UsageDim.UnknownUsageDimException.class)
                .hasMessageContaining("usage.notADimension");
    }

    @Test
    @DisplayName("用量为空（worker 报不出用量）时是空列表而不是 null —— 降级路径的判据只认 isEmpty")
    void 用量为空_收敛成空列表() {
        SettlementCommand command = JobEventConsumer.toCommand(new JobEventPayload.JobCompleted(
                JOB, USER, "succeeded", 1, 1, null));

        assertThat(command.usage()).isNotNull().isEmpty();
    }

    private static JobEventPayload.UsageLine usageLine(Map<String, Long> quantities) {
        return new JobEventPayload.UsageLine(MODEL, TASK, quantities, Map.of("size", "2k"));
    }

    private static SettlementUsageLine appLine(Map<String, Long> quantities) {
        return JobEventConsumer.toCommand(new JobEventPayload.JobCompleted(
                        JOB, USER, "succeeded", 1, 1, List.of(usageLine(quantities))))
                .usage().getFirst();
    }
}
