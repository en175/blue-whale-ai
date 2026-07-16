package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.model.entity.GenerationJob;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.cost-control.project-daily-limit-fen=200"
})
@ActiveProfiles("test")
class CostReservationServiceIT {

    @Autowired
    private CostReservationService reservationService;
    @Autowired
    private AuditRecordReader auditRecordReader;
    @Autowired
    private CostControlProperties properties;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private GenerationJobMapper generationJobMapper;

    @BeforeEach
    void cleanFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM audit_records",
                "DELETE FROM cost_reservations",
                "DELETE FROM cost_budget_locks",
                "DELETE FROM generation_jobs");
    }

    @Test
    void reservationBeforeProviderCallIsVersionedAndAudited() {
        PriceQuote quote = new PriceQuote(
                125L,
                "image-provider",
                "price-2026-07",
                "cny-2026-07",
                "model-policy-v1");

        CostReservationSnapshot reservation = reservationService.reserve(new CostReservationCommand(
                11L,
                22L,
                33L,
                "action-33",
                "generate_image",
                quote));

        assertThat(reservation.status()).isEqualTo(CostReservationStatus.ACTIVE);
        assertThat(reservation.budgetEffect()).isEqualTo(BudgetEffect.RESERVED);
        assertThat(reservation.reservedAmountFen()).isEqualTo(125L);
        assertThat(reservation.priceCatalogVersion()).isEqualTo("price-2026-07");
        assertThat(reservation.exchangeRateVersion()).isEqualTo("cny-2026-07");
        assertThat(reservation.modelPolicyVersion()).isEqualTo("model-policy-v1");
        assertThat(reservation.costRuleVersion()).isEqualTo("cost-rules-v1");

        assertThat(auditRecordReader.findByCorrelationId("generation-job:33"))
                .singleElement()
                .satisfies(record -> {
                    assertThat(record.action()).isEqualTo("cost_reservation.create");
                    assertThat(record.decision()).isEqualTo("allowed");
                    assertThat(record.reasonCode()).isEqualTo("WITHIN_HARD_BUDGET");
                    assertThat(record.priceCatalogVersion()).isEqualTo("price-2026-07");
                    assertThat(record.exchangeRateVersion()).isEqualTo("cny-2026-07");
                    assertThat(record.modelPolicyVersion()).isEqualTo("model-policy-v1");
                    assertThat(record.costRuleVersion()).isEqualTo("cost-rules-v1");
                });
        assertThat(properties.getAuditRetentionDays()).isEqualTo(365);
    }

    @Test
    void unknownProviderResultKeepsBudgetForReconciliation() {
        reservationService.reserve(new CostReservationCommand(
                11L,
                22L,
                44L,
                "action-44",
                "generate_image",
                new PriceQuote(125L, "image-provider", "price-2026-07",
                        "cny-2026-07", "model-policy-v1")));

        CostReservationSnapshot pending = reservationService.markPendingReconciliation(
                44L, "PROVIDER_RESULT_UNKNOWN");

        assertThat(pending.status()).isEqualTo(CostReservationStatus.PENDING_RECONCILIATION);
        assertThat(pending.budgetEffect()).isEqualTo(BudgetEffect.PENDING_RECONCILIATION);
        assertThat(pending.actualAmountFen()).isNull();
        assertThat(reservationService.findByJob(44L)).contains(pending);
        assertThat(auditRecordReader.findByCorrelationId("generation-job:44"))
                .extracting(AuditRecordSnapshot::action)
                .containsExactly("cost_reservation.create", "cost_reservation.pending_reconciliation");
    }

    @Test
    void hardProjectBudgetCannotBeBypassedAndDenialIsAudited() {
        reservationService.reserve(new CostReservationCommand(
                11L, 22L, 55L, "action-55", "generate_image",
                new PriceQuote(125L, "image-provider", "price-2026-07",
                        "cny-2026-07", "model-policy-v1")));

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> reservationService.reserve(
                        new CostReservationCommand(
                                11L, 22L, 56L, "action-56", "generate_image",
                                new PriceQuote(100L, "image-provider", "price-2026-07",
                                        "cny-2026-07", "model-policy-v1"))))
                .isInstanceOf(GovernanceException.class)
                .satisfies(error -> {
                    GovernanceException governance = (GovernanceException) error;
                    assertThat(governance.publicCode()).isEqualTo("QUOTA_EXCEEDED");
                    assertThat(governance.budgetEffect()).isEqualTo(BudgetEffect.NONE);
                });

        assertThat(reservationService.findByJob(56L)).isEmpty();
        assertThat(auditRecordReader.findByCorrelationId("generation-job:56"))
                .singleElement()
                .satisfies(record -> {
                    assertThat(record.decision()).isEqualTo("denied");
                    assertThat(record.reasonCode()).isEqualTo("PROJECT_DAILY_LIMIT");
                });
    }

    @Test
    void sameJobCannotReuseReservationWithDifferentActionFacts() {
        reservationService.reserve(new CostReservationCommand(
                11L, 22L, 66L, "action-66", "generate_image",
                new PriceQuote(100L, "image-provider", "price-2026-07",
                        "cny-2026-07", "model-policy-v1")));

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> reservationService.reserve(
                        new CostReservationCommand(
                                11L, 22L, 66L, "tampered-action", "generate_image",
                                new PriceQuote(100L, "image-provider", "price-2026-07",
                                        "cny-2026-07", "model-policy-v1"))))
                .isInstanceOf(GovernanceException.class)
                .satisfies(error -> assertThat(((GovernanceException) error).publicCode())
                        .isEqualTo("ACTION_NOT_ALLOWED"));
        assertThat(auditRecordReader.findByCorrelationId("generation-job:66"))
                .extracting(AuditRecordSnapshot::reasonCode)
                .containsExactly("WITHIN_HARD_BUDGET", "RESERVATION_FACT_MISMATCH");
    }

    @Test
    void providerAdmissionWithoutActiveReservationIsGovernanceDeniedAndAudited() {
        reservationService.reserve(new CostReservationCommand(
                11L, 22L, 67L, "action-67", "generate_image",
                new PriceQuote(100L, "image-provider", "price-2026-07",
                        "cny-2026-07", "model-policy-v1")));
        reservationService.release(67L, "CANCELLED_BEFORE_PROVIDER");

        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> reservationService.requireActiveBeforeProvider(67L))
                .isInstanceOf(GovernanceException.class)
                .satisfies(error -> assertThat(((GovernanceException) error).publicCode())
                        .isEqualTo("ACTION_NOT_ALLOWED"));
        assertThat(auditRecordReader.findByCorrelationId("generation-job:67"))
                .extracting(AuditRecordSnapshot::reasonCode)
                .containsExactly(
                        "WITHIN_HARD_BUDGET",
                        "CANCELLED_BEFORE_PROVIDER",
                        "ACTIVE_RESERVATION_REQUIRED");
    }

    @Test
    void missingReservationBeforeProviderIsGovernanceDeniedAndAudited() {
        GenerationJob job = new GenerationJob()
                .setProjectId(22L)
                .setUserId(11L)
                .setType(GenerationJob.TYPE_IMAGE)
                .setSource(GenerationJob.SOURCE_BOTTOM_DOCK)
                .setActionIdentity("action-missing-reservation")
                .setInput(java.util.Map.of("prompt", "blue whale"))
                .setStatus(GenerationJob.STATUS_PROCESSING)
                .setProgress(0);
        generationJobMapper.insert(job);

        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> reservationService.requireActiveBeforeProvider(job.getId()))
                .isInstanceOf(GovernanceException.class)
                .satisfies(error -> assertThat(((GovernanceException) error).publicCode())
                        .isEqualTo("ACTION_NOT_ALLOWED"));
        assertThat(auditRecordReader.findByCorrelationId("generation-job:" + job.getId()))
                .singleElement()
                .satisfies(record -> {
                    assertThat(record.action()).isEqualTo("cost_reservation.provider_admission");
                    assertThat(record.decision()).isEqualTo("denied");
                    assertThat(record.reasonCode()).isEqualTo("ACTIVE_RESERVATION_REQUIRED");
                });
    }

    @Test
    void settledAndReleasedReservationsExposeStableBudgetEffects() {
        reservationService.reserve(new CostReservationCommand(
                11L, 22L, 77L, "action-77", "generate_image",
                new PriceQuote(75L, "image-provider", "price-2026-07",
                        "cny-2026-07", "model-policy-v1")));
        reservationService.reserve(new CostReservationCommand(
                11L, 23L, 78L, "action-78", "generate_image",
                new PriceQuote(75L, "image-provider", "price-2026-07",
                        "cny-2026-07", "model-policy-v1")));

        assertThat(reservationService.settle(77L, 50L, "PROVIDER_COST_PROVEN").budgetEffect())
                .isEqualTo(BudgetEffect.ACTUAL_SETTLED);
        assertThat(reservationService.release(78L, "CANCELLED_BEFORE_PROVIDER").budgetEffect())
                .isEqualTo(BudgetEffect.RESERVATION_RELEASED);
    }

    @Test
    void pendingReconciliationCanCloseAsSettledOrReleased() {
        reservationService.reserve(new CostReservationCommand(
                11L, 22L, 79L, "action-79", "generate_image",
                new PriceQuote(75L, "image-provider", "price-2026-07",
                        "cny-2026-07", "model-policy-v1")));
        reservationService.reserve(new CostReservationCommand(
                11L, 23L, 80L, "action-80", "generate_image",
                new PriceQuote(75L, "image-provider", "price-2026-07",
                        "cny-2026-07", "model-policy-v1")));
        reservationService.markPendingReconciliation(79L, "PROVIDER_RESULT_UNKNOWN");
        reservationService.markPendingReconciliation(80L, "PROVIDER_RESULT_UNKNOWN");

        assertThat(reservationService.settle(79L, 50L, "RECONCILED_PROVIDER_COST").status())
                .isEqualTo(CostReservationStatus.SETTLED);
        assertThat(reservationService.release(80L, "RECONCILED_NOT_CHARGED").status())
                .isEqualTo(CostReservationStatus.RELEASED);
    }

    @Test
    void providerFailureFinalizationUsesProviderStartEvidence() {
        reservationService.reserve(new CostReservationCommand(
                11L, 22L, 81L, "action-81", "generate_image",
                new PriceQuote(75L, "image-provider", "price-2026-07",
                        "cny-2026-07", "model-policy-v1")));
        reservationService.reserve(new CostReservationCommand(
                11L, 23L, 82L, "action-82", "generate_image",
                new PriceQuote(75L, "image-provider", "price-2026-07",
                        "cny-2026-07", "model-policy-v1")));

        reservationService.finalizeProviderFailure(81L, false);
        reservationService.finalizeProviderFailure(82L, true);

        assertThat(reservationService.findByJob(81L)).get()
                .extracting(CostReservationSnapshot::status)
                .isEqualTo(CostReservationStatus.RELEASED);
        assertThat(reservationService.findByJob(82L)).get()
                .extracting(CostReservationSnapshot::status)
                .isEqualTo(CostReservationStatus.PENDING_RECONCILIATION);
    }

    @Test
    void concurrentReservationsSerializeOnTheSameHardBudget() throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<String>> futures = List.of(88L, 89L).stream()
                    .map(jobId -> executor.submit(() -> {
                        ready.countDown();
                        start.await();
                        try {
                            return reservationService.reserve(new CostReservationCommand(
                                    11L, 22L, jobId, "action-" + jobId, "generate_image",
                                    new PriceQuote(125L, "image-provider", "price-2026-07",
                                            "cny-2026-07", "model-policy-v1")))
                                    .status().name();
                        } catch (GovernanceException exception) {
                            return exception.publicCode();
                        }
                    }))
                    .toList();
            ready.await();
            start.countDown();

            assertThat(futures.stream().map(future -> {
                try {
                    return future.get();
                } catch (Exception exception) {
                    throw new AssertionError(exception);
                }
            }).toList()).containsExactlyInAnyOrder("ACTIVE", "QUOTA_EXCEEDED");
            assertThat(jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM cost_reservations WHERE project_id = 22", Long.class))
                    .isEqualTo(1L);
        } finally {
            executor.shutdownNow();
        }
    }
}
