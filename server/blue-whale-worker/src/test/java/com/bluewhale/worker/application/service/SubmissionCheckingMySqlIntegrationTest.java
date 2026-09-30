package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper;
import com.bluewhale.worker.infrastructure.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.mapper.StoryboardPreviewMapper;
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

import static org.assertj.core.api.Assertions.assertThat;

/**
 * IKIZQD 真库集成：提交结果不明的核对与锁定（契约 §六 JOB_STATUS_CHECKING）。
 *
 * <p>父规格「提交与恢复」的真库断言：
 * <ol>
 *   <li>Worker 调网关前持久「提交中」（processing→checking，owner+fence+provider_task_id
 *       IS NULL 的 CAS）——失租/已提交的迟到写入被 fence 挡住（0 行）；</li>
 *   <li>checking 行**不被 claim 候选选中**（即使租约已过期、provider_task_id 为空）——
 *       这是「不按空 provider_task_id 重新提交」的 SQL 层保证：同键重放/并发/重启后
 *       至多一次已发上游的尝试；</li>
 *   <li>明确成功恢复原任务：markProviderSubmitted 从 checking 回 processing 并落
 *       轮询句柄，claim 重新可领取（走 poll 相位）；</li>
 *   <li>明确失败释放本阶段预扣：failVideoJob 从 checking 落 failed 且
 *       charge_state='released'（两阶段任务）。</li>
 * </ol>
 * 接线方式与 {@link JobStateMachineMySqlIntegrationTest} 同款：最小 Spring 上下文
 * （Hikari→MyBatis→Mapper→Service），无 MQ / scheduled。
 */
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
            cfg.setConnectionInitSql("SET time_zone='+08:00'");
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
        ProjectEventMapper projectEventMapper(SqlSessionFactory sf) throws Exception {
            return factory(ProjectEventMapper.class, sf).getObject();
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
        JobStateMachineService service(
                GenerationJobMapper jm, AssetMapper am, GenerationJobLogMapper jlm,
                ProjectEventMapper pem, GenerationOutputSlotMapper sm,
                SceneCardGenerationRecordMapper rm, StoryboardPreviewMapper pm) {
            return new JobStateMachineService(jm, am, jlm, pem, sm, rm, pm);
        }

        /** 真库 JobFinalizer（IKIWP8 ③ 终态收口直连）：装配对齐 JobStateMachineMySqlIntegrationTest 同名 bean。 */
        @Bean
        JobFinalizer finalizer(
                GenerationJobMapper jm, AssetMapper am, GenerationJobLogMapper jlm,
                GenerationOutputSlotMapper sm, ProjectEventMapper pem,
                SceneCardGenerationRecordMapper rm, StoryboardPreviewMapper pm) {
            ProjectEventPublisher events = new ProjectEventPublisher(pem);
            return new JobFinalizer(jm, am, jlm, sm,
                    new SceneCardGenerationRecordSync(sm, rm, events),
                    new StoryboardPreviewSync(sm, pm, events),
                    events,
                    JobSettlementPublisher.noop());
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

    /** 已领取的提交相 job 行：processing + 租约 + fence，两阶段身份与预扣随行。 */
    private long seedClaimedSubmitJob(String videoStage, String workerId, long token,
                                      Long sourceSampleJobId, String chargeState) {
        jdbc.update("""
                INSERT INTO generation_jobs
                  (user_id, type, source, status, lease_owner, lease_expires_at,
                   fencing_token, project_id, expected_output_count, input,
                   video_stage, source_sample_job_id, charge_state,
                   gmt_create, gmt_modified, version, is_delete)
                VALUES (42, 'video', 'bottom_dock', 'processing', ?, ?, ?, 1, 1, '{}',
                        ?, ?, ?, NOW(), NOW(), 0, false)
                """,
                workerId, WorkerClock.now().plusMinutes(10), token,
                videoStage, sourceSampleJobId, chargeState);
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id != null ? id : -1;
    }

    private Map<String, Object> row(long id) {
        return jdbc.queryForMap("SELECT status, provider_task_id, charge_state, lease_owner "
                + "FROM generation_jobs WHERE id = ?", id);
    }

    @Test
    @DisplayName("提交中标记：CAS 落 checking；失租/换主/已提交的迟到写入被 fence 挡住")
    void submissionAttemptIsFenced() {
        long jobId = seedClaimedSubmitJob("final", "w1", 5L, null, "held");

        assertThat(service.markSubmissionAttempt(String.valueOf(jobId), "w1", 5L)).isTrue();
        assertThat(row(jobId)).containsEntry("status", "checking");

        // 迟到写入三连拒：错误 owner、错误 fence、已提交（provider_task_id 非空）。
        long jobId2 = seedClaimedSubmitJob("final", "w1", 5L, null, "held");
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId2), "other", 5L)).isFalse();
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId2), "w1", 9L)).isFalse();
        jdbc.update("UPDATE generation_jobs SET provider_task_id = 'task-x' WHERE id = ?", jobId2);
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId2), "w1", 5L)).isFalse();
        assertThat(row(jobId2)).containsEntry("status", "processing");
    }

    @Test
    @DisplayName("锁定：checking 行租约过期 + provider_task_id 为空也不被 claim 选中（不重提）")
    void checkingRowIsNotClaimableEvenWithExpiredLease() {
        long jobId = seedClaimedSubmitJob("final", "w1", 5L, null, "held");
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId), "w1", 5L)).isTrue();
        // 模拟 Worker 崩溃：租约早已过期、next_action_at 已到、句柄仍为空。
        jdbc.update("""
                UPDATE generation_jobs
                SET lease_expires_at = ?, next_action_at = NOW() - INTERVAL 1 MINUTE
                WHERE id = ?
                """, WorkerClock.now().minusMinutes(5), jobId);

        Optional<ClaimedVideoJobDto> reclaimed = service.claimVideoJobById(
                String.valueOf(jobId), "recovery-worker");

        // ★ 空 provider_task_id 不能触发自动重提（IKIZQC 指出的窗口在此关闭）：
        //   任务保持 checking 锁定，等待人工核对，不由恢复扫描接管。
        assertThat(reclaimed).isEmpty();
        assertThat(row(jobId)).containsEntry("status", "checking");
    }

    @Test
    @DisplayName("明确成功恢复原任务：markProviderSubmitted 从 checking 回 processing 落句柄，claim 走 poll 相位")
    void submittedFromCheckingResumesPollPhase() {
        long jobId = seedClaimedSubmitJob("final", "w1", 5L, null, "held");
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId), "w1", 5L)).isTrue();

        assertThat(service.markProviderSubmitted(
                String.valueOf(jobId), "w1", 5L, "task-final-77")).isTrue();

        Map<String, Object> after = row(jobId);
        assertThat(after.get("status")).isEqualTo("processing");
        assertThat(after.get("provider_task_id")).isEqualTo("task-final-77");
        assertThat(after.get("lease_owner")).isNull();
        // 恢复后可重新领取（next_poll_at 已排），claim 携带句柄 → 轮询相位而非重发 finalize。
        jdbc.update("UPDATE generation_jobs SET next_action_at = NOW() - INTERVAL 1 SECOND WHERE id = ?", jobId);
        Optional<ClaimedVideoJobDto> reclaimed = service.claimVideoJobById(
                String.valueOf(jobId), "w2");
        assertThat(reclaimed).isPresent();
        assertThat(reclaimed.get().providerTaskId()).isEqualTo("task-final-77");
    }

    @Test
    @DisplayName("明确失败释放本阶段预扣：failVideoJob 从 checking 落 failed + charge released")
    void definiteFailureFromCheckingReleasesHold() {
        long jobId = seedClaimedSubmitJob("final", "w1", 5L, null, "held");
        assertThat(service.markSubmissionAttempt(String.valueOf(jobId), "w1", 5L)).isTrue();

        boolean failed = finalizer.failVideoJob(String.valueOf(jobId), "quota_exhausted",
                "网关明确拒绝", null, "w1", 5L);

        assertThat(failed).isTrue();
        assertThat(row(jobId))
                .containsEntry("status", "failed")
                .containsEntry("charge_state", "released");
    }

    @Test
    @DisplayName("重启后仍锁定：checking 状态跨「重启」持久（无内存态参与），普通视频同规")
    void checkingPersistsAcrossRestartForAnyStage() {
        // 样片（video_stage='sample'）draft 提交与普通视频共用同一提交相标记。
        long sampleJob = seedClaimedSubmitJob("sample", "w1", 3L, null, "held");
        long plainJob = seedClaimedSubmitJob(null, "w1", 3L, null, null);
        assertThat(service.markSubmissionAttempt(String.valueOf(sampleJob), "w1", 3L)).isTrue();
        assertThat(service.markSubmissionAttempt(String.valueOf(plainJob), "w1", 3L)).isTrue();

        // 「重启」在此即另一 worker 实例按 id 领取——两行都不可被接管。
        assertThat(service.claimVideoJobById(String.valueOf(sampleJob), "w2")).isEmpty();
        assertThat(service.claimVideoJobById(String.valueOf(plainJob), "w2")).isEmpty();
        assertThat(row(sampleJob)).containsEntry("status", "checking");
        assertThat(row(plainJob)).containsEntry("status", "checking");
    }
}
