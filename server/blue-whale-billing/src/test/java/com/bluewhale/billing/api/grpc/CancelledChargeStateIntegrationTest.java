package com.bluewhale.billing.api.grpc;

import com.bluewhale.billing.application.CreditService;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.infrastructure.mq.JobEventConsumer;
import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.apache.rocketmq.client.apis.ClientServiceProvider;
import org.apache.rocketmq.client.apis.consumer.ConsumeResult;
import org.apache.rocketmq.client.apis.consumer.MessageListener;
import org.apache.rocketmq.client.apis.consumer.PushConsumer;
import org.apache.rocketmq.client.apis.consumer.PushConsumerBuilder;
import org.apache.rocketmq.client.apis.message.MessageView;
import org.mockito.ArgumentCaptor;
import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.ListTransactionsRequest;
import com.bluewhale.contracts.billing.v1.UserTransaction;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Server;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

@SpringBootTest(properties = {"billing.grpc.enabled=true", "billing.grpc.port=0", "billing.mq.enabled=false"})
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class CancelledChargeStateIntegrationTest {
    private static final long USER = 9012;
    private static final long JOB = 901201;
    @Autowired private Server grpcServer;
    @Autowired private CreditService credits;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactionManager;
    private ManagedChannel channel;
    private BillingServiceGrpc.BillingServiceBlockingStub stub;

    @BeforeEach
    void setUp() {
        String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertThat(database).startsWith("bw_billing_test");
        jdbc.update("DELETE FROM billing_ledger_entries WHERE user_id = ?", USER);
        jdbc.update("DELETE FROM billing_cost_reservations WHERE user_id = ?", USER);
        jdbc.update("DELETE FROM billing_credit_lots WHERE user_id = ?", USER);
        credits.grant(USER, CreditSource.GIFT, 100, null, "grant", "ikm12y", "ikm12y");
        credits.charge(USER, "ikm12y", JOB, 40, 1, 10000, null, "取消计费状态");
        channel = ManagedChannelBuilder.forAddress("127.0.0.1", grpcServer.getPort()).usePlaintext().build();
        stub = BillingServiceGrpc.newBlockingStub(channel);
    }

    @AfterEach
    void close() {
        if (channel != null) channel.shutdownNow();
    }

    private UserTransaction transaction() {
        var response = stub.listTransactions(ListTransactionsRequest.newBuilder()
                .setUserId(USER).addTypeFilters("consume").addGenerationJobIds(JOB).build());
        assertThat(response.getItemsCount()).isEqualTo(1);
        return response.getItems(0);
    }

    @Test
    void 查询区分已扣款和已提交的退款() {
        assertThat(transaction().getChargeState()).isEqualTo("charged");
        credits.refund(JOB, "用户取消");
        assertThat(transaction().getChargeState()).isEqualTo("refunded");
        assertThat(transaction().getAmount()).isZero();
        assertThat(stub.listTransactions(ListTransactionsRequest.newBuilder()
                .setUserId(USER + 1).addGenerationJobIds(JOB).build()).getItemsCount()).isZero();
    }

    @Test
    void 未提交的退款不可见且回滚后仍为已扣款() {
        new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
            credits.refund(JOB, "用户取消");
            assertThat(transaction().getChargeState()).isEqualTo("charged");
            tx.setRollbackOnly();
        });
        assertThat(transaction().getChargeState()).isEqualTo("charged");
    }

    @Test
    void 消费失败重试与重复迟到事件不重复退款或回退计费状态() throws Exception {
        var provider = mock(ClientServiceProvider.class);
        var builder = mock(PushConsumerBuilder.class, RETURNS_SELF);
        when(provider.newPushConsumerBuilder()).thenReturn(builder);
        when(builder.build()).thenReturn(mock(PushConsumer.class));
        try (var sdk = mockStatic(ClientServiceProvider.class)) {
            sdk.when(ClientServiceProvider::loadService).thenReturn(provider);
            try (var consumer = new JobEventConsumer(
                    ClientConfiguration.newBuilder().setEndpoints("localhost:8081").build(),
                    "ikm12y", "generation-job-terminal", credits)) {
                var captured = ArgumentCaptor.forClass(MessageListener.class);
                verify(builder).setMessageListener(captured.capture());
                var listener = captured.getValue();
                jdbc.execute("CREATE TRIGGER ikm12y_refund_failure BEFORE INSERT ON billing_ledger_entries "
                        + "FOR EACH ROW BEGIN IF NEW.biz_type = 'refund' THEN "
                        + "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ikm12y injected failure'; END IF; END");
                try {
                    assertThat(listener.consume(event(true))).isEqualTo(ConsumeResult.FAILURE);
                    assertThat(transaction().getChargeState()).isEqualTo("charged");
                    assertThat(jdbc.queryForObject("SELECT SUM(remaining) FROM billing_credit_lots WHERE user_id = ?", Long.class, USER)).isEqualTo(60);
                } finally {
                    jdbc.execute("DROP TRIGGER ikm12y_refund_failure");
                }
                assertThat(listener.consume(event(true))).isEqualTo(ConsumeResult.SUCCESS);
                assertThat(transaction().getChargeState()).isEqualTo("refunded");
                var entries = jdbc.queryForList("SELECT * FROM billing_ledger_entries WHERE user_id = ? ORDER BY id", USER);
                assertThat(listener.consume(event(true))).isEqualTo(ConsumeResult.SUCCESS);
                assertThat(listener.consume(event(false))).isEqualTo(ConsumeResult.SUCCESS);
                assertThat(transaction().getChargeState()).isEqualTo("refunded");
                assertThat(jdbc.queryForList("SELECT * FROM billing_ledger_entries WHERE user_id = ? ORDER BY id", USER)).isEqualTo(entries);
                assertThat(jdbc.queryForObject("SELECT SUM(remaining) FROM billing_credit_lots WHERE user_id = ?", Long.class, USER)).isEqualTo(100);
                assertThat(jdbc.queryForList("SELECT account,direction,amount FROM billing_ledger_entries WHERE user_id = ? AND biz_type = 'refund' ORDER BY account", USER))
                        .extracting(row -> row.get("account") + ":" + row.get("direction") + ":" + row.get("amount"))
                        .containsExactly("cost:debit:40", "wallet:credit:40");
            }
        }
    }

    private MessageView event(boolean refund) {
        String payload = "{\"jobId\":" + JOB + ",\"userId\":" + USER
                + ",\"status\":\"cancelled\",\"refund\":" + refund + ",\"reason\":\"用户取消\"}";
        var message = mock(MessageView.class);
        when(message.getTopic()).thenReturn("generation-job-terminal");
        when(message.getBody()).thenAnswer(ignored -> ByteBuffer.wrap(payload.getBytes(StandardCharsets.UTF_8)));
        return message;
    }
}
