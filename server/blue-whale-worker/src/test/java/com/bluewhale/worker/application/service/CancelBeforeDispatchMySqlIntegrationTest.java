package com.bluewhale.worker.application.service;

import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.bluewhale.worker.application.processor.ImageJobProcessor;
import com.bluewhale.worker.infrastructure.mq.BillingEventPublisher;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.MountableFile;

import javax.sql.DataSource;
import java.time.Duration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers(disabledWithoutDocker = true)
class CancelBeforeDispatchMySqlIntegrationTest {
    @Container
    static final MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0")
            .withDatabaseName("ikm09u_worker_test")
            .withUsername("test").withPassword("test")
            .withCommand("--log-bin-trust-function-creators=1")
            .withCopyFileToContainer(MountableFile.forClasspathResource("db/bluewhale-schema.sql"),
                    "/docker-entrypoint-initdb.d/init.sql")
            .withStartupTimeout(Duration.ofMinutes(5));

    static AnnotationConfigApplicationContext context;
    static JdbcTemplate jdbc;
    static JobStateMachineService service;
    static GenerationJobMapper jobs;
    static ImageJobProcessor processor;

    @Configuration
    @EnableTransactionManagement
    @MapperScan("com.bluewhale.worker.infrastructure.persistence.mapper")
    @Import({JobStateMachineService.class, JobClaimService.class, JobFinalizer.class,
            SceneCardGenerationRecordSync.class, StoryboardPreviewSync.class,
            TerminalEventOutbox.class})
    static class Config {
        @Bean
        DataSource dataSource() {
            HikariConfig config = new HikariConfig();
            config.setJdbcUrl(mysql.getJdbcUrl());
            config.setUsername(mysql.getUsername());
            config.setPassword(mysql.getPassword());
            config.addDataSourceProperty("connectionTimeZone", "Asia/Shanghai");
            config.addDataSourceProperty("forceConnectionTimeZoneToSession", "true");
            return new HikariDataSource(config);
        }

        @Bean
        SqlSessionFactory sqlSessionFactory(DataSource dataSource) throws Exception {
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            return factory.getObject();
        }

        @Bean
        PlatformTransactionManager transactionManager(DataSource dataSource) {
            return new DataSourceTransactionManager(dataSource);
        }

        @Bean
        ControlledPublisher publisher() {
            return new ControlledPublisher();
        }
    }

    static class ControlledPublisher implements BillingEventPublisher {
        boolean unavailable;
        final List<String> delivered = new CopyOnWriteArrayList<>();

        @Override
        public void publish(String topic, String body) {
            if (unavailable) throw new IllegalStateException("IKM09U broker unavailable");
            assertThat(topic).isEqualTo("generation-job-terminal");
            delivered.add(body);
        }
    }

    @BeforeAll
    static void boot() {
        context = new AnnotationConfigApplicationContext(Config.class);
        jdbc = new JdbcTemplate(context.getBean(DataSource.class));
        service = context.getBean(JobStateMachineService.class);
        jobs = context.getBean(GenerationJobMapper.class);
        processor = new ImageJobProcessor(service, context.getBean(JobFinalizer.class),
                null, null, null, null, null);
    }

    @AfterAll
    static void close() {
        if (context != null) context.close();
    }

    @BeforeEach
    void clean() {
        jdbc.execute("DROP TRIGGER IF EXISTS ikm09u_reject_outbox");
        for (String table : List.of("generation_outbox", "generation_job_logs",
                "generation_output_slots", "generation_jobs", "project")) {
            jdbc.update("DELETE FROM " + table);
        }
        context.getBean(ControlledPublisher.class).delivered.clear();
        context.getBean(ControlledPublisher.class).unavailable = false;
    }

    @Test
    void outboxFailureRollsBackCancellationAndAllowsRetry() {
        seed(900901L);
        jdbc.execute("""
                CREATE TRIGGER ikm09u_reject_outbox BEFORE INSERT ON generation_outbox
                FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IKM09U injected outbox failure'
                """);

        assertThatThrownBy(() -> processor.handle("900901"))
                .hasStackTraceContaining("IKM09U injected outbox failure");
        var failed = jobs.selectById(900901L);
        assertThat(failed.getStatus()).isEqualTo("processing");
        assertThat(failed.getLeaseOwner()).isNotBlank();
        assertThat(jdbc.queryForObject("SELECT status FROM generation_output_slots WHERE generation_job_id=900901",
                String.class)).isEqualTo("pending");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM generation_outbox", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM generation_job_logs", Integer.class)).isZero();

        jdbc.execute("DROP TRIGGER ikm09u_reject_outbox");
        jdbc.update("UPDATE generation_jobs SET lease_expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=900901");
        processor.handle("900901");
        assertThat(jobs.selectById(900901L).getFencingToken()).isEqualTo(failed.getFencingToken() + 1);
        assertThat(jobs.selectById(900901L).getStatus()).isEqualTo("cancelled");
        assertThat(jdbc.queryForObject("SELECT status FROM generation_output_slots WHERE generation_job_id=900901",
                String.class)).isEqualTo("failed");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM generation_outbox WHERE job_id=900901 AND send_state='pending'",
                Integer.class)).isEqualTo(1);
    }

    @Test
    void unavailableBrokerKeepsPendingAndRecoverySendsTheSameEvent() throws Exception {
        seed(900902L);
        processor.handle("900902");
        var publisher = context.getBean(ControlledPublisher.class);
        var outbox = context.getBean(TerminalEventOutbox.class);
        long outboxId = jdbc.queryForObject("SELECT id FROM generation_outbox WHERE job_id=900902", Long.class);
        publisher.unavailable = true;
        outbox.drain(10);
        assertThat(publisher.delivered).isEmpty();
        assertThat(jdbc.queryForObject("SELECT send_state FROM generation_outbox WHERE id=?", String.class, outboxId))
                .isEqualTo("pending");
        assertThat(jdbc.queryForObject("SELECT attempts FROM generation_outbox WHERE id=?", Integer.class, outboxId))
                .isEqualTo(1);
        publisher.unavailable = false;
        outbox.drain(10);
        outbox.drain(10);
        assertThat(publisher.delivered).hasSize(1);
        var json = new ObjectMapper();
        var payload = json.readTree(publisher.delivered.getFirst());
        assertThat(payload.path("jobId").asLong()).isEqualTo(900902L);
        assertThat(payload.path("userId").asLong()).isEqualTo(9009L);
        assertThat(payload.path("status").asText()).isEqualTo("cancelled");
        assertThat(payload.path("refund").asBoolean()).isTrue();
        assertThat(jobs.selectById(900902L).getStatus()).isEqualTo("cancelled");
        assertThat(jdbc.queryForObject("SELECT send_state FROM generation_outbox WHERE id=?", String.class, outboxId))
                .isEqualTo("sent");
        String evidence = System.getenv("IKM09U_WORKER_EVENT");
        if (evidence != null) {
            Files.writeString(Path.of(evidence), json.writeValueAsString(Map.of(
                    "jobId", 900902L, "userId", 9009L, "outboxId", outboxId,
                    "status", jobs.selectById(900902L).getStatus(), "sendState", "sent", "attempts", 1,
                    "payload", publisher.delivered.getFirst())));
        }
    }

    @Test
    void competingClaimsAndLateMessagesProduceOneTerminalEvent() throws Exception {
        seed(900903L);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(8)) {
            var futures = java.util.stream.IntStream.range(0, 8).mapToObj(i -> executor.submit(() -> {
                start.await();
                processor.handle("900903");
                return true;
            })).toList();
            start.countDown();
            for (var future : futures) assertThat(future.get(10, TimeUnit.SECONDS)).isTrue();
        }
        processor.handle("900903");
        assertThat(jobs.selectById(900903L).getStatus()).isEqualTo("cancelled");
        assertThat(jobs.selectById(900903L).getFencingToken()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM generation_outbox WHERE job_id=900903", Integer.class))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM generation_job_logs WHERE generation_job_id=900903", Integer.class))
                .isEqualTo(1);
    }

    @Test
    void cancellationKeepsOwnerTokenProviderAndTerminalGuards() {
        seed(900904L);
        var claimed = service.claimImageJobById("900904", "owner").orElseThrow();
        assertThat(service.cancelJobBeforeDispatch("900904", "other", claimed.fencingToken())).isFalse();
        assertThat(service.cancelJobBeforeDispatch("900904", "owner", claimed.fencingToken() - 1)).isFalse();
        assertThat(service.claimImageJobById("900904", "late-worker")).isEmpty();
        jdbc.update("UPDATE generation_jobs SET provider_task_id='already-submitted' WHERE id=900904");
        assertThat(service.cancelJobBeforeDispatch("900904", "owner", claimed.fencingToken())).isFalse();
        assertThat(jobs.selectById(900904L).getStatus()).isEqualTo("processing");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM generation_outbox", Integer.class)).isZero();
        jdbc.update("UPDATE generation_jobs SET provider_task_id=NULL WHERE id=900904");
        assertThat(service.cancelJobBeforeDispatch("900904", "owner", claimed.fencingToken())).isTrue();
        assertThat(service.cancelJobBeforeDispatch("900904", "owner", claimed.fencingToken())).isFalse();
        assertThat(jobs.selectById(900904L).getStatus()).isEqualTo("cancelled");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM generation_outbox WHERE job_id=900904", Integer.class))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("音频取消：同项目并发取消各自写入终态 outbox")
    void concurrentAudioCancelsWriteDistinctTerminalOutbox() throws Exception {
        seedAudioMix(900906L, "owner", 1L);
        seedAudioMix(900907L, "owner", 1L);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var futures = java.util.stream.Stream.of("900906", "900907").map(jobId -> executor.submit(() -> {
                start.await();
                return service.cancelAudioMixIfRequested(jobId, "owner", 1L);
            })).toList();
            start.countDown();
            for (var future : futures) {
                assertThat(future.get(10, TimeUnit.SECONDS)).isTrue();
            }
        }
        assertThat(jobs.selectById(900906L).getStatus()).isEqualTo("cancelled");
        assertThat(jobs.selectById(900907L).getStatus()).isEqualTo("cancelled");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM generation_outbox", Integer.class)).isEqualTo(2);
    }

    private void seedProject() {
        jdbc.update("INSERT IGNORE INTO project(id,owner_id,name) VALUES (99,9009,'test')");
    }

    private void seed(long jobId) {
        seedProject();
        jdbc.update("""
                INSERT INTO generation_jobs(id,user_id,project_id,type,source,status,cancel_requested_at,input)
                VALUES (?,9009,99,'image','bottom_dock','queued',NOW(),'{}')
                """, jobId);
        jdbc.update("""
                INSERT INTO generation_output_slots(generation_job_id,project_id,slot_index,status)
                VALUES (?,99,0,'pending')
                """, jobId);
    }

    private void seedAudioMix(long jobId, String owner, long fencingToken) {
        seedProject();
        jdbc.update("""
                INSERT INTO generation_jobs(id,user_id,project_id,type,source,status,cancel_requested_at,
                    lease_owner,lease_expires_at,fencing_token,input)
                VALUES (?,9009,99,'audio_mix','dock','processing',NOW(),?,
                    DATE_ADD(NOW(), INTERVAL 1 MINUTE),?,'{}')
                """, jobId, owner, fencingToken);
    }
}
