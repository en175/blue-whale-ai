package com.bluewhale.billing.infrastructure.mq;

import com.bluewhale.billing.application.CreditService;
import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.LedgerRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
import com.bluewhale.billing.testsupport.LogCapture;
import ch.qos.logback.classic.Level;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.apache.rocketmq.client.apis.ClientServiceProvider;
import org.apache.rocketmq.client.apis.consumer.ConsumeResult;
import org.apache.rocketmq.client.apis.consumer.MessageListener;
import org.apache.rocketmq.client.apis.consumer.PushConsumer;
import org.apache.rocketmq.client.apis.consumer.PushConsumerBuilder;
import org.apache.rocketmq.client.apis.message.MessageView;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.Consumer;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.Mockito.RETURNS_SELF;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class CancelledWorkerEventIntegrationTest {

    @Autowired private JdbcTemplate jdbc;
    @Autowired private CreditService credits;
    @Autowired private CreditLotRepository lots;
    @Autowired private LedgerRepository ledger;
    @Autowired private ReservationRepository reservations;

    @Test
    void 失败说明422字符仍全额退款且重投不双退() throws Exception {
        long jobId = 910092;
        long userId = 910092;
        long lotId = prepareCharge(jobId, userId);
        String reason = "上游参数错误".repeat(70) + "失败";
        assertThat(reason.codePointCount(0, reason.length())).isEqualTo(422);
        assertThat(jdbc.queryForObject(
                "SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.columns "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_cost_reservations' "
                        + "AND COLUMN_NAME = 'release_note'", Integer.class)).isEqualTo(255);

        withListener(listener -> {
            MessageView message = failedMessage(jobId, userId, reason);
            assertThat(listener.consume(message)).isEqualTo(ConsumeResult.SUCCESS);
            assertRefund(jobId, userId, lotId, "上游参数错误".repeat(42) + "上游参");
            var entries = jdbc.queryForList(
                    "SELECT * FROM billing_ledger_entries WHERE user_id = ? ORDER BY id", userId);
            assertThat(listener.consume(message)).isEqualTo(ConsumeResult.SUCCESS);
            assertRefund(jobId, userId, lotId, "上游参数错误".repeat(42) + "上游参");
            assertThat(jdbc.queryForList(
                    "SELECT * FROM billing_ledger_entries WHERE user_id = ? ORDER BY id", userId))
                    .isEqualTo(entries);
        });
    }

    @ParameterizedTest
    @MethodSource("releaseNotes")
    void 失败说明遵守数据库字符上限并保留短备注(String reason, String expected) throws Exception {
        long jobId = 910093;
        long userId = 910093;
        long lotId = prepareCharge(jobId, userId);
        withListener(listener -> {
            assertThat(listener.consume(failedMessage(jobId, userId, reason))).isEqualTo(ConsumeResult.SUCCESS);
            assertRefund(jobId, userId, lotId, expected);
        });
    }

    static Stream<Arguments> releaseNotes() {
        return Stream.of(
                Arguments.of("a".repeat(255), "a".repeat(255)),
                Arguments.of("a".repeat(256), "a".repeat(255)),
                Arguments.of("错".repeat(255), "错".repeat(255)),
                Arguments.of("错".repeat(256), "错".repeat(255)),
                Arguments.of("😀".repeat(255), "😀".repeat(255)),
                Arguments.of("😀".repeat(256), "😀".repeat(255)),
                Arguments.of("a".repeat(254) + "😀尾", "a".repeat(254) + "😀"),
                Arguments.of("  参数错误  ", "  参数错误  "),
                Arguments.of("", "未提供原因"),
                Arguments.of("   ", "未提供原因"),
                Arguments.of(null, "未提供原因"));
    }

    @Test
    void 同一失败事件并发和已退款后重投只产生一组凭证() throws Exception {
        long jobId = 910094;
        long userId = 910094;
        long lotId = prepareCharge(jobId, userId);
        String reason = "错".repeat(422);
        withListener(listener -> {
            CyclicBarrier start = new CyclicBarrier(8);
            try (var executor = Executors.newFixedThreadPool(8)) {
                var deliveries = IntStream.range(0, 8)
                        .mapToObj(ignored -> CompletableFuture.supplyAsync(() -> {
                            try {
                                start.await(10, TimeUnit.SECONDS);
                            } catch (Exception error) {
                                throw new IllegalStateException(error);
                            }
                            return listener.consume(failedMessage(jobId, userId, reason));
                        }, executor)).toList();
                assertThat(deliveries).allSatisfy(delivery ->
                        assertThat(delivery.join()).isEqualTo(ConsumeResult.SUCCESS));
            }
            assertRefund(jobId, userId, lotId, "错".repeat(255));
            var entries = jdbc.queryForList(
                    "SELECT * FROM billing_ledger_entries WHERE user_id = ? ORDER BY id", userId);
            assertThat(listener.consume(failedMessage(jobId, userId, "迟到的失败")))
                    .isEqualTo(ConsumeResult.SUCCESS);
            assertRefund(jobId, userId, lotId, "错".repeat(255));
            assertThat(jdbc.queryForList(
                    "SELECT * FROM billing_ledger_entries WHERE user_id = ? ORDER BY id", userId))
                    .isEqualTo(entries);
        });
    }

    @Test
    void 真实数据库写入失败整笔回滚并能重投恢复且保留完整错误() throws Exception {
        long jobId = 910095;
        long userId = 910095;
        long lotId = prepareCharge(jobId, userId);
        var entriesBefore = jdbc.queryForList(
                "SELECT * FROM billing_ledger_entries WHERE user_id = ? ORDER BY id", userId);
        String reason = "错".repeat(422);
        withListener(listener -> {
            jdbc.execute("CREATE TRIGGER iknb92_refund_failure BEFORE UPDATE ON billing_cost_reservations "
                    + "FOR EACH ROW BEGIN IF NEW.generation_job_id = 910095 AND NEW.status = 'refunded' THEN "
                    + "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'iknb92 forced persistence failure'; "
                    + "END IF; END");
            try (var logs = LogCapture.of(JobEventConsumer.class)) {
                assertThat(listener.consume(failedMessage(jobId, userId, reason))).isEqualTo(ConsumeResult.FAILURE);
                assertThat(logs.text(Level.ERROR)).contains(reason);
                assertThat(reservations.findByJobId(jobId).orElseThrow().status())
                        .isEqualTo(Reservation.Status.CHARGED);
                assertThat(lots.availableCredits(userId)).isEqualTo(60);
                assertThat(ledger.balanceOf(userId, Account.WALLET)).isEqualTo(60);
                assertThat(jdbc.queryForObject("SELECT remaining FROM billing_credit_lots WHERE id = ?",
                        Long.class, lotId)).isEqualTo(60);
                assertThat(jdbc.queryForList(
                        "SELECT * FROM billing_ledger_entries WHERE user_id = ? ORDER BY id", userId))
                        .isEqualTo(entriesBefore);
            } finally {
                jdbc.execute("DROP TRIGGER iknb92_refund_failure");
            }
            assertThat(listener.consume(failedMessage(jobId, userId, reason))).isEqualTo(ConsumeResult.SUCCESS);
            assertRefund(jobId, userId, lotId, "错".repeat(255));
        });
    }

    private long prepareCharge(long jobId, long userId) {
        jdbc.update("DELETE FROM billing_ledger_entries WHERE user_id = ?", userId);
        jdbc.update("DELETE FROM billing_cost_reservations WHERE user_id = ?", userId);
        jdbc.update("DELETE FROM billing_credit_lots WHERE user_id = ?", userId);
        long lotId = credits.grant(userId, CreditSource.GIFT, 100, null,
                "grant", "iknb92", "iknb92:" + jobId);
        credits.charge(userId, "iknb92:" + jobId, jobId, 40, 1, 10_000, null, "失败退款验收");
        assertThat(lots.availableCredits(userId)).isEqualTo(60);
        return lotId;
    }

    private MessageView failedMessage(long jobId, long userId, String reason) {
        byte[] payload;
        try {
            ObjectMapper json = new ObjectMapper();
            payload = json.writeValueAsBytes(json.createObjectNode()
                    .put("jobId", jobId).put("userId", userId).put("status", "failed")
                    .put("reason", reason).put("refund", true));
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
        MessageView message = mock(MessageView.class);
        when(message.getTopic()).thenReturn("generation-job-terminal");
        when(message.getBody()).thenAnswer(ignored -> ByteBuffer.wrap(payload));
        return message;
    }

    private void withListener(Consumer<MessageListener> action) throws Exception {
        ClientServiceProvider provider = mock(ClientServiceProvider.class);
        PushConsumerBuilder builder = mock(PushConsumerBuilder.class, RETURNS_SELF);
        when(provider.newPushConsumerBuilder()).thenReturn(builder);
        when(builder.build()).thenReturn(mock(PushConsumer.class));
        try (var sdk = mockStatic(ClientServiceProvider.class)) {
            sdk.when(ClientServiceProvider::loadService).thenReturn(provider);
            try (var consumer = new JobEventConsumer(
                    ClientConfiguration.newBuilder().setEndpoints("localhost:8081").build(),
                    "iknb92-billing", "generation-job-terminal", credits)) {
                ArgumentCaptor<MessageListener> listener = ArgumentCaptor.forClass(MessageListener.class);
                verify(builder).setMessageListener(listener.capture());
                action.accept(listener.getValue());
            }
        }
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "IKM09U_WORKER_EVENT", matches = ".+")
    void worker取消事件重复投递只返还一次并保持借贷平衡() throws Exception {
        ObjectMapper json = new ObjectMapper();
        JsonNode receipt = json.readTree(Files.readString(Path.of(System.getenv("IKM09U_WORKER_EVENT"))));
        long jobId = receipt.path("jobId").asLong();
        long userId = receipt.path("userId").asLong();
        String payload = receipt.path("payload").asText();
        JsonNode event = json.readTree(payload);
        assertThat(jobId).isPositive();
        assertThat(userId).isPositive();
        assertThat(receipt.path("outboxId").asLong()).isPositive();
        assertThat(receipt.path("status").asText()).isEqualTo("cancelled");
        assertThat(receipt.path("sendState").asText()).isEqualTo("sent");
        assertThat(receipt.path("attempts").asInt()).isEqualTo(1);
        assertThat(event.path("jobId").asLong()).isEqualTo(jobId);
        assertThat(event.path("userId").asLong()).isEqualTo(userId);
        assertThat(event.path("status").asText()).isEqualTo("cancelled");
        assertThat(event.path("refund").asBoolean()).isTrue();

        jdbc.update("DELETE FROM billing_ledger_entries WHERE user_id = ?", userId);
        jdbc.update("DELETE FROM billing_cost_reservations WHERE user_id = ?", userId);
        jdbc.update("DELETE FROM billing_credit_lots WHERE user_id = ?", userId);
        long lotId = credits.grant(userId, CreditSource.GIFT, 100, null,
                "grant", "ikm09u", "ikm09u:" + jobId);
        credits.charge(userId, "ikm09u:" + jobId, jobId, 40, 1, 10_000, null, "取消退款验收");
        assertThat(lots.availableCredits(userId)).isEqualTo(60);
        assertThat(reservations.findByJobId(jobId).orElseThrow().status())
                .isEqualTo(Reservation.Status.CHARGED);

        ClientServiceProvider provider = mock(ClientServiceProvider.class);
        PushConsumerBuilder builder = mock(PushConsumerBuilder.class, RETURNS_SELF);
        when(provider.newPushConsumerBuilder()).thenReturn(builder);
        when(builder.build()).thenReturn(mock(PushConsumer.class));
        MessageView message = mock(MessageView.class);
        when(message.getTopic()).thenReturn("generation-job-terminal");
        when(message.getBody()).thenAnswer(ignored -> ByteBuffer.wrap(payload.getBytes(StandardCharsets.UTF_8)));

        try (var sdk = mockStatic(ClientServiceProvider.class)) {
            sdk.when(ClientServiceProvider::loadService).thenReturn(provider);
            try (var consumer = new JobEventConsumer(
                    ClientConfiguration.newBuilder().setEndpoints("localhost:8081").build(),
                    "ikm09u-billing", "generation-job-terminal", credits)) {
                ArgumentCaptor<MessageListener> listener = ArgumentCaptor.forClass(MessageListener.class);
                verify(builder).setMessageListener(listener.capture());
                assertThat(listener.getValue().consume(message)).isEqualTo(ConsumeResult.SUCCESS);
                assertRefund(jobId, userId, lotId, event.path("reason").asText());
                var entriesAfterRefund = jdbc.queryForList(
                        "SELECT * FROM billing_ledger_entries WHERE user_id = ? ORDER BY id", userId);

                assertThat(listener.getValue().consume(message)).isEqualTo(ConsumeResult.SUCCESS);
                assertRefund(jobId, userId, lotId, event.path("reason").asText());
                assertThat(jdbc.queryForList(
                        "SELECT * FROM billing_ledger_entries WHERE user_id = ? ORDER BY id", userId))
                        .isEqualTo(entriesAfterRefund);
            }
        }
        System.out.printf("IKM09U billing PASS jobId=%d userId=%d outboxId=%d deliveries=2 refundVouchers=1 refundEntries=2 balance=100%n",
                jobId, userId, receipt.path("outboxId").asLong());
    }

    private void assertRefund(long jobId, long userId, long lotId, String reason) {
        Reservation reservation = reservations.findByJobId(jobId).orElseThrow();
        assertThat(reservation.status()).isEqualTo(Reservation.Status.REFUNDED);
        assertThat(reservation.releaseNote()).isEqualTo(reason);
        assertThat(lots.availableCredits(userId)).isEqualTo(100);
        assertThat(ledger.balanceOf(userId, Account.WALLET)).isEqualTo(100);
        assertThat(jdbc.queryForObject("SELECT remaining FROM billing_credit_lots WHERE id = ?",
                Long.class, lotId)).isEqualTo(100);
        var refunds = jdbc.queryForList(
                "SELECT account, direction, amount, idempotency_key FROM billing_ledger_entries "
                        + "WHERE user_id = ? AND biz_type = 'refund' AND biz_id = ? ORDER BY id",
                userId, String.valueOf(jobId));
        assertThat(refunds).hasSize(2)
                .extracting(row -> row.get("account"), row -> row.get("direction"),
                        row -> ((Number) row.get("amount")).longValue())
                .containsExactlyInAnyOrder(tuple("wallet", "credit", 40L), tuple("cost", "debit", 40L));
        assertThat(refunds).allSatisfy(row -> assertThat((String) row.get("idempotency_key"))
                .startsWith("refund:" + jobId + ":"));
    }
}
