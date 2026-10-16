package com.bluewhale.billing.infrastructure.mq;

import com.bluewhale.billing.application.CreditService;
import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.LedgerRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
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
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

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
