package com.bluewhale.billing.infrastructure.mq;

import com.bluewhale.billing.application.SettlementCommand;
import com.bluewhale.billing.application.SettlementUsageLine;
import com.bluewhale.billing.pricing.UsageDim;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * wire → 应用层入参的映射。
 *
 * <h2>为什么这条缝值得单独钉</h2>
 *
 * {@link JobEventPayload} 与 {@link SettlementCommand} 是**两份东西**（一个绑定 JSON 的形状，
 * 一个是应用层看到的事件），所以中间那次搬运是手写的。手写的搬运每加一个字段就有一次
 * 漏搬的机会，而漏搬的表现都是**静默的**：漏了 {@code usage} 会让整单落到
 * 「按预扣额结算」的降级路径（结算按上限走），漏了 {@code status} 会让
 * 「部分成功却没报用量」那条 WARN 消失。
 *
 * <p>搬运里唯一有领域含义的一步 —— 维度键 → {@link UsageDim} —— 在
 * {@link SettlementUsageLine#toUsage()} 上（它从 wire record 搬到了应用层类型上）。
 * 下面连同搬家前后必须一致的**拒绝语义**一起钉住：出现封闭枚举之外的键要**拒绝，
 * 不忽略**，忽略一个维度就是少算一笔钱，而且没有任何信号。
 *
 * <p>纯单测：不构造消费者（它 {@code build()} 就要连 broker）。映射方法因此是包私有的
 * ——与 {@code JobEventConsumerGuardTest} 钉守卫同一个立场。
 */
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

        // 键解释错了，这个量在计价引擎眼里就是「缺维度 = 0」⇒ 落到 minCredits ⇒ 静默少收
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
        // wire 记录与应用层类型的构造器都做这一步归一，所以往下只有一处判据（isEmpty）
        SettlementCommand command = JobEventConsumer.toCommand(new JobEventPayload.JobCompleted(
                JOB, USER, "succeeded", 1, 1, null));

        assertThat(command.usage()).isNotNull().isEmpty();
    }

    /** 一条 wire 用量行；specs 固定，只有维度量由各测试给。 */
    private static JobEventPayload.UsageLine usageLine(Map<String, Long> quantities) {
        return new JobEventPayload.UsageLine(MODEL, TASK, quantities, Map.of("size", "2k"));
    }

    /**
     * 一条用量行，从 wire 载荷**一路搬到应用层类型**（走的就是 {@code onMessage} 那条路径）。
     *
     * <p>刻意不直接 new 应用层类型：上面两条语义（键怎么解释、坏键拒不拒）考的是
     * 「wire 上的 JSON 键 → 领域维度」这一整条路，绕过搬运就等于没考。
     */
    private static SettlementUsageLine appLine(Map<String, Long> quantities) {
        return JobEventConsumer.toCommand(new JobEventPayload.JobCompleted(
                        JOB, USER, "succeeded", 1, 1, List.of(usageLine(quantities))))
                .usage().getFirst();
    }
}
