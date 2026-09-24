package com.bluewhale.billing.shadow;

import com.bluewhale.billing.application.SettlementService;
import com.bluewhale.billing.infrastructure.mq.JobEventPayload;
import com.bluewhale.billing.ledger.CreditLotRepository;
import com.bluewhale.billing.ledger.LedgerRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 影子模式（《迁移与切换 runbook》§3.2）。
 *
 * <p><b>本文件的每一条断言都在回答同一个问题：影子期到底动不动钱？</b>
 * 不动，才是它能跑满一周的前提——切换前我们扣一遍、new-api 再扣一遍，
 * 用户就被扣了两遍。
 *
 * <p>刻意**不设** {@code billing.shadow-mode} 属性：这里跑的就是生产默认值
 * （默认影子）。{@code SettlementIntegrationTest} 才显式设成 false 去测权威路径。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class ShadowIntegrationTest {

    private static final long USER = 9_501L;
    private static final String MODEL = "seedance-2.5";
    private static final String TASK = "text2video";

    private static final String CATALOG = """
            {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
             "models":{"seedance-2.5":{"text2video":{
               "baseUnit":"constant:1","basePrice":{"kind":"const","value":100000},
               "unitDenominator":1,"minCredits":1}}},
             "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
            """;

    @Autowired private JdbcTemplate jdbc;
    @Autowired private SettlementService settlement;
    @Autowired private ShadowEntryRepository shadowEntries;
    @Autowired private CreditLotRepository lots;
    @Autowired private LedgerRepository ledger;

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM billing_shadow_entries");
        jdbc.update("DELETE FROM billing_ledger_entries");
        jdbc.update("DELETE FROM billing_cost_reservations");
        jdbc.update("DELETE FROM billing_credit_lots");
        jdbc.update("DELETE FROM billing_pricing_catalogs");
        jdbc.update("""
                INSERT INTO billing_pricing_catalogs
                  (catalog_version, status, document, schema_version, document_hash,
                   published_by, published_at, note)
                VALUES (1, 'active', ?, 1, SHA2('shadow-v1', 256), 'test', NOW(), '')
                """, CATALOG);
    }

    // ─────────────────────────────────────────────────────────────

    @Test
    void 默认就是影子模式() {
        // 默认值必须是「不扣」。反过来（默认就结算）在切换前部署一次，
        // 就是每个任务被扣两遍——我们一遍、new-api 一遍。
        assertThat(settlement.isShadowMode()).isTrue();
    }

    @Test
    void 影子期算价入表但一分钱都不动() {
        settlement.settle(completed(9_501L, 1L));

        Map<String, Object> row = shadowRow(9_501L);
        assertThat(row).containsEntry("status", "priced");
        assertThat(((Number) row.get("computed_credits")).longValue()).isEqualTo(100);
        assertThat(((Number) row.get("catalog_version")).intValue()).isEqualTo(1);

        // ★ 核心：没有批次、没有账本、没有预留 —— 影子期碰不到钱
        assertThat(countLots()).isZero();
        assertThat(countLedgerEntries()).isZero();
        assertThat(ledger.balanceOf(USER, com.bluewhale.billing.ledger.Account.WALLET)).isZero();
        assertThat(lots.availableCredits(USER)).isZero();
    }

    @Test
    void 影子期不需要预扣就能记() {
        // 影子期 worker 直接用统一 key 调上游，根本没走 Hold——
        // 若影子路径也要求有预留，那每一行都会因为「找不到预留」而被跳过，
        // 影子期会安静地产出零条数据，而所有人都以为它在工作。
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_cost_reservations", Integer.class)).isZero();

        settlement.settle(completed(9_502L, 1L));

        assertThat(shadowRow(9_502L)).containsEntry("status", "priced");
    }

    @Test
    void 算不出价记成unpriceable而不是抛异常() {
        // 抛出去重投只会让同一批漏配反复进 DLQ；影子期要的是**完整记下来**，
        // 这份 unpriceable 清单就是切换前要修掉的漏配。
        settlement.settle(new JobEventPayload.JobCompleted(
                9_503L, USER, "succeeded", 1, 1,
                List.of(new JobEventPayload.UsageLine("从未配置过的模型", TASK,
                        Map.of(), Map.of(), null))));

        Map<String, Object> row = shadowRow(9_503L);
        assertThat(row).containsEntry("status", "unpriceable");
        assertThat(row.get("computed_credits")).isNull();
        assertThat((String) row.get("error_message")).contains("未配置计价规则");
    }

    @Test
    void 未带用量也记一行_不静默跳过() {
        settlement.settle(new JobEventPayload.JobCompleted(9_504L, USER, "succeeded", 1, 1, List.of()));

        assertThat(shadowRow(9_504L)).containsEntry("status", "unpriceable");
        assertThat((String) shadowRow(9_504L).get("error_message")).contains("未带用量");
    }

    @Test
    void 重复投递不重复记账() {
        settlement.settle(completed(9_505L, 1L));
        settlement.settle(completed(9_505L, 1L));

        // 唯一索引 uk_billing_shadow_entries__job 拦下
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_shadow_entries WHERE generation_job_id = 9505",
                Integer.class)).isEqualTo(1);
    }

    @Test
    void 上游成本被记下来_供毛利分析() {
        settlement.settle(completed(9_506L, 12_345L));

        assertThat(((Number) shadowRow(9_506L).get("upstream_cost_credits")).longValue())
                .isEqualTo(12_345L);
    }

    @Test
    void 汇总与漏配清单可查() {
        settlement.settle(completed(9_507L, 1L));
        settlement.settle(new JobEventPayload.JobCompleted(9_508L, USER, "succeeded", 1, 1,
                List.of(new JobEventPayload.UsageLine("从未配置过的模型", TASK,
                        Map.of(), Map.of(), null))));

        Map<String, Object> stats = shadowEntries.summarize(
                Instant.now().minusSeconds(600), Instant.now().plusSeconds(60));

        assertThat(((Number) stats.get("priced")).intValue()).isEqualTo(1);
        assertThat(((Number) stats.get("unpriceable")).intValue()).isEqualTo(1);
        assertThat(((Number) stats.get("computed_credits")).longValue()).isEqualTo(100);

        var breakdown = shadowEntries.unpriceableBreakdown(
                Instant.now().minusSeconds(600), Instant.now().plusSeconds(60));
        assertThat(breakdown).hasSize(1);
        assertThat(breakdown.get(0)).containsEntry("model_id", "从未配置过的模型");
    }

    @Test
    void 回填上游扣用户的数() {
        settlement.settle(completed(9_509L, 1L));

        assertThat(shadowEntries.fillUpstreamUserCredits(9_509L, 95)).isEqualTo(1);

        Map<String, Object> stats = shadowEntries.summarize(
                Instant.now().minusSeconds(600), Instant.now().plusSeconds(60));
        assertThat(((Number) stats.get("upstream_user_credits")).longValue()).isEqualTo(95);
        // 「比了几条」也要能看出来：回填任务停了的话，这个数会掉回 0 而合计仍在
        assertThat(((Number) stats.get("compared")).intValue()).isEqualTo(1);
    }

    // ─────────────────────────────────────────────────────────────

    private JobEventPayload.JobCompleted completed(long jobId, Long upstreamCost) {
        return new JobEventPayload.JobCompleted(jobId, USER, "succeeded", 1, 1,
                List.of(new JobEventPayload.UsageLine(MODEL, TASK,
                        Map.of(), Map.of("resolution", "1080p"), upstreamCost)));
    }

    private Map<String, Object> shadowRow(long jobId) {
        return jdbc.queryForMap(
                "SELECT status, computed_credits, catalog_version, upstream_cost_credits, error_message "
                        + "FROM billing_shadow_entries WHERE generation_job_id = ?", jobId);
    }

    private int countLots() {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM billing_credit_lots", Integer.class);
        return n == null ? 0 : n;
    }

    private int countLedgerEntries() {
        Integer n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries", Integer.class);
        return n == null ? 0 : n;
    }
}
