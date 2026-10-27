package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.StoryboardPreviewMapper;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import javax.sql.DataSource;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers(disabledWithoutDocker = true)
@DisplayName("提交结果不明核对与锁定真库测试（IKIZQD）")
class SubmissionCheckingMySqlIntegrationTest {

    @Container
    static final MySQLContainer<?> mysql = new MySQLContainer<>(DockerImageName.parse("mysql:8.0"))
            .withDatabaseName("bluewhale_test")
            .withUsername("test")
            .withPassword("test")
            .withCommand("--default-time-zone=+00:00")
            .withCopyFileToContainer(
                    MountableFile.forClasspathResource("db/bluewhale-schema.sql"),
                    "/docker-entrypoint-initdb.d/init.sql")
            .withStartupTimeout(Duration.ofMinutes(5))
            .withReuse(true);

    static AnnotationConfigApplicationContext ctx;
    static JobStateMachineService service;
    static JobFinalizer finalizer;
    static JdbcTemplate jdbc;

    @Configuration
    static class TestConfig {

        @Bean
        DataSource dataSource() {
            HikariConfig cfg = new HikariConfig();
            cfg.setJdbcUrl(mysql.getJdbcUrl());
            cfg.setUsername(mysql.getUsername());
            cfg.setPassword(mysql.getPassword());
            cfg.setMaximumPoolSize(5);
            cfg.addDataSourceProperty("connectionTimeZone", "Asia/Shanghai");
            cfg.addDataSourceProperty("forceConnectionTimeZoneToSession", "true");
            return new HikariDataSource(cfg);
        }

        @Bean
        SqlSessionFactory sqlSessionFactory(DataSource ds) throws Exception {
            MybatisSqlSessionFactoryBean f = new MybatisSqlSessionFactoryBean();
            f.setDataSource(ds);
            return f.getObject();
        }

        @Bean
        PlatformTransactionManager txManager(DataSource ds) {
            return new DataSourceTransactionManager(ds);
        }

        @Bean
        GenerationJobMapper jobMapper(SqlSessionFactory sf) throws Exception {
            return factory(GenerationJobMapper.class, sf).getObject();
        }

        @Bean
        AssetMapper assetMapper(SqlSessionFactory sf) throws Exception {
            return factory(AssetMapper.class, sf).getObject();
        }

        @Bean
        GenerationJobLogMapper jobLogMapper(SqlSessionFactory sf) throws Exception {
            return factory(GenerationJobLogMapper.class, sf).getObject();
        }

        @Bean
        GenerationOutputSlotMapper slotMapper(SqlSessionFactory sf) throws Exception {
            return factory(GenerationOutputSlotMapper.class, sf).getObject();
        }

        @Bean
        SceneCardGenerationRecordMapper recordMapper(SqlSessionFactory sf) throws Exception {
            return factory(SceneCardGenerationRecordMapper.class, sf).getObject();
        }

        @Bean
        StoryboardPreviewMapper previewMapper(SqlSessionFactory sf) throws Exception {
            return factory(StoryboardPreviewMapper.class, sf).getObject();
        }

        @Bean
        GenerationJobExtraMapper extraMapper(SqlSessionFactory sf) throws Exception {
            return factory(GenerationJobExtraMapper.class, sf).getObject();
        }

        @Bean
        JobStateMachineService service(
                GenerationJobMapper jm, AssetMapper am, GenerationJobLogMapper jlm,
                GenerationOutputSlotMapper sm,
                SceneCardGenerationRecordMapper rm, StoryboardPreviewMapper pm,
                GenerationJobExtraMapper em) {
            return new JobStateMachineService(jm, am, jlm, sm, rm, pm, em);
        }

        @Bean
        JobFinalizer finalizer(
                GenerationJobMapper jm, AssetMapper am, GenerationJobLogMapper jlm,
                GenerationOutputSlotMapper sm, GenerationJobExtraMapper em,
                SceneCardGenerationRecordMapper rm, StoryboardPreviewMapper pm) {
            return new JobFinalizer(jm, am, jlm, sm, em,
                    new SceneCardGenerationRecordSync(sm, rm),
                    new StoryboardPreviewSync(sm, pm),
                    TerminalEventOutbox.noop());
        }

        @SuppressWarnings({"unchecked", "rawtypes"})
        private static <T> MapperFactoryBean<T> factory(Class<T> mapperIf, SqlSessionFactory sf)
                throws Exception {
            MapperFactoryBean<T> b = new MapperFactoryBean<>(mapperIf);
            b.setSqlSessionFactory(sf);
            b.afterPropertiesSet();
            return b;
        }
    }

    @BeforeAll
    static void boot() {
        ctx = new AnnotationConfigApplicationContext(TestConfig.class);
        service = ctx.getBean(JobStateMachineService.class);
        finalizer = ctx.getBean(JobFinalizer.class);
        jdbc = new JdbcTemplate(ctx.getBean(DataSource.class));
    }

    @AfterAll
    static void shutdown() {
        if (ctx != null) ctx.close();
    }

    @BeforeEach
    void cleanup() {
        List<String> tables = jdbc.queryForList(
                "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
                String.class, mysql.getDatabaseName());
        jdbc.execute("SET FOREIGN_KEY_CHECKS = 0");
        tables.forEach(t -> jdbc.execute("TRUNCATE TABLE `" + t + "`"));
        jdbc.execute("SET FOREIGN_KEY_CHECKS = 1");
    }

    private long seedClaimedSubmitJob(String videoStage, String workerId, long token,
                                      Long sourceSampleJobId, String chargeState) {
        jdbc.update("""
                INSERT INTO generation_jobs
                  (user_id, type, source, status, lease_owner, lease_expires_at,
                   fencing_token, project_id, input, source_sample_job_id,
                   gmt_create, gmt_modified, version, is_delete)
                VALUES (42, 'video', 'bottom_dock', 'processing', ?, ?, ?, 1, '{}', ?,
                        NOW(), NOW(), 0, false)
                """,
                workerId, LocalDateTime.now().plusMinutes(10), token, sourceSampleJobId);
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        long jobId = id != null ? id : -1;
        if (videoStage != null) {
            upsertExtra(jobId, "video_stage", "string", videoStage);
        }
        if (chargeState != null) {
            upsertExtra(jobId, "charge_state", "string", chargeState);
        }
        return jobId;
    }

    private void upsertExtra(long jobId, String extraKey, String valueType, String valueText) {
        jdbc.update("""
                INSERT INTO generation_job_extras
                  (generation_job_id, extra_key, value_type, value_text, gmt_create, gmt_modified)
                VALUES (?, ?, ?, ?, NOW(), NOW())
                ON DUPLICATE KEY UPDATE value_type = VALUES(value_type),
                    value_text = VALUES(value_text), gmt_modified = NOW()
                """, jobId, extraKey, valueType, valueText);
    }

    private Map<String, Object> row(long id) {
        Map<String, Object> out = new java.util.HashMap<>(jdbc.queryForMap(
                "SELECT status, provider_task_id, lease_owner "
                        + "FROM generation_jobs WHERE id = ?", id));
        List<String> chargeStates = jdbc.queryForList(
                "SELECT value_text FROM generation_job_extras "
                        + "WHERE generation_job_id = ? AND extra_key = 'charge_state'", String.class, id);
        out.put("charge_state", chargeStates.isEmpty() ? null : chargeStates.get(0));
        return out;
    }

    @Test
    @DisplayName("提交中标记：CAS 落 checking；失租/换主/已提交的迟到写入被 fence 挡住")
    void submissionAttemptIsFenced() {
        long jobId = seedClaimedSubmitJob("final", "w1", 5L, null, "charged");

        assertThat(service.markSubmissionAttempt(String.valueOf(jobId), "w1", 5L)).isTrue();
        assertThat(row(jobId)).containsEntry("status", "checking");

        long jobId2 = seedClaimedSubmitJob("final", "w1", 5L, null, "charged");
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId2), "other", 5L)).isFalse();
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId2), "w1", 9L)).isFalse();
        jdbc.update("UPDATE generation_jobs SET provider_task_id = 'task-x' WHERE id = ?", jobId2);
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId2), "w1", 5L)).isFalse();
        assertThat(row(jobId2)).containsEntry("status", "processing");
    }

    @Test
    @DisplayName("锁定：checking 行租约过期 + provider_task_id 为空也不被 claim 选中（不重提）")
    void checkingRowIsNotClaimableEvenWithExpiredLease() {
        long jobId = seedClaimedSubmitJob("final", "w1", 5L, null, "charged");
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId), "w1", 5L)).isTrue();
        jdbc.update("""
                UPDATE generation_jobs
                SET lease_expires_at = ?, next_action_at = NOW() - INTERVAL 1 MINUTE
                WHERE id = ?
                """, LocalDateTime.now().minusMinutes(5), jobId);

        Optional<ClaimedVideoJobDto> reclaimed = service.claimVideoJobById(
                String.valueOf(jobId), "recovery-worker");

        assertThat(reclaimed).isEmpty();
        assertThat(row(jobId)).containsEntry("status", "checking");
    }

    @Test
    @DisplayName("明确成功恢复原任务：markProviderSubmitted 从 checking 回 processing 落句柄，claim 走 poll 相位")
    void submittedFromCheckingResumesPollPhase() {
        long jobId = seedClaimedSubmitJob("final", "w1", 5L, null, "charged");
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId), "w1", 5L)).isTrue();

        assertThat(service.markProviderSubmitted(
                String.valueOf(jobId), "w1", 5L, "task-final-77")).isTrue();

        Map<String, Object> after = row(jobId);
        assertThat(after.get("status")).isEqualTo("processing");
        assertThat(after.get("provider_task_id")).isEqualTo("task-final-77");
        assertThat(after.get("lease_owner")).isNull();
        jdbc.update("UPDATE generation_jobs SET next_action_at = NOW() - INTERVAL 1 SECOND WHERE id = ?", jobId);
        Optional<ClaimedVideoJobDto> reclaimed = service.claimVideoJobById(
                String.valueOf(jobId), "w2");
        assertThat(reclaimed).isPresent();
        assertThat(reclaimed.get().providerTaskId()).isEqualTo("task-final-77");
    }

    @Test
    @DisplayName("明确失败释放本阶段预扣：failVideoJob 从 checking 落 failed + charge refunded")
    void definiteFailureFromCheckingReleasesHold() {
        long jobId = seedClaimedSubmitJob("final", "w1", 5L, null, "charged");
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId), "w1", 5L)).isTrue();

        boolean failed = finalizer.failVideoJob(String.valueOf(jobId), "platform_quota_exhausted",
                "网关明确拒绝", null, "w1", 5L);

        assertThat(failed).isTrue();
        assertThat(row(jobId))
                .containsEntry("status", "failed")
                .containsEntry("charge_state", "refunded");
    }

    @Test
    @DisplayName("重启后仍锁定：checking 状态跨「重启」持久（无内存态参与），普通视频同规")
    void checkingPersistsAcrossRestartForAnyStage() {
        long sampleJob = seedClaimedSubmitJob("sample", "w1", 3L, null, "charged");
        long plainJob = seedClaimedSubmitJob(null, "w1", 3L, null, null);
        assertThat(service.markSubmissionAttempt(String.valueOf(sampleJob), "w1", 3L)).isTrue();
        assertThat(service.markSubmissionAttempt(String.valueOf(plainJob), "w1", 3L)).isTrue();

        assertThat(service.claimVideoJobById(String.valueOf(sampleJob), "w2")).isEmpty();
        assertThat(service.claimVideoJobById(String.valueOf(plainJob), "w2")).isEmpty();
        assertThat(row(sampleJob)).containsEntry("status", "checking");
        assertThat(row(plainJob)).containsEntry("status", "checking");
    }
}
