package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.dto.ClaimedAudioTrimJobDto;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.contract.AudioMixContract;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.dto.UpdateMediaExtractProgressDto;
import com.bluewhale.worker.application.processor.AudioMixJobProcessor;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.entity.ProjectEventEntity;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper;
import com.bluewhale.worker.infrastructure.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.mapper.StoryboardPreviewMapper;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
import com.sun.net.httpserver.HttpServer;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
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

import javax.sql.DataSource;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * JobStateMachineService 真库集成测试（blade-1：Testcontainers 安全网）。
 * <p>
 * 覆盖金标：G03/G05/G06/G08/G09/G10/G12/G13/G14/G15/G17/G18/G19/G22/G23/G24/G25/G39/G41。
 * <p>
 * 接线方式：手动 AnnotationConfigApplicationContext（不扫 autoconfig），
 * 仅注册 HikariDataSource→MybatisSqlSessionFactory→7 个 Mapper→JobStateMachineService→TxManager。
 * MQ consumer / scheduled recovery 完全不启动——靠「只注册 TestConfig、不做组件扫描」保证，
 * 与已退役的 worker.enabled-tags 开关无关。
 */
@Testcontainers(disabledWithoutDocker = true)
@DisplayName("JobStateMachine 真库集成测试（MySQL Testcontainers）")
class JobStateMachineMySqlIntegrationTest {

    // ========== 容器与上下文 ==========

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
    static JdbcTemplate jdbc;
    static GenerationJobMapper jobMapper;
    static AssetMapper assetMapper;
    static GenerationJobLogMapper jobLogMapper;
    static ProjectEventMapper projectEventMapper;
    static GenerationOutputSlotMapper slotMapper;

    /** 最小 Spring 上下文：不含 autoconfig / MQ / scheduled。 */
    @Configuration
    static class TestConfig {

        @Bean
        DataSource dataSource() {
            HikariConfig cfg = new HikariConfig();
            cfg.setJdbcUrl(mysql.getJdbcUrl());
            cfg.setUsername(mysql.getUsername());
            cfg.setPassword(mysql.getPassword());
            cfg.setMaximumPoolSize(5);
            // 时间口径（IKHJ0Q）：与生产 DataSourceConfig 同款。集成测试手工装配 Hikari，不扫 autoconfig——
            // 不补这一条就会在 UTC 会话下跑而生产跑在 +08:00，而所有到期判断都在 SQL 里对 NOW()，
            // 「窗口静默失效」这类 bug 一条都测不出来。容器默认时区仍留 +00:00 是刻意的：正好证明它能覆盖服务端默认值。
            cfg.setConnectionInitSql("SET time_zone='+08:00'");
            return new HikariDataSource(cfg);
        }

        @Bean
        SqlSessionFactory sqlSessionFactory(DataSource ds) throws Exception {
            MybatisSqlSessionFactoryBean f = new MybatisSqlSessionFactoryBean();
            f.setDataSource(ds);
            // MybatisSqlSessionFactoryBean 默认用 MybatisConfiguration（mapUnderscoreToCamelCase=true）
            return f.getObject();
        }

        @Bean
        PlatformTransactionManager txManager(DataSource ds) {
            return new DataSourceTransactionManager(ds);
        }

        // --- 7 个 Mapper Bean（手动注册，避开 @MapperScan 拉起无关 Mapper） ---

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
        if (System.getenv("IKI68N_EXTERNAL_DB_URL") != null) {
            throw new IllegalStateException("普通 MySQL 金标禁止 IKI68N_EXTERNAL_DB_URL；跨端验收须运行专用测试类");
        }
        ctx = new AnnotationConfigApplicationContext(TestConfig.class);
        service = ctx.getBean(JobStateMachineService.class);
        jdbc = new JdbcTemplate(ctx.getBean(DataSource.class));
        jobMapper = ctx.getBean(GenerationJobMapper.class);
        assetMapper = ctx.getBean(AssetMapper.class);
        jobLogMapper = ctx.getBean(GenerationJobLogMapper.class);
        projectEventMapper = ctx.getBean(ProjectEventMapper.class);
        slotMapper = ctx.getBean(GenerationOutputSlotMapper.class);
    }

    @AfterAll
    static void shutdown() {
        if (ctx != null) ctx.close();
    }

    /** 截断所有表，保留结构；每个测试隔离。 */
    @BeforeEach
    void cleanup() {
        List<String> tables = jdbc.queryForList(
                "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
                String.class, mysql.getDatabaseName());
        jdbc.execute("SET FOREIGN_KEY_CHECKS = 0");
        tables.forEach(t -> jdbc.execute("TRUNCATE TABLE `" + t + "`"));
        jdbc.execute("SET FOREIGN_KEY_CHECKS = 1");
    }

    // ========== 测试数据种子 ==========

    /** 通过 JdbcTemplate 插 job 行（可控全部列，避免 Entity 缺字段）。 */
    private long seedJob(long userId, String type, String source, String status,
                         long fencingToken, LocalDateTime nextActionAt) {
        return seedJob(userId, type, source, status, fencingToken, nextActionAt, 99L, null);
    }

    private long seedJob(long userId, String type, String source, String status,
                         long fencingToken, LocalDateTime nextActionAt,
                         Long projectId, String inputJson) {
        jdbc.update("""
                INSERT INTO generation_jobs
                  (user_id, type, source, status, fencing_token, next_action_at,
                   project_id, input, progress, expected_output_count,
                   gmt_create, gmt_modified, version, is_delete)
                VALUES (?,?,?,?,?,?,?,?,?,0,NOW(),NOW(),0,false)
                """,
                userId, type, source, status, fencingToken, nextActionAt,
                projectId, inputJson, 0);
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id != null ? id : -1;
    }

    /** 插 processing + 已领取态 job（用于测 fence guard / 终态写入）。 */
    private long seedClaimedJob(long userId, String type, String source,
                                String workerId, long token) {
        LocalDateTime future = WorkerClock.now().plusMinutes(10);
        jdbc.update("""
                INSERT INTO generation_jobs
                  (user_id, type, source, status, lease_owner, lease_expires_at,
                   fencing_token, project_id, expected_output_count,
                   gmt_create, gmt_modified, version, is_delete)
                VALUES (?,?,?,?,?,?,?,99,1,NOW(),NOW(),0,false)
                """,
                userId, type, source, "processing", workerId, future, token);
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id != null ? id : -1;
    }

    /** 插 slot 行（含 project_id，绕开 Entity 缺字段问题——见 blade-4 TODO）。 */
    private long seedSlot(long jobId, long projectId, int slotIndex, String status) {
        return seedSlot(jobId, projectId, slotIndex, status, null);
    }

    private long seedSlot(long jobId, long projectId, int slotIndex, String status, Long recordId) {
        jdbc.update("""
                INSERT INTO generation_output_slots
                  (generation_job_id, project_id, slot_index, status,
                   scene_card_generation_record_id, gmt_create, gmt_modified)
                VALUES (?,?,?,?,?,NOW(),NOW())
                """, jobId, projectId, slotIndex, status, recordId);
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id != null ? id : -1;
    }

    private long seedStoryboardPreview(long jobId, long projectId) {
        jdbc.update("""
                INSERT INTO storyboard_previews
                  (scene_card_id, project_id, first_generation_job_id, command_id,
                   summary_status, capability_snapshot_version,
                   gmt_create, gmt_modified, version, is_delete)
                VALUES (1,?,?,?,  'generating','{}',NOW(),NOW(),1,0)
                """, projectId, jobId, "cmd-" + jobId);
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id != null ? id : -1;
    }

    private GenerationJobEntity readJob(long id) {
        return jobMapper.selectById(id);
    }

    private long countEvents(long projectId) {
        return projectEventMapper.selectCount(
                new LambdaQueryWrapper<ProjectEventEntity>()
                        .eq(ProjectEventEntity::getProjectId, projectId));
    }

    private long countLogs(long jobId) {
        return jobLogMapper.selectCount(
                new LambdaQueryWrapper<GenerationJobLogEntity>()
                        .eq(GenerationJobLogEntity::getGenerationJobId, jobId));
    }

    private long countAssets(long jobId) {
        return assetMapper.selectCount(
                new LambdaQueryWrapper<AssetEntity>()
                        .eq(AssetEntity::getGenerationJobId, jobId));
    }

    // ========== 1. claim 两段式 CAS（G03/G07） ==========

    @Nested
    @DisplayName("claim 两段式 CAS")
    class ClaimCasTests {

        @Test
        @DisplayName("G03: 图片 claim CAS 成功 → 投影 fencingToken=old+1，DB 状态 processing")
        void claimImage_success() {
            long id = seedJob(7L, "image", "bottom_dock", "queued", 0L,
                    WorkerClock.now().minusSeconds(10));

            Optional<ClaimedJobDto> result = service.claimImageJobById(
                    String.valueOf(id), "worker-1");

            assertThat(result).isPresent();
            ClaimedJobDto dto = result.get();
            assertThat(dto.fencingToken()).isEqualTo(1L);
            assertThat(dto.id()).isEqualTo(String.valueOf(id));
            assertThat(dto.type()).isEqualTo("image");
            assertThat(dto.retry_count()).isEqualTo(0);
            assertThat(dto.expected_output_count()).isEqualTo(0); // 种子设的 0
            GenerationJobEntity row = readJob(id);
            assertThat(row.getStatus()).isEqualTo("processing");
            assertThat(row.getLeaseOwner()).isEqualTo("worker-1");
            assertThat(row.getFencingToken()).isEqualTo(1L);
            assertThat(row.getLeaseExpiresAt()).isNotNull();
        }

        @Test
        @DisplayName("G07: 并发第二次 claim 同一 job → Optional.empty（CAS 0 行守卫）")
        void claimImage_concurrentSecond_null() {
            long id = seedJob(7L, "image", "bottom_dock", "queued", 0L,
                    WorkerClock.now().minusSeconds(10));

            Optional<ClaimedJobDto> first = service.claimImageJobById(
                    String.valueOf(id), "worker-1");
            Optional<ClaimedJobDto> second = service.claimImageJobById(
                    String.valueOf(id), "worker-2");

            assertThat(first).isPresent();
            assertThat(second).isEmpty();
        }

        @Test
        @DisplayName("错误状态（processing 且未过期）→ 候选查询无命中 → empty")
        void claim_wrongStatus_empty() {
            long id = seedJob(7L, "image", "bottom_dock", "processing", 0L,
                    WorkerClock.now().minusSeconds(10));
            // 设置未过期租约，使其不构成孤儿
            jdbc.update("""
                    UPDATE generation_jobs SET lease_owner='other', lease_expires_at=?
                    WHERE id=?
                    """,
                    WorkerClock.now().plusMinutes(5), id);

            Optional<ClaimedJobDto> result = service.claimImageJobById(
                    String.valueOf(id), "worker-1");

            assertThat(result).isEmpty();
        }

        @Test
        @DisplayName("next_action_at 未来 → 候选过滤排除 → empty")
        void claim_futureNextAction_empty() {
            long id = seedJob(7L, "image", "bottom_dock", "queued", 0L,
                    WorkerClock.now().plusMinutes(5));

            Optional<ClaimedJobDto> result = service.claimImageJobById(
                    String.valueOf(id), "worker-1");

            assertThat(result).isEmpty();
        }

        @Test
        @DisplayName("is_delete=true → 候选过滤排除 → empty")
        void claim_deleted_empty() {
            long id = seedJob(7L, "image", "bottom_dock", "queued", 0L,
                    WorkerClock.now().minusSeconds(10));
            jdbc.update("UPDATE generation_jobs SET is_delete=true WHERE id=?", id);

            Optional<ClaimedJobDto> result = service.claimImageJobById(
                    String.valueOf(id), "worker-1");

            assertThat(result).isEmpty();
        }

        @Test
        @DisplayName("source 不在白名单 → 图片候选排除 → empty（音频无此限制）")
        void claim_imageSourceNotWhitelisted_empty() {
            // source='dock' 不在图片白名单 [bottom_dock, plan_apply, storyboard_preview]
            long id = seedJob(7L, "image", "dock", "queued", 0L,
                    WorkerClock.now().minusSeconds(10));

            assertThat(service.claimImageJobById(String.valueOf(id), "w")).isEmpty();
        }
    }

    // ========== 1b. audio_trim claim 真库路径（IKHPK9） ==========

    /**
     * IKHPK9：audio_trim 的 claim 此前传 {@code List.of()} 给参数化
     * {@code findCandidateByTypeAndSources}，而 MyBatis 对空集合什么都不输出，渲染出
     * {@code ... AND source IN       AND is_delete = false ...} 的坏 SQL——语法错误只在
     * **真执行 SQL** 时暴露，golden mirror（Mockito 桩）永远拦不住，故本组必须跑真库。
     */
    @Nested
    @DisplayName("audio_trim claim 真库路径")
    class AudioTrimClaimTests {

        @Test
        @DisplayName("queued 行 → claim 成功，token+1，DB 转 processing")
        void claimAudioTrim_queued_success() {
            long id = seedJob(7L, "audio_trim", "dock", "queued", 0L,
                    WorkerClock.now().minusSeconds(10));

            Optional<ClaimedAudioTrimJobDto> result = service.claimAudioTrim(
                    String.valueOf(id), "worker-1");

            assertThat(result).isPresent();
            assertThat(result.get().fencingToken()).isEqualTo(1L);
            GenerationJobEntity row = readJob(id);
            assertThat(row.getStatus()).isEqualTo("processing");
            assertThat(row.getLeaseOwner()).isEqualTo("worker-1");
            assertThat(row.getFencingToken()).isEqualTo(1L);
        }

        @Test
        @DisplayName("source 非 dock（无白名单）→ 仍能 claim（锁死不套 source 白名单语义）")
        void claimAudioTrim_anySource_success() {
            long id = seedJob(7L, "audio_trim", "unexpected_source", "queued", 0L,
                    WorkerClock.now().minusSeconds(10));

            Optional<ClaimedAudioTrimJobDto> result = service.claimAudioTrim(
                    String.valueOf(id), "worker-1");

            assertThat(result).isPresent();
            assertThat(readJob(id).getStatus()).isEqualTo("processing");
        }

        @Test
        @DisplayName("processing + lease null → 孤儿接管，token+1")
        void claimAudioTrim_orphanNullLease_success() {
            long id = seedJob(7L, "audio_trim", "dock", "processing", 4L,
                    WorkerClock.now().minusSeconds(10));
            jdbc.update("UPDATE generation_jobs SET lease_owner='old' WHERE id=?", id);

            Optional<ClaimedAudioTrimJobDto> result = service.claimAudioTrim(
                    String.valueOf(id), "worker-new");

            assertThat(result).isPresent();
            assertThat(result.get().fencingToken()).isEqualTo(5L);
        }

        @Test
        @DisplayName("type 不匹配（audio）→ 候选排除 → empty")
        void claimAudioTrim_wrongType_empty() {
            long id = seedJob(7L, "audio", "dock", "queued", 0L,
                    WorkerClock.now().minusSeconds(10));

            assertThat(service.claimAudioTrim(String.valueOf(id), "w")).isEmpty();
        }

        @Test
        @DisplayName("processing + 租约未过期 → 非孤儿 → empty")
        void claimAudioTrim_validLease_empty() {
            long id = seedJob(7L, "audio_trim", "dock", "processing", 0L,
                    WorkerClock.now().minusSeconds(10));
            jdbc.update("""
                    UPDATE generation_jobs SET lease_owner='other', lease_expires_at=?
                    WHERE id=?
                    """,
                    WorkerClock.now().plusMinutes(5), id);

            assertThat(service.claimAudioTrim(String.valueOf(id), "w")).isEmpty();
        }

        @Test
        @DisplayName("processing + 租约已过期 → 孤儿接管，token+1")
        void claimAudioTrim_expiredLease_success() {
            long id = seedJob(7L, "audio_trim", "dock", "processing", 2L,
                    WorkerClock.now().minusSeconds(10));
            jdbc.update("""
                    UPDATE generation_jobs SET lease_owner='stale', lease_expires_at=?
                    WHERE id=?
                    """,
                    WorkerClock.now().minusMinutes(1), id);

            Optional<ClaimedAudioTrimJobDto> result = service.claimAudioTrim(
                    String.valueOf(id), "worker-fresh");

            assertThat(result).isPresent();
            assertThat(result.get().fencingToken()).isEqualTo(3L);
        }

        @Test
        @DisplayName("富投影：providerTaskId / pollCount / progress 如实带回")
        void claimAudioTrim_projection() {
            long id = seedJob(7L, "audio_trim", "dock", "queued", 0L,
                    WorkerClock.now().minusSeconds(10));
            jdbc.update("""
                    UPDATE generation_jobs SET poll_count=7, progress=33,
                      provider_task_id='pt-42', input='{"start_time":"1.5"}'
                    WHERE id=?
                    """, id);

            Optional<ClaimedAudioTrimJobDto> result = service.claimAudioTrim(
                    String.valueOf(id), "worker-1");

            assertThat(result).isPresent();
            ClaimedAudioTrimJobDto dto = result.get();
            assertThat(dto.fencingToken()).isEqualTo(1L);
            assertThat(dto.pollCount()).isEqualTo(7);
            assertThat(dto.progress()).isEqualTo(33);
            assertThat(dto.providerTaskId()).isEqualTo("pt-42");
        }

        @Test
        @DisplayName("next_action_at 未来 → 候选过滤排除 → empty")
        void claimAudioTrim_futureNextAction_empty() {
            long id = seedJob(7L, "audio_trim", "dock", "queued", 0L,
                    WorkerClock.now().plusMinutes(5));

            assertThat(service.claimAudioTrim(String.valueOf(id), "w")).isEmpty();
        }
    }

    // ========== 2. 孤儿接管（G05/G06） ==========

    @Nested
    @DisplayName("孤儿接管")
    class OrphanTakeoverTests {

        @Test
        @DisplayName("G05: video processing + lease_expires_at=null → 孤儿接管，token+1")
        void orphan_video_nullLease() {
            long id = seedJob(9L, "video", "bottom_dock", "processing", 4L,
                    WorkerClock.now().minusSeconds(10));
            // lease_expires_at 留 null（种子默认 null），lease_owner 设为旧 worker
            jdbc.update("UPDATE generation_jobs SET lease_owner='old-worker' WHERE id=?", id);

            Optional<ClaimedVideoJobDto> result = service.claimVideoJobById(
                    String.valueOf(id), "worker-new");

            assertThat(result).isPresent();
            assertThat(result.get().fencingToken()).isEqualTo(5L);
            GenerationJobEntity row = readJob(id);
            assertThat(row.getLeaseOwner()).isEqualTo("worker-new");
            assertThat(row.getFencingToken()).isEqualTo(5L);
        }

        @Test
        @DisplayName("G06: image processing + lease 已过期 → 孤儿接管，token+1")
        void orphan_image_expiredLease() {
            long id = seedJob(9L, "image", "bottom_dock", "processing", 2L,
                    WorkerClock.now().minusSeconds(10));
            jdbc.update("""
                    UPDATE generation_jobs
                    SET lease_owner='stale', lease_expires_at=?
                    WHERE id=?
                    """,
                    WorkerClock.now().minusMinutes(1), id);

            Optional<ClaimedJobDto> result = service.claimImageJobById(
                    String.valueOf(id), "worker-fresh");

            assertThat(result).isPresent();
            assertThat(result.get().fencingToken()).isEqualTo(3L);
        }

        @Test
        @DisplayName("media_extract 孤儿（processing + lease null）→ claimMediaExtract 接管")
        void orphan_mediaExtract() {
            long id = seedJob(9L, "media_extract", "dock", "processing", 0L,
                    WorkerClock.now().minusSeconds(10));
            jdbc.update("UPDATE generation_jobs SET lease_owner='old' WHERE id=?", id);

            Optional<ClaimedMediaExtractJobDto> result = service.claimMediaExtract(
                    String.valueOf(id), "worker-x");

            assertThat(result).isPresent();
            assertThat(result.get().fencingToken()).isEqualTo(1L);
        }
    }

    // ========== 3. fence guard 静默 false（G08/G11/G12） ==========

    @Nested
    @DisplayName("fence guard 静默 false")
    class FenceGuardTests {

        @Test
        @DisplayName("G08: markProviderSubmitted 用 stale token → false，DB 不变")
        void markProviderSubmitted_staleToken_false() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);

            boolean result = service.markProviderSubmitted(
                    String.valueOf(id), "worker-1", 3L /* stale */, "task-1");

            assertThat(result).isFalse();
            GenerationJobEntity row = readJob(id);
            assertThat(row.getLeaseOwner()).isEqualTo("worker-1"); // 未变更
            assertThat(row.getProviderTaskId()).isNull();
        }

        @Test
        @DisplayName("G11: rescheduleProviderPoll 用错误 lease_owner → false")
        void rescheduleProviderPoll_wrongOwner_false() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);

            boolean result = service.rescheduleProviderPoll(
                    String.valueOf(id), "worker-2" /* wrong */, 5L, 42);

            assertThat(result).isFalse();
        }

        @Test
        @DisplayName("createAsset stale token → null，asset 未插入")
        void createAsset_staleToken_null() {
            long id = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 5L);

            String assetId = service.createAsset(new JobStateMachineService.CreateAssetInput(
                    "9", "99", String.valueOf(id), "image",
                    "https://example.com/img.png", "k", "image/png",
                    100L, "0123456789abcdef0123456789abcdef", 100, 100, null,
                    "worker-1", 3L /* stale */));

            assertThat(assetId).isNull();
            assertThat(countAssets(id)).isEqualTo(0);
        }
    }

    // ========== 4. terminal 不可逆（G17/G24/G25 侧面） ==========

    @Nested
    @DisplayName("terminal 不可逆")
    class TerminalNoFlipTests {

        @Test
        @DisplayName("completeJob 在已 succeeded 行 → false（guard 要求 processing）")
        void completeJob_alreadySucceeded_false() {
            long id = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            // 先正常 complete
            service.completeJob(String.valueOf(id), List.of("1001"), "worker-1", 1L);

            // 再次 complete → false
            boolean second = service.completeJob(
                    String.valueOf(id), List.of("1001"), "worker-1", 1L);
            assertThat(second).isFalse();
        }

        @Test
        @DisplayName("failJob 在已 failed 行 → false")
        void failJob_alreadyFailed_false() {
            long id = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            service.failJob(String.valueOf(id), "ERR", "err", null, "worker-1", 1L);

            boolean second = service.failJob(
                    String.valueOf(id), "ERR", "err", null, "worker-1", 1L);
            assertThat(second).isFalse();
        }
    }

    // ========== 5. updateMediaExtractProgress 钳制 + 续租（G18/G19） ==========

    @Nested
    @DisplayName("updateMediaExtractProgress")
    class ProgressTests {

        @Test
        @DisplayName("G18: 150→99 钳制")
        void clamp150to99() {
            long id = seedClaimedJob(9L, "media_extract", "dock", "worker-1", 1L);

            boolean ok = service.updateMediaExtractProgress(
                    new UpdateMediaExtractProgressDto(
                            String.valueOf(id), "worker-1", 1L, 150));

            assertThat(ok).isTrue();
            assertThat(readJob(id).getProgress()).isEqualTo(99);
        }

        @Test
        @DisplayName("G18: -5→0 钳制")
        void clampNeg5to0() {
            long id = seedClaimedJob(9L, "media_extract", "dock", "worker-1", 1L);

            boolean ok = service.updateMediaExtractProgress(
                    new UpdateMediaExtractProgressDto(
                            String.valueOf(id), "worker-1", 1L, -5));

            assertThat(ok).isTrue();
            assertThat(readJob(id).getProgress()).isEqualTo(0);
        }

        @Test
        @DisplayName("G19: 续租 lease_expires_at ≈ now+120s（±10s 容差）")
        void leaseRenewal() {
            long id = seedClaimedJob(9L, "media_extract", "dock", "worker-1", 1L);

            LocalDateTime before = WorkerClock.now();
            service.updateMediaExtractProgress(
                    new UpdateMediaExtractProgressDto(
                            String.valueOf(id), "worker-1", 1L, 50));
            LocalDateTime after = WorkerClock.now();

            GenerationJobEntity row = readJob(id);
            assertThat(row.getProgress()).isEqualTo(50);
            // lease_expires_at ∈ [before+120s − 10s, after+120s + 10s]
            LocalDateTime lower = before.plusSeconds(110);
            LocalDateTime upper = after.plusSeconds(130);
            assertThat(row.getLeaseExpiresAt()).isBetween(lower, upper);
        }
    }

    // ========== 6. completeJob 事务（G17/G24/G39/G40/G41） ==========

    @Nested
    @DisplayName("completeJob 事务")
    class CompleteJobTests {

        @Test
        @DisplayName("G24: happy path → status=succeeded, asset 行, slot 全 succeeded, 事件计数=4")
        void completeJob_allSucceeded() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            long slot0 = seedSlot(jobId, 99L, 0, "pending");
            long slot1 = seedSlot(jobId, 99L, 1, "pending");
            seedStoryboardPreview(jobId, 99L);

            long assetA = 2001L, assetB = 2002L;
            boolean ok = service.completeJob(
                    String.valueOf(jobId),
                    List.of(String.valueOf(assetA), String.valueOf(assetB)),
                    "worker-1", 1L);

            assertThat(ok).isTrue();
            // 1. job 状态
            GenerationJobEntity row = readJob(jobId);
            assertThat(row.getStatus()).isEqualTo("succeeded");
            assertThat(row.getProgress()).isEqualTo(100);
            assertThat(row.getLeaseOwner()).isNull();
            assertThat(row.getLeaseExpiresAt()).isNull();
            assertThat(row.getNextActionAt()).isNull();
            assertThat(row.getOutputAssetIds()).contains("2001").contains("2002");
            // 2. slot
            GenerationOutputSlotEntity s0 = slotMapper.selectById(slot0);
            GenerationOutputSlotEntity s1 = slotMapper.selectById(slot1);
            assertThat(s0.getStatus()).isEqualTo("succeeded");
            assertThat(s0.getAssetId()).isEqualTo(assetA);
            assertThat(s1.getStatus()).isEqualTo("succeeded");
            assertThat(s1.getAssetId()).isEqualTo(assetB);
            // 3. 事件：status_changed + output_attached×2 + storyboard_preview.summary_changed = 4
            assertThat(countEvents(99L)).isEqualTo(4);
        }

        @Test
        @DisplayName("G39: 部分成功 → status=partially_succeeded, slot 分化")
        void completeJob_partial() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            long slot0 = seedSlot(jobId, 99L, 0, "pending");
            long slot1 = seedSlot(jobId, 99L, 1, "pending");

            boolean ok = service.completeJob(
                    String.valueOf(jobId), List.of("3001"), "worker-1", 1L);

            assertThat(ok).isTrue();
            assertThat(readJob(jobId).getStatus()).isEqualTo("partially_succeeded");
            assertThat(slotMapper.selectById(slot0).getStatus()).isEqualTo("succeeded");
            assertThat(slotMapper.selectById(slot0).getAssetId()).isEqualTo(3001L);
            assertThat(slotMapper.selectById(slot1).getStatus()).isEqualTo("failed");
            assertThat(slotMapper.selectById(slot1).getAssetId()).isNull();
            // 事件：status_changed + output_attached + output_updated = 3
            assertThat(countEvents(99L)).isEqualTo(3);
        }

        @Test
        @DisplayName("G41: 全部失败（assetIds 空）→ status=failed, slot 全 failed")
        void completeJob_allFailed() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            long slot0 = seedSlot(jobId, 99L, 0, "pending");
            long slot1 = seedSlot(jobId, 99L, 1, "pending");

            boolean ok = service.completeJob(
                    String.valueOf(jobId), List.of(), "worker-1", 1L);

            assertThat(ok).isTrue();
            assertThat(readJob(jobId).getStatus()).isEqualTo("failed");
            assertThat(slotMapper.selectById(slot0).getStatus()).isEqualTo("failed");
            assertThat(slotMapper.selectById(slot1).getStatus()).isEqualTo("failed");
            // 事件：status_changed + output_updated×2 = 3
            assertThat(countEvents(99L)).isEqualTo(3);
        }

        @Test
        @DisplayName("G17: CAS 守卫未命中（stale token）→ false，0 副作用")
        void completeJob_staleGuard_false() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            seedSlot(jobId, 99L, 0, "pending");

            boolean ok = service.completeJob(
                    String.valueOf(jobId), List.of("4001"), "worker-1", 999L);

            assertThat(ok).isFalse();
            assertThat(readJob(jobId).getStatus()).isEqualTo("processing"); // 未变更
            assertThat(countEvents(99L)).isEqualTo(0);
        }

        @Test
        @DisplayName("project_id=null 时跳过事件（settle-ops.ts:130）")
        void completeJob_noProject_skipEvents() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            jdbc.update("UPDATE generation_jobs SET project_id=NULL WHERE id=?", jobId);

            boolean ok = service.completeJob(
                    String.valueOf(jobId), List.of("5001"), "worker-1", 1L);

            assertThat(ok).isTrue();
            assertThat(countEvents(99L)).isEqualTo(0);
        }
    }

    // ========== 7. failJob（G25） ==========

    @Nested
    @DisplayName("failJob 事务")
    class FailJobTests {

        @Test
        @DisplayName("G25: status=failed, error JSON, pending slot→failed, 1 log, 事件=3")
        void failJob_happy() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            long slot0 = seedSlot(jobId, 99L, 0, "pending");
            long slot1 = seedSlot(jobId, 99L, 1, "pending");

            boolean ok = service.failJob(String.valueOf(jobId),
                    "provider_failed", "上游挂了", null, "worker-1", 1L);

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(jobId);
            assertThat(row.getStatus()).isEqualTo("failed");
            assertThat(row.getError()).contains("provider_failed").contains("上游挂了");
            assertThat(row.getLeaseOwner()).isNull();
            assertThat(row.getNextActionAt()).isNull();
            // slot
            assertThat(slotMapper.selectById(slot0).getStatus()).isEqualTo("failed");
            assertThat(slotMapper.selectById(slot1).getStatus()).isEqualTo("failed");
            // log
            assertThat(countLogs(jobId)).isEqualTo(1);
            // IKFL53：失败日志保留 payload（code/message/details）
            GenerationJobLogEntity failedLog = jobLogMapper.selectList(
                    new LambdaQueryWrapper<GenerationJobLogEntity>()
                            .eq(GenerationJobLogEntity::getGenerationJobId, jobId)).get(0);
            assertThat(failedLog.getPayload()).contains("provider_failed").contains("上游挂了");
            // 事件：status_changed + output_updated×2 = 3
            assertThat(countEvents(99L)).isEqualTo(3);
        }

        @Test
        @DisplayName("failJob stale token → false")
        void failJob_stale() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);

            boolean ok = service.failJob(String.valueOf(jobId),
                    "ERR", "err", null, "worker-1", 999L);

            assertThat(ok).isFalse();
            assertThat(readJob(jobId).getStatus()).isEqualTo("processing");
        }
    }

    // ========== 8. requeueImageJobForRetry（G14/G15） ==========

    @Nested
    @DisplayName("requeueImageJobForRetry")
    class RequeueTests {

        @Test
        @DisplayName("G15: processing→queued, next_action_at 设置, retry_count+1, fencing_token+1")
        void requeue_happy() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            // 秒级对齐 + 预留 ≥1s 余量（MySQL DATETIME 截秒，避免 now+30 恰好落在下一秒造成毫秒进位）
            LocalDateTime next = WorkerClock.now().plusSeconds(29).truncatedTo(ChronoUnit.SECONDS);

            boolean ok = service.requeueImageJobForRetry(String.valueOf(jobId), next);

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(jobId);
            assertThat(row.getStatus()).isEqualTo("queued");
            assertThat(row.getLeaseOwner()).isNull();
            assertThat(row.getLeaseExpiresAt()).isNull();
            assertThat(row.getRetryCount()).isEqualTo(1);
            assertThat(row.getFencingToken()).isEqualTo(2L);
            // next_action_at 与传入值秒级一致（MySQL 截到秒）
            assertThat(row.getNextActionAt()).isEqualTo(next.truncatedTo(ChronoUnit.SECONDS));
        }

        @Test
        @DisplayName("G14: 非 processing（queued）→ false")
        void requeue_notProcessing_false() {
            long jobId = seedJob(9L, "image", "bottom_dock", "queued", 1L,
                    WorkerClock.now().minusSeconds(10));

            boolean ok = service.requeueImageJobForRetry(
                    String.valueOf(jobId),
                    WorkerClock.now().plusSeconds(30));

            assertThat(ok).isFalse();
        }
    }

    // ========== 9. video 路径（G09/G10/G12/G13/G71/G72/G73） ==========

    @Nested
    @DisplayName("视频路径")
    class VideoPathTests {

        @Test
        @DisplayName("G71: markProviderSubmitted → provider='new-api', lease 释放, next≈now+5s")
        void markProviderSubmitted_happy() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);

            LocalDateTime before = WorkerClock.now();
            boolean ok = service.markProviderSubmitted(
                    String.valueOf(id), "worker-1", 5L, "provider-task-1");
            LocalDateTime after = WorkerClock.now();

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(id);
            assertThat(row.getProvider()).isEqualTo("new-api");
            assertThat(row.getProviderTaskId()).isEqualTo("provider-task-1");
            assertThat(row.getProgress()).isEqualTo(1);
            assertThat(row.getLeaseOwner()).isNull();
            assertThat(row.getLeaseExpiresAt()).isNull();
            // next_action_at ≈ now+5s（±10s 容差）
            LocalDateTime lower = before.plusSeconds(5).minusSeconds(2);
            LocalDateTime upper = after.plusSeconds(5).plusSeconds(2);
            assertThat(row.getNextActionAt()).isBetween(lower, upper);
            // G71 pin：fencing_token 不 bump
            assertThat(row.getFencingToken()).isEqualTo(5L);
        }

        @Test
        @DisplayName("G09: rescheduleProviderPoll → poll_count+1, progress 写入, lease 释放")
        void rescheduleProviderPoll_happy() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);
            jdbc.update("UPDATE generation_jobs SET poll_count=3 WHERE id=?", id);

            boolean ok = service.rescheduleProviderPoll(
                    String.valueOf(id), "worker-1", 5L, 42);

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(id);
            assertThat(row.getPollCount()).isEqualTo(4);
            assertThat(row.getProgress()).isEqualTo(42);
            assertThat(row.getLeaseOwner()).isNull();
            // G72 pin：fencing_token 不 bump
            assertThat(row.getFencingToken()).isEqualTo(5L);
        }

        @Test
        @DisplayName("G10: rescheduleProviderPoll 钳制 150→99 与 -5→0")
        void rescheduleProviderPoll_clamp() {
            long id1 = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);
            service.rescheduleProviderPoll(String.valueOf(id1), "worker-1", 5L, 150);
            assertThat(readJob(id1).getProgress()).isEqualTo(99);

            long id2 = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);
            service.rescheduleProviderPoll(String.valueOf(id2), "worker-1", 5L, -5);
            assertThat(readJob(id2).getProgress()).isEqualTo(0);
        }

        @Test
        @DisplayName("G13: cancelVideoBeforeDispatch 已提交（provider_task_id IS NOT NULL）→ false")
        void cancel_afterSubmit_false() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);
            jdbc.update("UPDATE generation_jobs SET provider_task_id='t-1' WHERE id=?", id);

            boolean ok = service.cancelVideoBeforeDispatch(
                    String.valueOf(id), "worker-1", 5L);

            assertThat(ok).isFalse();
            assertThat(readJob(id).getStatus()).isEqualTo("processing"); // 未变更
        }

        @Test
        @DisplayName("G12: cancelVideoBeforeDispatch 未提交 → cancelled, progress=0")
        void cancel_beforeDispatch_ok() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);
            // provider_task_id 默认 null

            boolean ok = service.cancelVideoBeforeDispatch(
                    String.valueOf(id), "worker-1", 5L);

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(id);
            assertThat(row.getStatus()).isEqualTo("cancelled");
            assertThat(row.getProgress()).isEqualTo(0);
            assertThat(row.getLeaseOwner()).isNull();
            // G73：无日志写入
            assertThat(countLogs(id)).isEqualTo(0);
        }

        @Test
        @DisplayName("G12: cancel stale token → false")
        void cancel_stale_false() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);

            boolean ok = service.cancelVideoBeforeDispatch(
                    String.valueOf(id), "worker-1", 999L);

            assertThat(ok).isFalse();
        }

        @Test
        @DisplayName("claimVideoJobById → 投影含 pollCount/progress/providerTaskId")
        void claimVideo_projection() {
            long id = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                    WorkerClock.now().minusSeconds(10));
            jdbc.update("""
                    UPDATE generation_jobs SET poll_count=7, progress=33,
                      provider_task_id='pt-42', input='{"prompt":"hi"}'
                    WHERE id=?
                    """, id);

            Optional<ClaimedVideoJobDto> result = service.claimVideoJobById(
                    String.valueOf(id), "worker-1");

            assertThat(result).isPresent();
            ClaimedVideoJobDto dto = result.get();
            assertThat(dto.fencingToken()).isEqualTo(1L);
            assertThat(dto.pollCount()).isEqualTo(7);
            assertThat(dto.progress()).isEqualTo(33);
            assertThat(dto.providerTaskId()).isEqualTo("pt-42");
        }
    }

    // ========== 10. createAsset（G22/G23） ==========

    @Nested
    @DisplayName("createAsset")
    class CreateAssetTests {

        @Test
        @DisplayName("G22: fence 通过 → asset 行落库，返回 assetId")
        void createAsset_pass() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 5L);

            String assetId = service.createAsset(new JobStateMachineService.CreateAssetInput(
                    "9", "99", String.valueOf(jobId), "image",
                    "https://cdn.example.com/i.png", "gen/user/img.png", "image/png",
                    1234L, "0123456789abcdef0123456789abcdef", 512, 512, null,
                    "worker-1", 5L));

            assertThat(assetId).isNotNull();
            AssetEntity asset = assetMapper.selectById(Long.parseLong(assetId));
            assertThat(asset).isNotNull();
            assertThat(asset.getType()).isEqualTo("image");
            assertThat(asset.getSource()).isEqualTo("generated");
            assertThat(asset.getStatus()).isEqualTo("normal");
            assertThat(asset.getUserId()).isEqualTo(9L);
            assertThat(asset.getProjectId()).isEqualTo(99L);
            assertThat(asset.getGenerationJobId()).isEqualTo(jobId);
            // 事件：asset.created
            assertThat(countEvents(99L)).isEqualTo(1);
        }

        @Test
        @DisplayName("G23: fence 失败 → null，asset 未插入")
        void createAsset_fail() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 5L);

            String assetId = service.createAsset(new JobStateMachineService.CreateAssetInput(
                    "9", "99", String.valueOf(jobId), "image",
                    "https://cdn.example.com/i.png", "k", "image/png",
                    1234L, "0123456789abcdef0123456789abcdef", 512, 512, null,
                    "worker-1", 999L));

            assertThat(assetId).isNull();
            assertThat(countAssets(jobId)).isEqualTo(0);
            assertThat(countEvents(99L)).isEqualTo(0);
        }
    }

    // ========== 11. publishMediaExtractResult / failMediaExtractJob ==========

    @Test
    @DisplayName("audio_mix 真库闭环：领取→保存 task_id→转存后发布自家音频资产和精确时长")
    void audioMixTaskPersistsProviderIdentityAndLongLivedAsset() {
        long jobId = seedJob(9L, "audio_mix", "dock", "queued", 0L,
                WorkerClock.now().minusSeconds(10), 99L,
                "{\"source_node_id\":\"source\",\"output_format\":\"mp3\",\"inputs\":[{\"asset_id\":\"11\",\"node_id\":\"source\",\"url\":\"https://tos/a.mp3\"},{\"asset_id\":\"12\",\"url\":\"https://tos/b.mp3\"}]}");
        var first = service.claimAudioMix(String.valueOf(jobId), "mix-worker");
        assertThat(first).isPresent();
        assertThat(first.get().input().get("source_node_id")).isEqualTo("source");
        assertThat(service.markProviderSubmitted(String.valueOf(jobId), "mix-worker",
                first.get().fencingToken(), "provider-mix-1")).isTrue();
        assertThat(readJob(jobId).getProviderTaskId()).isEqualTo("provider-mix-1");

        jdbc.update("UPDATE generation_jobs SET next_action_at=? WHERE id=?",
                WorkerClock.now().minusSeconds(10), jobId);
        assertThat(jobMapper.listDueAudioMixJobIds(100, 120)).contains(jobId);
        var second = service.claimAudioMix(String.valueOf(jobId), "mix-worker");
        assertThat(second).isPresent();
        assertThat(second.get().providerTaskId()).isEqualTo("provider-mix-1");
        assertThat(service.publishAudioMixResult(new PublishMediaExtractDto(
                String.valueOf(jobId), "99", "9", "mix-worker", second.get().fencingToken(),
                "https://our-tos.example/audio.mp3", "generated/9/audio/out.mp3", "audio/mpeg",
                500L, "0123456789abcdef0123456789abcdef", 12.5))).isTrue();

        assertThat(readJob(jobId).getStatus()).isEqualTo("succeeded");
        assertThat(jdbc.queryForObject("SELECT url FROM assets WHERE generation_job_id=?", String.class, jobId))
                .isEqualTo("https://our-tos.example/audio.mp3");
        assertThat(jdbc.queryForObject("SELECT duration_ms FROM assets WHERE generation_job_id=?", Integer.class, jobId))
                .isEqualTo(12_500);
        assertThat(countAssets(jobId)).isEqualTo(1);
    }

    @Test
    @DisplayName("audio_mix 行为闭环：冻结任务经真实 Worker 和网关协议替身生成可读取长期资产")
    void audioMixWorkerGatewayAndReadableAsset() throws Exception {
        byte[] audio = "ID3-verified-mix-output".getBytes(StandardCharsets.UTF_8);
        var submitted = new AtomicReference<String>();
        var stored = new AtomicReference<byte[]>();
        var base = new AtomicReference<String>();
        HttpServer gateway = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        gateway.createContext("/v1/mediakit/mix-audio", exchange -> {
            submitted.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"success\":true,\"task_id\":\"mix-task-1\",\"request_id\":\"request-1\"}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) { output.write(response); }
        });
        gateway.createContext("/v1/mediakit/tasks/mix-task-1", exchange -> {
            byte[] response = ("{\"status\":\"completed\",\"result\":{\"audio_url\":\""
                    + base.get() + "/temporary/out.mp3\",\"duration\":12.5}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) { output.write(response); }
        });
        gateway.createContext("/temporary/out.mp3", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "audio/mpeg");
            exchange.sendResponseHeaders(200, audio.length);
            try (var output = exchange.getResponseBody()) { output.write(audio); }
        });
        gateway.createContext("/stored/out.mp3", exchange -> {
            byte[] bytes = stored.get();
            if (bytes == null) {
                exchange.sendResponseHeaders(404, -1);
            } else {
                exchange.getResponseHeaders().set("Content-Type", "audio/mpeg");
                exchange.sendResponseHeaders(200, bytes.length);
                try (var output = exchange.getResponseBody()) { output.write(bytes); }
            }
        });
        gateway.start();
        base.set("http://127.0.0.1:" + gateway.getAddress().getPort());
        try {
            long jobId = seedJob(9L, "audio_mix", "dock", "queued", 0L,
                    WorkerClock.now().minusSeconds(10), 99L,
                    "{\"source_node_id\":\"source\",\"output_format\":\"mp3\",\"estimated_duration_ms\":12500,"
                    + "\"provider_credential\":\"sk-frozen\",\"inputs\":["
                    + "{\"asset_id\":\"11\",\"node_id\":\"source\",\"url\":\"https://tos/a.mp3\"},"
                    + "{\"asset_id\":\"12\",\"url\":\"https://tos/b.mp3\"}]}");
            TosAudioMediaRelay relay = mock(TosAudioMediaRelay.class);
            when(relay.persist(anyString(), eq("9"), eq("mp3"))).thenAnswer(invocation -> {
                String temporaryUrl = invocation.getArgument(0);
                stored.set(java.net.URI.create(temporaryUrl).toURL().openStream().readAllBytes());
                return new TosAudioMediaRelay.StoredAudio(base.get() + "/stored/out.mp3",
                        "generated/9/audio/out.mp3", "audio/mpeg", (long) stored.get().length,
                        "0123456789abcdef0123456789abcdef");
            });
            GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
            var processor = new AudioMixJobProcessor(service, new GenerationCredentialService(),
                    new NewApiMediaKitMixAudioClient(base.get()), relay, producer);

            processor.handle(String.valueOf(jobId));
            assertThat(readJob(jobId).getProviderTaskId()).isEqualTo("mix-task-1");
            assertThat(submitted.get()).contains("\"audio_urls\":[\"https://tos/a.mp3\",\"https://tos/b.mp3\"]")
                    .contains("\"format\":\"mp3\"");
            verify(producer).enqueue(String.valueOf(jobId), 5_000L);
            jdbc.update("UPDATE generation_jobs SET next_action_at=? WHERE id=?",
                    WorkerClock.now().minusSeconds(10), jobId);

            processor.handle(String.valueOf(jobId));
            assertThat(readJob(jobId).getStatus()).isEqualTo("succeeded");
            assertThat(countAssets(jobId)).isEqualTo(1);
            String assetUrl = jdbc.queryForObject("SELECT url FROM assets WHERE generation_job_id=?", String.class, jobId);
            assertThat(assetUrl).isEqualTo(base.get() + "/stored/out.mp3")
                    .isNotEqualTo(base.get() + "/temporary/out.mp3");
            assertThat(java.net.URI.create(assetUrl).toURL().openStream().readAllBytes()).isEqualTo(audio);
            assertThat(jdbc.queryForObject("SELECT duration_ms FROM assets WHERE generation_job_id=?", Integer.class, jobId))
                    .isEqualTo(12_500);
        } finally {
            gateway.stop(0);
        }
    }

    @Test
    @DisplayName("audio_mix 真库并发领取：同一 job 仅一个 worker 获得租约")
    void audioMixConcurrentClaimAllowsOneWinner() throws Exception {
        long jobId = seedJob(9L, "audio_mix", "dock", "queued", 0L,
                WorkerClock.now().minusSeconds(10));
        var originalNextActionAt = readJob(jobId).getNextActionAt();
        var candidatesRead = new CountDownLatch(2);
        var seenTokens = new CopyOnWriteArrayList<Long>();
        GenerationJobMapper competingMapper = spy(jobMapper);
        doAnswer(invocation -> {
            var candidate = jobMapper.findCandidateByTypeAndSources(jobId,
                    AudioMixContract.TAG, List.of(AudioMixContract.SOURCE));
            seenTokens.add(candidate.getFencingToken());
            candidatesRead.countDown();
            assertThat(candidatesRead.await(10, TimeUnit.SECONDS)).isTrue();
            return candidate;
        }).when(competingMapper).findCandidateByTypeAndSources(
                eq(jobId), eq(AudioMixContract.TAG), anyList());
        var competingClaims = new JobClaimService(competingMapper);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(() -> competingClaims.claimAudioMix(String.valueOf(jobId), "mix-worker-a"));
            var second = pool.submit(() -> competingClaims.claimAudioMix(String.valueOf(jobId), "mix-worker-b"));
            var claims = List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
            assertThat(seenTokens).containsExactlyInAnyOrder(0L, 0L);
            assertThat(claims.stream().filter(Optional::isPresent).count()).isEqualTo(1);
            assertThat(readJob(jobId).getFencingToken()).isEqualTo(1L);
            assertThat(readJob(jobId).getStatus()).isEqualTo("processing");
            assertThat(readJob(jobId).getNextActionAt()).isEqualTo(originalNextActionAt);
            assertThat(countAssets(jobId)).isZero();
            assertThat(countEvents(99L)).isZero();
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM generation_job_logs WHERE generation_job_id=?",
                    Integer.class, jobId)).isZero();
        }
    }

    @Test
    @DisplayName("audio_mix 真库迟到 token：旧 worker 不能失败或发布新 worker 的任务")
    void audioMixLateFenceCannotOverwriteNewOwner() {
        long jobId = seedJob(9L, "audio_mix", "dock", "queued", 0L,
                WorkerClock.now().minusSeconds(10));
        var first = service.claimAudioMix(String.valueOf(jobId), "mix-worker-a").orElseThrow();
        jdbc.update("UPDATE generation_jobs SET lease_expires_at=?, next_action_at=? WHERE id=?",
                WorkerClock.now().minusSeconds(10), WorkerClock.now().minusSeconds(10), jobId);
        var second = service.claimAudioMix(String.valueOf(jobId), "mix-worker-b").orElseThrow();
        assertThat(second.fencingToken()).isEqualTo(first.fencingToken() + 1);

        assertThat(service.failMediaExtractJob(new FailMediaExtractDto(
                String.valueOf(jobId), "mix-worker-a", first.fencingToken(),
                "audio_mix_failed", "迟到失败", Map.of()))).isFalse();
        assertThat(service.publishAudioMixResult(new PublishMediaExtractDto(
                String.valueOf(jobId), "99", "9", "mix-worker-a", first.fencingToken(),
                "https://our-tos.example/stale.mp3", "generated/9/audio/stale.mp3", "audio/mpeg",
                500L, "0123456789abcdef0123456789abcdef", 12.5))).isFalse();
        assertThat(readJob(jobId).getStatus()).isEqualTo("processing");
        assertThat(countAssets(jobId)).isZero();

        assertThat(service.publishAudioMixResult(new PublishMediaExtractDto(
                String.valueOf(jobId), "99", "9", "mix-worker-b", second.fencingToken(),
                "https://our-tos.example/final.mp3", "generated/9/audio/final.mp3", "audio/mpeg",
                500L, "0123456789abcdef0123456789abcdef", 12.5))).isTrue();
        assertThat(countAssets(jobId)).isEqualTo(1);
        assertThat(readJob(jobId).getStatus()).isEqualTo("succeeded");
    }

    @Nested
    @DisplayName("media_extract 终态")
    class MediaExtractTerminalTests {

        @Test
        @DisplayName("publishMediaExtractResult：job succeeded, asset 落库, 1 log, 2 events")
        void publish_happy() {
            long jobId = seedClaimedJob(9L, "media_extract", "dock", "worker-1", 1L);

            boolean ok = service.publishMediaExtractResult(new PublishMediaExtractDto(
                    String.valueOf(jobId), "99", "9", "worker-1", 1L,
                    "https://cdn/audio.mp3", "gen/audio.mp3", "audio/mpeg",
                    50_000L, "0123456789abcdef0123456789abcdef", 12.5));

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(jobId);
            assertThat(row.getStatus()).isEqualTo("succeeded");
            assertThat(row.getProgress()).isEqualTo(100);
            assertThat(row.getOutputAssetIds()).isNotNull();
            assertThat(countAssets(jobId)).isEqualTo(1);
            assertThat(countLogs(jobId)).isEqualTo(1);
            // 事件：asset.created + generation_job.status_changed = 2
            assertThat(countEvents(99L)).isEqualTo(2);
        }

        @Test
        @DisplayName("failMediaExtractJob：status=failed, error JSON, 1 log, 1 event")
        void failExtract_happy() {
            long jobId = seedClaimedJob(9L, "media_extract", "dock", "worker-1", 1L);

            boolean ok = service.failMediaExtractJob(new FailMediaExtractDto(
                    String.valueOf(jobId), "worker-1", 1L,
                    "video_has_no_audio_track", "视频无音轨", null));

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(jobId);
            assertThat(row.getStatus()).isEqualTo("failed");
            assertThat(row.getError()).contains("video_has_no_audio_track");
            assertThat(countLogs(jobId)).isEqualTo(1);
            // 事件：generation_job.status_changed = 1
            assertThat(countEvents(99L)).isEqualTo(1);
        }
    }
}
