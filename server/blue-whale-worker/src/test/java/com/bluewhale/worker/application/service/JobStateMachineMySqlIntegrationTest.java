package com.bluewhale.worker.application.service;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.contract.AudioMixContract;
import com.bluewhale.worker.domain.contract.AudioTrimContract;
import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.dto.UpdateMediaExtractProgressDto;
import com.bluewhale.worker.application.processor.AudioMixJobProcessor;
import com.bluewhale.worker.application.processor.MediaExtractJobProcessor;
import com.bluewhale.worker.application.processor.VideoJobProcessorFixtures;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutboxMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.StoryboardPreviewMapper;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitExtractAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitExtractAudioClient.ExtractAudioTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoTaskObservation;
import com.bluewhale.worker.infrastructure.mq.BillingEventPublisher;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
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
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.mock.env.MockEnvironment;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.never;

@Testcontainers(disabledWithoutDocker = true)
@DisplayName("JobStateMachine 真库集成测试（MySQL Testcontainers）")
class JobStateMachineMySqlIntegrationTest {


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
    static JobClaimService claimService;
    static JdbcTemplate jdbc;
    static GenerationJobMapper jobMapper;
    static AssetMapper assetMapper;
    static GenerationJobLogMapper jobLogMapper;
    static GenerationOutputSlotMapper slotMapper;
    static GenerationJobExtraMapper extraMapper;
    static GenerationOutboxMapper outboxMapper;

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
        GenerationOutboxMapper outboxMapper(SqlSessionFactory sf) throws Exception {
            return factory(GenerationOutboxMapper.class, sf).getObject();
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
                SceneCardGenerationRecordMapper rm, StoryboardPreviewMapper pm,
                GenerationOutboxMapper om) {
            return new JobFinalizer(jm, am, jlm, sm, em,
                    new SceneCardGenerationRecordSync(sm, rm),
                    new StoryboardPreviewSync(sm, pm),
                    new TerminalEventOutbox(om, jm, BillingEventPublisher.noop(), new MockEnvironment()));
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
        finalizer = ctx.getBean(JobFinalizer.class);
        jobMapper = ctx.getBean(GenerationJobMapper.class);
        extraMapper = ctx.getBean(GenerationJobExtraMapper.class);
        claimService = new JobClaimService(jobMapper, extraMapper);
        jdbc = new JdbcTemplate(ctx.getBean(DataSource.class));
        assetMapper = ctx.getBean(AssetMapper.class);
        jobLogMapper = ctx.getBean(GenerationJobLogMapper.class);
        slotMapper = ctx.getBean(GenerationOutputSlotMapper.class);
        outboxMapper = ctx.getBean(GenerationOutboxMapper.class);
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
                   project_id, input, progress,
                   gmt_create, gmt_modified, version, is_delete)
                VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW(),0,false)
                """,
                userId, type, source, status, fencingToken, nextActionAt,
                projectId, inputJson, 0);
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id != null ? id : -1;
    }

    private long seedClaimedJob(long userId, String type, String source,
                                String workerId, long token) {
        LocalDateTime future = LocalDateTime.now().plusMinutes(10);
        jdbc.update("""
                INSERT INTO generation_jobs
                  (user_id, type, source, status, lease_owner, lease_expires_at,
                   fencing_token, project_id,
                   gmt_create, gmt_modified, version, is_delete)
                VALUES (?,?,?,?,?,?,?,99,NOW(),NOW(),0,false)
                """,
                userId, type, source, "processing", workerId, future, token);
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id != null ? id : -1;
    }

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


    @Nested
    @DisplayName("claim 两段式 CAS")
    class ClaimCasTests {

        @Test
        @DisplayName("G03: 图片 claim CAS 成功 → 投影 fencingToken=old+1，DB 状态 processing")
        void claimImage_success() {
            long id = seedJob(7L, "image", "bottom_dock", "queued", 0L,
                    LocalDateTime.now().minusSeconds(10));

            Optional<ClaimedJobDto> result = service.claimImageJobById(
                    String.valueOf(id), "worker-1");

            assertThat(result).isPresent();
            ClaimedJobDto dto = result.get();
            assertThat(dto.fencingToken()).isEqualTo(1L);
            assertThat(dto.id()).isEqualTo(String.valueOf(id));
            assertThat(dto.type()).isEqualTo("image");
            assertThat(dto.retry_count()).isEqualTo(0);
            assertThat(dto).isEqualTo(new ClaimedJobDto(
                    String.valueOf(id), "99", "7", "image", Map.of(), 0, false, 1L));
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
                    LocalDateTime.now().minusSeconds(10));

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
                    LocalDateTime.now().minusSeconds(10));
            jdbc.update("""
                    UPDATE generation_jobs SET lease_owner='other', lease_expires_at=?
                    WHERE id=?
                    """,
                    LocalDateTime.now().plusMinutes(5), id);

            Optional<ClaimedJobDto> result = service.claimImageJobById(
                    String.valueOf(id), "worker-1");

            assertThat(result).isEmpty();
        }

        @Test
        @DisplayName("★ next_action_at 在未来也照领 —— 消息到了就执行，退避不阻塞消费")
        void claim_futureNextAction_stillClaimed() {
            long id = seedJob(7L, "image", "bottom_dock", "queued", 0L,
                    LocalDateTime.now().plusMinutes(5));

            Optional<ClaimedJobDto> result = service.claimImageJobById(
                    String.valueOf(id), "worker-1");

            assertThat(result).isPresent();
            assertThat(readJob(id).getStatus()).isEqualTo("processing");
        }

        @Test
        @DisplayName("is_delete=true → 候选过滤排除 → empty")
        void claim_deleted_empty() {
            long id = seedJob(7L, "image", "bottom_dock", "queued", 0L,
                    LocalDateTime.now().minusSeconds(10));
            jdbc.update("UPDATE generation_jobs SET is_delete=true WHERE id=?", id);

            Optional<ClaimedJobDto> result = service.claimImageJobById(
                    String.valueOf(id), "worker-1");

            assertThat(result).isEmpty();
        }

        @Test
        @DisplayName("source 不在白名单 → 图片候选排除 → empty（音频无此限制）")
        void claim_imageSourceNotWhitelisted_empty() {
            long id = seedJob(7L, "image", "dock", "queued", 0L,
                    LocalDateTime.now().minusSeconds(10));

            assertThat(service.claimImageJobById(String.valueOf(id), "w")).isEmpty();
        }
    }


    @Nested
    @DisplayName("audio_trim claim 真库路径")
    class AudioTrimClaimTests {

        @Test
        @DisplayName("queued 行 → claim 成功，token+1，DB 转 processing")
        void claimAudioTrim_queued_success() {
            long id = seedJob(7L, "audio_trim", "dock", "queued", 0L,
                    LocalDateTime.now().minusSeconds(10));

            Optional<ClaimedJob> result = claimService.claim(
                    ClaimSpec.typeOnly(AudioTrimContract.TAG, 420, jobMapper),
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
                    LocalDateTime.now().minusSeconds(10));

            Optional<ClaimedJob> result = claimService.claim(
                    ClaimSpec.typeOnly(AudioTrimContract.TAG, 420, jobMapper),
                    String.valueOf(id), "worker-1");

            assertThat(result).isPresent();
            assertThat(readJob(id).getStatus()).isEqualTo("processing");
        }

        @Test
        @DisplayName("processing + lease null → 孤儿接管，token+1")
        void claimAudioTrim_orphanNullLease_success() {
            long id = seedJob(7L, "audio_trim", "dock", "processing", 4L,
                    LocalDateTime.now().minusSeconds(10));
            jdbc.update("UPDATE generation_jobs SET lease_owner='old' WHERE id=?", id);

            Optional<ClaimedJob> result = claimService.claim(
                    ClaimSpec.typeOnly(AudioTrimContract.TAG, 420, jobMapper),
                    String.valueOf(id), "worker-new");

            assertThat(result).isPresent();
            assertThat(result.get().fencingToken()).isEqualTo(5L);
        }

        @Test
        @DisplayName("type 不匹配（audio）→ 候选排除 → empty")
        void claimAudioTrim_wrongType_empty() {
            long id = seedJob(7L, "audio", "dock", "queued", 0L,
                    LocalDateTime.now().minusSeconds(10));

            assertThat(claimService.claim(
                    ClaimSpec.typeOnly(AudioTrimContract.TAG, 420, jobMapper),
                    String.valueOf(id), "w")).isEmpty();
        }

        @Test
        @DisplayName("processing + 租约未过期 → 非孤儿 → empty")
        void claimAudioTrim_validLease_empty() {
            long id = seedJob(7L, "audio_trim", "dock", "processing", 0L,
                    LocalDateTime.now().minusSeconds(10));
            jdbc.update("""
                    UPDATE generation_jobs SET lease_owner='other', lease_expires_at=?
                    WHERE id=?
                    """,
                    LocalDateTime.now().plusMinutes(5), id);

            assertThat(claimService.claim(
                    ClaimSpec.typeOnly(AudioTrimContract.TAG, 420, jobMapper),
                    String.valueOf(id), "w")).isEmpty();
        }

        @Test
        @DisplayName("processing + 租约已过期 → 孤儿接管，token+1")
        void claimAudioTrim_expiredLease_success() {
            long id = seedJob(7L, "audio_trim", "dock", "processing", 2L,
                    LocalDateTime.now().minusSeconds(10));
            jdbc.update("""
                    UPDATE generation_jobs SET lease_owner='stale', lease_expires_at=?
                    WHERE id=?
                    """,
                    LocalDateTime.now().minusMinutes(1), id);

            Optional<ClaimedJob> result = claimService.claim(
                    ClaimSpec.typeOnly(AudioTrimContract.TAG, 420, jobMapper),
                    String.valueOf(id), "worker-fresh");

            assertThat(result).isPresent();
            assertThat(result.get().fencingToken()).isEqualTo(3L);
        }

        @Test
        @DisplayName("富投影：providerTaskId / pollCount / progress 如实带回")
        void claimAudioTrim_projection() {
            long id = seedJob(7L, "audio_trim", "dock", "queued", 0L,
                    LocalDateTime.now().minusSeconds(10));
            jdbc.update("""
                    UPDATE generation_jobs SET poll_count=7, progress=33,
                      provider_task_id='pt-42', input='{"start_time":"1.5"}'
                    WHERE id=?
                    """, id);

            Optional<ClaimedJob> result = claimService.claim(
                    ClaimSpec.typeOnly(AudioTrimContract.TAG, 420, jobMapper),
                    String.valueOf(id), "worker-1");

            assertThat(result).isPresent();
            ClaimedJob dto = result.get();
            assertThat(dto.fencingToken()).isEqualTo(1L);
            assertThat(dto.pollCount()).isEqualTo(7);
            assertThat(dto.progress()).isEqualTo(33);
            assertThat(dto.providerTaskId()).isEqualTo("pt-42");
        }

        @Test
        @DisplayName("★ next_action_at 在未来也照领 —— 消息到了就执行")
        void claimAudioTrim_futureNextAction_stillClaimed() {
            long id = seedJob(7L, "audio_trim", "dock", "queued", 0L,
                    LocalDateTime.now().plusMinutes(5));

            assertThat(claimService.claim(
                    ClaimSpec.typeOnly(AudioTrimContract.TAG, 420, jobMapper),
                    String.valueOf(id), "w")).isPresent();
        }
    }


    @Nested
    @DisplayName("孤儿接管")
    class OrphanTakeoverTests {

        @Test
        @DisplayName("G05: video processing + lease_expires_at=null → 孤儿接管，token+1")
        void orphan_video_nullLease() {
            long id = seedJob(9L, "video", "bottom_dock", "processing", 4L,
                    LocalDateTime.now().minusSeconds(10));
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
                    LocalDateTime.now().minusSeconds(10));
            jdbc.update("""
                    UPDATE generation_jobs
                    SET lease_owner='stale', lease_expires_at=?
                    WHERE id=?
                    """,
                    LocalDateTime.now().minusMinutes(1), id);

            Optional<ClaimedJobDto> result = service.claimImageJobById(
                    String.valueOf(id), "worker-fresh");

            assertThat(result).isPresent();
            assertThat(result.get().fencingToken()).isEqualTo(3L);
        }

        @Test
        @DisplayName("media_extract 孤儿（processing + lease null）→ claim 接管")
        void orphan_mediaExtract() {
            long id = seedJob(9L, "media_extract", "dock", "processing", 0L,
                    LocalDateTime.now().minusSeconds(10));
            jdbc.update("UPDATE generation_jobs SET lease_owner='old' WHERE id=?", id);

            Optional<ClaimedJob> result = claimService.claim(
                    ClaimSpec.typeOnly(MediaExtractContract.TAG, 420, jobMapper,
                            jobMapper::claimMediaExtractCas),
                    String.valueOf(id), "worker-x");

            assertThat(result).isPresent();
            assertThat(result.get().fencingToken()).isEqualTo(1L);
        }
    }


    @Nested
    @DisplayName("fence guard 静默 false")
    class FenceGuardTests {

        @Test
        @DisplayName("G08: markProviderSubmitted 用 stale token → false，DB 不变")
        void markProviderSubmitted_staleToken_false() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);

            boolean result = service.markProviderSubmitted(
                    String.valueOf(id), "worker-1", 3L            , "task-1");

            assertThat(result).isFalse();
            GenerationJobEntity row = readJob(id);
            assertThat(row.getLeaseOwner()).isEqualTo("worker-1");
            assertThat(row.getProviderTaskId()).isNull();
        }

        @Test
        @DisplayName("G11: rescheduleProviderPoll 用错误 lease_owner → false")
        void rescheduleProviderPoll_wrongOwner_false() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);

            boolean result = service.rescheduleProviderPoll(
                    String.valueOf(id), "worker-2"            , 5L, 42);

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
                    "worker-1", 3L            ));

            assertThat(assetId).isNull();
            assertThat(countAssets(id)).isEqualTo(0);
        }
    }


    @Nested
    @DisplayName("terminal 不可逆")
    class TerminalNoFlipTests {

        @Test
        @DisplayName("completeJob 在已 succeeded 行 → false（guard 要求 processing）")
        void completeJob_alreadySucceeded_false() {
            long id = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            finalizer.completeJob(String.valueOf(id), List.of("1001"), "worker-1", 1L);

            boolean second = finalizer.completeJob(
                    String.valueOf(id), List.of("1001"), "worker-1", 1L);
            assertThat(second).isFalse();
        }

        @Test
        @DisplayName("failJob 在已 failed 行 → false")
        void failJob_alreadyFailed_false() {
            long id = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            finalizer.failJob(String.valueOf(id), "ERR", "err", null, "worker-1", 1L);

            boolean second = finalizer.failJob(
                    String.valueOf(id), "ERR", "err", null, "worker-1", 1L);
            assertThat(second).isFalse();
        }
    }


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

            LocalDateTime before = LocalDateTime.now();
            service.updateMediaExtractProgress(
                    new UpdateMediaExtractProgressDto(
                            String.valueOf(id), "worker-1", 1L, 50));
            LocalDateTime after = LocalDateTime.now();

            GenerationJobEntity row = readJob(id);
            assertThat(row.getProgress()).isEqualTo(50);
            LocalDateTime lower = before.plusSeconds(110);
            LocalDateTime upper = after.plusSeconds(130);
            assertThat(row.getLeaseExpiresAt()).isBetween(lower, upper);
        }
    }


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
            boolean ok = finalizer.completeJob(
                    String.valueOf(jobId),
                    List.of(String.valueOf(assetA), String.valueOf(assetB)),
                    "worker-1", 1L);

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(jobId);
            assertThat(row.getStatus()).isEqualTo("succeeded");
            assertThat(row.getProgress()).isEqualTo(100);
            assertThat(row.getLeaseOwner()).isNull();
            assertThat(row.getLeaseExpiresAt()).isNull();
            assertThat(row.getNextActionAt()).isNull();
            assertThat(row.getOutputAssetIds()).contains("2001").contains("2002");
            GenerationOutputSlotEntity s0 = slotMapper.selectById(slot0);
            GenerationOutputSlotEntity s1 = slotMapper.selectById(slot1);
            assertThat(s0.getStatus()).isEqualTo("succeeded");
            assertThat(s0.getAssetId()).isEqualTo(assetA);
            assertThat(s1.getStatus()).isEqualTo("succeeded");
            assertThat(s1.getAssetId()).isEqualTo(assetB);
        }

        @Test
        @DisplayName("G39: 部分成功 → status=partially_succeeded, slot 分化")
        void completeJob_partial() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            long slot0 = seedSlot(jobId, 99L, 0, "pending");
            long slot1 = seedSlot(jobId, 99L, 1, "pending");

            boolean ok = finalizer.completeJob(
                    String.valueOf(jobId), List.of("3001"), "worker-1", 1L);

            assertThat(ok).isTrue();
            assertThat(readJob(jobId).getStatus()).isEqualTo("partially_succeeded");
            assertThat(slotMapper.selectById(slot0).getStatus()).isEqualTo("succeeded");
            assertThat(slotMapper.selectById(slot0).getAssetId()).isEqualTo(3001L);
            assertThat(slotMapper.selectById(slot1).getStatus()).isEqualTo("failed");
            assertThat(slotMapper.selectById(slot1).getAssetId()).isNull();
        }

        @Test
        @DisplayName("G41: 全部失败（assetIds 空）→ status=failed, slot 全 failed")
        void completeJob_allFailed() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            long slot0 = seedSlot(jobId, 99L, 0, "pending");
            long slot1 = seedSlot(jobId, 99L, 1, "pending");

            boolean ok = finalizer.completeJob(
                    String.valueOf(jobId), List.of(), "worker-1", 1L);

            assertThat(ok).isTrue();
            assertThat(readJob(jobId).getStatus()).isEqualTo("failed");
            assertThat(slotMapper.selectById(slot0).getStatus()).isEqualTo("failed");
            assertThat(slotMapper.selectById(slot1).getStatus()).isEqualTo("failed");
        }

        @Test
        @DisplayName("G17: CAS 守卫未命中（stale token）→ false，0 副作用")
        void completeJob_staleGuard_false() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            seedSlot(jobId, 99L, 0, "pending");

            boolean ok = finalizer.completeJob(
                    String.valueOf(jobId), List.of("4001"), "worker-1", 999L);

            assertThat(ok).isFalse();
            assertThat(readJob(jobId).getStatus()).isEqualTo("processing");
        }

        @Test
        @DisplayName("project_id=null 时跳过事件（settle-ops.ts:130）")
        void completeJob_noProject_skipEvents() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            jdbc.update("UPDATE generation_jobs SET project_id=NULL WHERE id=?", jobId);

            boolean ok = finalizer.completeJob(
                    String.valueOf(jobId), List.of("5001"), "worker-1", 1L);

            assertThat(ok).isTrue();
        }
    }


    @Nested
    @DisplayName("failJob 事务")
    class FailJobTests {

        @Test
        @DisplayName("G25: status=failed, error JSON, pending slot→failed, 1 log, 事件=3")
        void failJob_happy() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            long slot0 = seedSlot(jobId, 99L, 0, "pending");
            long slot1 = seedSlot(jobId, 99L, 1, "pending");

            boolean ok = finalizer.failJob(String.valueOf(jobId),
                    "provider_failed", "上游挂了", null, "worker-1", 1L);

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(jobId);
            assertThat(row.getStatus()).isEqualTo("failed");
            assertThat(row.getError()).contains("provider_failed").contains("上游挂了");
            assertThat(row.getLeaseOwner()).isNull();
            assertThat(row.getNextActionAt()).isNull();
            assertThat(slotMapper.selectById(slot0).getStatus()).isEqualTo("failed");
            assertThat(slotMapper.selectById(slot1).getStatus()).isEqualTo("failed");
            assertThat(countLogs(jobId)).isEqualTo(1);
            GenerationJobLogEntity failedLog = jobLogMapper.selectList(
                    new LambdaQueryWrapper<GenerationJobLogEntity>()
                            .eq(GenerationJobLogEntity::getGenerationJobId, jobId)).get(0);
            assertThat(failedLog.getPayload()).contains("provider_failed").contains("上游挂了");
        }

        @Test
        @DisplayName("failJob stale token → false")
        void failJob_stale() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);

            boolean ok = finalizer.failJob(String.valueOf(jobId),
                    "ERR", "err", null, "worker-1", 999L);

            assertThat(ok).isFalse();
            assertThat(readJob(jobId).getStatus()).isEqualTo("processing");
        }
    }


    @Nested
    @DisplayName("requeueImageJobForRetry")
    class RequeueTests {

        @Test
        @DisplayName("G15: processing→queued, next_action_at 设置, retry_count+1, fencing_token+1")
        void requeue_happy() {
            long jobId = seedClaimedJob(9L, "image", "bottom_dock", "worker-1", 1L);
            LocalDateTime next = LocalDateTime.now().plusSeconds(29).truncatedTo(ChronoUnit.SECONDS);

            boolean ok = service.requeueImageJobForRetry(String.valueOf(jobId), next);

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(jobId);
            assertThat(row.getStatus()).isEqualTo("queued");
            assertThat(row.getLeaseOwner()).isNull();
            assertThat(row.getLeaseExpiresAt()).isNull();
            assertThat(row.getRetryCount()).isEqualTo(1);
            assertThat(row.getFencingToken()).isEqualTo(2L);
            assertThat(row.getNextActionAt()).isEqualTo(next.truncatedTo(ChronoUnit.SECONDS));
        }

        @Test
        @DisplayName("G14: 非 processing（queued）→ false")
        void requeue_notProcessing_false() {
            long jobId = seedJob(9L, "image", "bottom_dock", "queued", 1L,
                    LocalDateTime.now().minusSeconds(10));

            boolean ok = service.requeueImageJobForRetry(
                    String.valueOf(jobId),
                    LocalDateTime.now().plusSeconds(30));

            assertThat(ok).isFalse();
        }
    }


    @Nested
    @DisplayName("视频路径")
    class VideoPathTests {

        @Test
        @DisplayName("G71: markProviderSubmitted → provider='new-api', lease 释放, next≈now+5s")
        void markProviderSubmitted_happy() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);

            LocalDateTime before = LocalDateTime.now();
            boolean ok = service.markProviderSubmitted(
                    String.valueOf(id), "worker-1", 5L, "provider-task-1");
            LocalDateTime after = LocalDateTime.now();

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(id);
            assertThat(row.getProvider()).isEqualTo("new-api");
            assertThat(row.getProviderTaskId()).isEqualTo("provider-task-1");
            assertThat(row.getProgress()).isEqualTo(1);
            assertThat(row.getLeaseOwner()).isNull();
            assertThat(row.getLeaseExpiresAt()).isNull();
            LocalDateTime lower = before.plusSeconds(5).minusSeconds(2);
            LocalDateTime upper = after.plusSeconds(5).plusSeconds(2);
            assertThat(row.getNextActionAt()).isBetween(lower, upper);
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
        @DisplayName("G13: cancelJobBeforeDispatch 已提交（provider_task_id IS NOT NULL）→ false")
        void cancel_afterSubmit_false() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);
            jdbc.update("UPDATE generation_jobs SET provider_task_id='t-1' WHERE id=?", id);

            boolean ok = service.cancelJobBeforeDispatch(
                    String.valueOf(id), "worker-1", 5L);

            assertThat(ok).isFalse();
            assertThat(readJob(id).getStatus()).isEqualTo("processing");
        }

        @Test
        @DisplayName("G12: cancelJobBeforeDispatch 未提交 → cancelled, progress=0")
        void cancel_beforeDispatch_ok() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);

            boolean ok = service.cancelJobBeforeDispatch(
                    String.valueOf(id), "worker-1", 5L);

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(id);
            assertThat(row.getStatus()).isEqualTo("cancelled");
            assertThat(row.getProgress()).isEqualTo(0);
            assertThat(row.getLeaseOwner()).isNull();
            assertThat(countLogs(id)).isEqualTo(1);
        }

        @Test
        @DisplayName("G12: cancel stale token → false")
        void cancel_stale_false() {
            long id = seedClaimedJob(9L, "video", "bottom_dock", "worker-1", 5L);

            boolean ok = service.cancelJobBeforeDispatch(
                    String.valueOf(id), "worker-1", 999L);

            assertThat(ok).isFalse();
        }

        @Test
        @DisplayName("claimVideoJobById → 投影含 pollCount/progress/providerTaskId")
        void claimVideo_projection() {
            long id = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                    LocalDateTime.now().minusSeconds(10));
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
        }
    }


    @Test
    @DisplayName("audio_mix 软取消真库行为：提交前及已提交任务均落 cancelled，停止轮询且迟到结果不可发布")
    void audioMixCancellationStopsPollingAndRejectsLateResult() {
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        NewApiMediaKitMixAudioClient gateway = mock(NewApiMediaKitMixAudioClient.class);
        TosAudioMediaRelay relay = mock(TosAudioMediaRelay.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        var processor = new AudioMixJobProcessor(service, claimService, jobMapper, finalizer,
                upstreamCredential, gateway, relay, producer);
        for (String providerTaskId : new String[] { null, "provider-already-submitted" }) {
            long jobId = seedJob(9L, "audio_mix", "dock", "queued", 0L,
                    LocalDateTime.now().minusSeconds(10), 99L, "{}");
            jdbc.update("UPDATE generation_jobs SET cancel_requested_at=NOW(), provider_task_id=? WHERE id=?",
                    providerTaskId, jobId);

            processor.handle(String.valueOf(jobId));

            GenerationJobEntity row = readJob(jobId);
            assertThat(row.getStatus()).isEqualTo("cancelled");
            assertThat(row.getNextActionAt()).isNull();
            assertThat(row.getLeaseOwner()).isNull();
            assertThat(finalizer.publishAudioMixResult(new PublishMediaExtractDto(
                    String.valueOf(jobId), "99", "9", "mix-stale", row.getFencingToken(),
                    "https://late.invalid/out.mp3", "generated/9/audio/late.mp3", "audio/mpeg",
                    10L, "0123456789abcdef0123456789abcdef", 1.0))).isFalse();
            assertThat(countAssets(jobId)).isZero();
        }
        verifyNoInteractions(gateway, relay, producer);
    }

    @Test
    @DisplayName("audio_mix 恢复扫描不按创建时间过滤：创建超过两小时的待处理任务仍是候选")
    void audioMixRecoveryDoesNotLoseLongProcessingJob() {
        long jobId = seedJob(9L, "audio_mix", "dock", "processing", 7L,
                LocalDateTime.now().minusSeconds(10), 99L,
                "{\"source_node_id\":\"source\",\"output_format\":\"mp3\",\"inputs\":[]}");
        jdbc.update("UPDATE generation_jobs SET gmt_create=DATE_SUB(NOW(), INTERVAL 3 HOUR), "
                + "lease_owner=NULL, lease_expires_at=NULL, next_action_at=DATE_SUB(NOW(), INTERVAL 10 SECOND) "
                + "WHERE id=?", jobId);

        assertThat(jobMapper.listDueAudioMixJobIds(100)).contains(jobId);
    }

    @Test
    @DisplayName("重试收割不看创建时间：恢复重投后重新领取父结果，发布一次且不重新提交")
    void retryHarvestHandoffAcrossRecoveryWindow() {
        long parentId = seedJob(9L, "media_extract", "dock", "failed", 1L,
                LocalDateTime.now().minusMinutes(130));
        jdbc.update("UPDATE generation_jobs SET provider_task_id='amk-parent' WHERE id=?", parentId);
        long retryId = seedJob(9L, "media_extract", "dock", "processing", 4L,
                LocalDateTime.now().minusSeconds(10), 99L,
                "{\"source_asset_id\":\"555\",\"output_format\":\"mp3\"}");
        jdbc.update("UPDATE generation_jobs SET retry_of_job_id=?, lease_owner='worker-old', "
                + "lease_expires_at=DATE_ADD(NOW(), INTERVAL 7 MINUTE), "
                + "gmt_create=DATE_SUB(NOW(), INTERVAL 119 MINUTE) WHERE id=?", parentId, retryId);

        assertThat(jobMapper.listDueMediaExtractJobIds(100)).doesNotContain(retryId);
        jdbc.update("UPDATE generation_jobs SET lease_expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=?", retryId);
        assertThat(jobMapper.listDueMediaExtractJobIds(100)).contains(retryId);

        jdbc.update("UPDATE generation_jobs SET gmt_create=DATE_SUB(NOW(), INTERVAL 127 MINUTE) WHERE id=?", retryId);
        assertThat(jobMapper.listDueMediaExtractJobIds(100)).contains(retryId);

        @SuppressWarnings("unchecked")
        ObjectProvider<GenerationMessageProducer> recoveryProvider = mock(ObjectProvider.class);
        GenerationMessageProducer recoveryProducer = mock(GenerationMessageProducer.class);
        when(recoveryProvider.getIfAvailable()).thenReturn(recoveryProducer);
        var recovery = new RecoveryService(jobMapper, finalizer, TerminalEventOutbox.noop(),
                recoveryProvider, recoveryProvider, recoveryProvider, recoveryProvider,
                recoveryProvider, recoveryProvider, recoveryProvider, recoveryProvider,
                recoveryProvider, recoveryProvider, recoveryProvider, recoveryProvider,
                recoveryProvider, recoveryProvider, recoveryProvider, recoveryProvider,
                recoveryProvider, recoveryProvider, 60);
        recovery.recover();
        verify(recoveryProducer).enqueue(String.valueOf(retryId), 1000L);

        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitExtractAudioClient client = mock(NewApiMediaKitExtractAudioClient.class);
        TosAudioMediaRelay relay = mock(TosAudioMediaRelay.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen-token");
        when(client.poll("sk-frozen-token", "amk-parent"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded", "https://volc/old.mp3", 12.5, null, null));
        when(relay.persist("https://volc/old.mp3", "9", "mp3"))
                .thenReturn(new TosAudioMediaRelay.StoredAudio("https://cdn/old.mp3", "gen/old.mp3",
                        "audio/mpeg", 500L, "0123456789abcdef0123456789abcdef"));
        var processor = new MediaExtractJobProcessor(service, claimService, jobMapper, finalizer,
                new AssetSourceService(assetMapper), upstreamCredential, client, relay, producer);

        processor.handle(String.valueOf(retryId));

        assertThat(readJob(retryId).getStatus()).isEqualTo("succeeded");
        assertThat(countAssets(retryId)).isEqualTo(1);
        assertThat(countLogs(retryId)).isEqualTo(1);
        verify(client).poll("sk-frozen-token", "amk-parent");
        verify(client, never()).submit(anyString(), anyString(), anyString());
        verify(producer, never()).enqueue(anyString(), org.mockito.ArgumentMatchers.anyLong());
        assertThat(finalizer.publishMediaExtractResult(
                String.valueOf(retryId), "99", "9", "worker-old", 4L,
                "https://cdn/old.mp3", "gen/old.mp3", "audio/mpeg", 500L,
                "0123456789abcdef0123456789abcdef", 12.5)).isFalse();
        processor.handle(String.valueOf(retryId));
        assertThat(countAssets(retryId)).isEqualTo(1);
        assertThat(countLogs(retryId)).isEqualTo(1);
    }

    @Test
    @DisplayName("★ 协调器候选口径：不看创建时间也不看是否重试，只看是否还活着（排队或失联）")
    void recoveryCandidatesIgnoreAgeAndHarvest() {
        long queued = seedJob(9L, "media_extract", "dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        long stalledRetry = seedJob(9L, "media_extract", "dock", "processing", 1L,
                LocalDateTime.now().minusSeconds(10));
        long stalledNonRetry = seedJob(9L, "media_extract", "dock", "processing", 1L,
                LocalDateTime.now().minusSeconds(10));
        long submitted = seedJob(9L, "media_extract", "dock", "processing", 1L,
                LocalDateTime.now().minusSeconds(10));
        long leased = seedClaimedJob(9L, "media_extract", "dock", "live-worker", 2L);
        long succeeded = seedJob(9L, "media_extract", "dock", "succeeded", 1L,
                LocalDateTime.now().minusSeconds(10));
        long failed = seedJob(9L, "media_extract", "dock", "failed", 1L,
                LocalDateTime.now().minusSeconds(10));
        long parentId = seedJob(9L, "media_extract", "dock", "failed", 1L,
                LocalDateTime.now().minusMinutes(140));
        jdbc.update("UPDATE generation_jobs SET provider_task_id='amk-parent' WHERE id=?", parentId);
        jdbc.update("UPDATE generation_jobs SET provider_task_id='own-task' WHERE id=?", submitted);
        jdbc.update("UPDATE generation_jobs SET retry_of_job_id=?, "
                + "gmt_create=DATE_SUB(NOW(), INTERVAL 200 MINUTE) WHERE id IN (?, ?)",
                parentId, stalledRetry, stalledNonRetry);

        List<Long> due = jobMapper.listDueMediaExtractJobIds(100);

        assertThat(due).contains(queued, stalledRetry, stalledNonRetry, submitted);
        assertThat(due).doesNotContain(leased, succeeded, failed);
    }

    @Test
    @DisplayName("★ 到期扫描：越过执行截止时间的排队/处理中任务是候选，没到点、没设截止、仍在租约期内的不动")
    void expiredJobsAreCollectedByDeadline() {
        long overdue = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        long overdueProcessing = seedJob(9L, "video", "bottom_dock", "processing", 1L,
                LocalDateTime.now().minusSeconds(10));
        long fresh = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        long withoutDeadline = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        long leased = seedClaimedJob(9L, "video", "bottom_dock", "live-worker", 2L);
        jdbc.update("UPDATE generation_jobs SET execution_deadline_at=DATE_SUB(NOW(), INTERVAL 5 SECOND) "
                + "WHERE id IN (?, ?, ?)", overdue, overdueProcessing, leased);
        jdbc.update("UPDATE generation_jobs SET execution_deadline_at=DATE_ADD(NOW(), INTERVAL 1 HOUR) "
                + "WHERE id=?", fresh);

        assertThat(jobMapper.listExpiredJobIds(100))
                .contains(overdue, overdueProcessing)
                .doesNotContain(fresh, withoutDeadline, leased);

        assertThat(finalizer.expireJob(String.valueOf(overdue))).isTrue();
        assertThat(finalizer.expireJob(String.valueOf(leased))).isFalse();
        assertThat(readJob(leased).getStatus()).isEqualTo("processing");
    }

    @Test
    @DisplayName("★ 到期收口：CAS 只命中越期的非终态任务，重复调用不再命中")
    void expireJobGuardIsOneShot() {
        long jobId = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        jdbc.update("UPDATE generation_jobs SET execution_deadline_at=DATE_SUB(NOW(), INTERVAL 5 SECOND) "
                + "WHERE id=?", jobId);

        assertThat(finalizer.expireJob(String.valueOf(jobId))).isTrue();

        GenerationJobEntity row = readJob(jobId);
        assertThat(row.getStatus()).isEqualTo("failed");
        assertThat(row.getNextActionAt()).isNull();
        assertThat(row.getLeaseOwner()).isNull();
        assertThat(finalizer.expireJob(String.valueOf(jobId))).isFalse();
    }

    @Test
    @DisplayName("★ 取消补投扫描：排队中已到点且已请求取消的是候选，处理中、未请求、未到点的不收")
    void cancelPendingJobsAreCollected() {
        long requested = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        long untouched = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        long requestedProcessing = seedJob(9L, "video", "bottom_dock", "processing", 1L,
                LocalDateTime.now().minusSeconds(10));
        long backoff = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                LocalDateTime.now().plusMinutes(5));
        jdbc.update("UPDATE generation_jobs SET cancel_requested_at=NOW() WHERE id IN (?, ?, ?)",
                requested, requestedProcessing, backoff);

        assertThat(jobMapper.listCancelPendingJobs(100))
                .extracting(GenerationJobEntity::getId)
                .contains(requested)
                .doesNotContain(untouched, requestedProcessing, backoff);
    }

    @Test
    @DisplayName("★ 发件箱真库闭环：终态落行→投递置 sent；投递失败保持 pending，恢复后下一轮重发")
    void outboxRoundTrip() {
        List<String[]> published = new CopyOnWriteArrayList<>();
        TerminalEventOutbox wired = new TerminalEventOutbox(outboxMapper, jobMapper,
                (topic, body) -> published.add(new String[]{topic, body}), new MockEnvironment());

        long jobId = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        jdbc.update("UPDATE generation_jobs SET execution_deadline_at=DATE_SUB(NOW(), INTERVAL 5 SECOND) "
                + "WHERE id=?", jobId);
        assertThat(finalizer.expireJob(String.valueOf(jobId))).isTrue();

        wired.drain(100);

        assertThat(published).hasSize(1);
        assertThat(published.get(0)[0]).isEqualTo("generation-job-terminal");
        assertThat(published.get(0)[1]).contains("\"jobId\":" + jobId).contains("\"refund\":true");
        assertThat(sendStateOf(jobId)).isEqualTo("sent");

        long brokenJobId = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        jdbc.update("UPDATE generation_jobs SET execution_deadline_at=DATE_SUB(NOW(), INTERVAL 5 SECOND) "
                + "WHERE id=?", brokenJobId);
        assertThat(finalizer.expireJob(String.valueOf(brokenJobId))).isTrue();

        TerminalEventOutbox broken = new TerminalEventOutbox(outboxMapper, jobMapper,
                (topic, body) -> {
                    throw new IllegalStateException("mq down");
                }, new MockEnvironment());
        broken.drain(100);

        assertThat(sendStateOf(brokenJobId)).isEqualTo("pending");
        assertThat(jdbc.queryForObject("SELECT attempts FROM generation_outbox WHERE job_id=?",
                Integer.class, brokenJobId)).isEqualTo(1);

        wired.drain(100);

        assertThat(sendStateOf(brokenJobId)).isEqualTo("sent");
        assertThat(published).hasSize(2);
    }

    @Test
    @DisplayName("★ 顺延写入：投递后任务被推出扫描窗口；终态任务不写")
    void deferNextRequeuePushesJobOutOfScanWindow() {
        long jobId = seedJob(9L, "image", "bottom_dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        assertThat(jobMapper.listDueImageJobIds(100)).contains(jobId);

        assertThat(jobMapper.deferNextRequeue(jobId, 60)).isEqualTo(1);

        assertThat(jobMapper.listDueImageJobIds(100)).doesNotContain(jobId);
        assertThat(jdbc.queryForObject(
                "SELECT TIMESTAMPDIFF(MINUTE, NOW(), next_action_at) FROM generation_jobs WHERE id=?",
                Integer.class, jobId)).isBetween(58, 60);

        jdbc.update("UPDATE generation_jobs SET status='succeeded' WHERE id=?", jobId);
        assertThat(jobMapper.deferNextRequeue(jobId, 60)).isZero();
    }

    @Test
    @DisplayName("★ 已请求取消的任务不被顺延 —— 否则取消要等最长 60 分钟才生效")
    void deferSkipsCancelRequestedJob() {
        long jobId = seedJob(9L, "image", "bottom_dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        jdbc.update("UPDATE generation_jobs SET cancel_requested_at=NOW() WHERE id=?", jobId);

        assertThat(jobMapper.deferNextRequeue(jobId, 60)).isZero();

        assertThat(jobMapper.listCancelPendingJobs(100))
                .extracting(GenerationJobEntity::getId)
                .contains(jobId);
    }

    private String sendStateOf(long jobId) {
        return jdbc.queryForObject("SELECT send_state FROM generation_outbox WHERE job_id=?",
                String.class, jobId);
    }

    @Test
    @DisplayName("视频重试收割跨窗接手：旧领取迟到发布被 publishVideoGuard 拒绝，新 Worker 收割发布一次且不重新提交")
    void videoRetryHarvestHandoffAcrossRecoveryWindow() {
        long parentId = seedJob(9L, "video", "bottom_dock", "failed", 1L,
                LocalDateTime.now().minusMinutes(130));
        jdbc.update("UPDATE generation_jobs SET provider_task_id='video-parent-task' WHERE id=?", parentId);
        long retryId = seedJob(9L, "video", "bottom_dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10), 99L,
                "{\"prompt\":\"一只猫在跑步\","
                        + "\"model_id\":\"seedance-2\",\"duration\":5.0,"
                        + "\"resolution\":\"720p\",\"aspect_ratio\":\"16:9\","
                        + "\"output_width\":1280,\"output_height\":720}");
        jdbc.update("UPDATE generation_jobs SET retry_of_job_id=?, "
                + "gmt_create=DATE_SUB(NOW(), INTERVAL 119 MINUTE) WHERE id=?", parentId, retryId);
        String retry = String.valueOf(retryId);
        var spiedService = spy(service);
        var spiedFinalizer = spy(finalizer);

        var staleClaim = spiedService.claimVideoJobById(retry, "video-worker-old");
        assertThat(staleClaim).isPresent();
        assertThat(staleClaim.get().fencingToken()).isEqualTo(1L);
        assertThat(staleClaim.get().workerId()).isEqualTo("video-worker-old");
        assertThat(staleClaim.get().parentProviderTaskId()).isEqualTo("video-parent-task");

        assertThat(jobMapper.listDueVideoJobIds(100)).doesNotContain(retryId);
        jdbc.update("UPDATE generation_jobs SET lease_expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=?",
                retryId);
        assertThat(jobMapper.listDueVideoJobIds(100)).contains(retryId);

        @SuppressWarnings("unchecked")
        ObjectProvider<GenerationMessageProducer> recoveryProvider = mock(ObjectProvider.class);
        GenerationMessageProducer recoveryProducer = mock(GenerationMessageProducer.class);
        when(recoveryProvider.getIfAvailable()).thenReturn(recoveryProducer);
        var recovery = new RecoveryService(jobMapper, finalizer, TerminalEventOutbox.noop(),
                recoveryProvider, recoveryProvider, recoveryProvider, recoveryProvider,
                recoveryProvider, recoveryProvider, recoveryProvider, recoveryProvider,
                recoveryProvider, recoveryProvider, recoveryProvider, recoveryProvider,
                recoveryProvider, recoveryProvider, recoveryProvider, recoveryProvider,
                recoveryProvider, recoveryProvider, 60);
        recovery.recover();
        verify(recoveryProducer).enqueue(retry, 1000L);

        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiVideoClient client = mock(NewApiVideoClient.class);
        TosVideoMediaRelay relay = mock(TosVideoMediaRelay.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen-token");
        when(client.poll("sk-frozen-token", "video-parent-task"))
                .thenReturn(new VideoTaskObservation("succeeded", 100, "http://parent-video.mp4", null, null, null));
        when(relay.persist("http://parent-video.mp4", "9"))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("http://cdn/video.mp4", "gen/video.mp4",
                        "video/mp4", 500L, "0123456789abcdef0123456789abcdef"));
        var newProcessor = VideoJobProcessorFixtures.withWorkerId(
                spiedService, spiedFinalizer, new AssetSourceService(assetMapper),
                upstreamCredential, client, relay, producer, "video-worker-new");

        newProcessor.handle(retry);

        assertThat(readJob(retryId).getStatus()).isEqualTo("succeeded");
        assertThat(readJob(retryId).getFencingToken()).isEqualTo(2L);
        assertThat(jdbc.queryForObject("SELECT url FROM user_assets WHERE generation_job_id=?",
                String.class, retryId)).isEqualTo("http://cdn/video.mp4");
        assertThat(countAssets(retryId)).isEqualTo(1);
        assertThat(countLogs(retryId)).isEqualTo(1);

        assertThat(spiedFinalizer.publishVideoResult(retry, "99", "9",
                "video-worker-old", 1L,
                "http://cdn/video.mp4", "gen/video.mp4", "video/mp4", 500L,
                "0123456789abcdef0123456789abcdef", 1280, 720, 5.0)).isFalse();
        assertThat(readJob(retryId).getStatus()).isEqualTo("succeeded");
        assertThat(countAssets(retryId)).isEqualTo(1);
        assertThat(countLogs(retryId)).isEqualTo(1);

        verify(client, never()).submit(anyString(), any());
        verify(client).poll("sk-frozen-token", "video-parent-task");
        verify(producer, never()).enqueue(anyString(), anyLong());

        var handoff = inOrder(spiedService, spiedFinalizer);
        handoff.verify(spiedService).claimVideoJobById(retry, "video-worker-old");
        handoff.verify(spiedService).claimVideoJobById(retry, "video-worker-new");
        handoff.verify(spiedFinalizer).publishVideoResult(eq(retry), eq("99"), eq("9"),
                eq("video-worker-new"), eq(2L), anyString(), anyString(), anyString(), any(),
                anyString(), anyInt(), anyInt(), anyDouble(), any(), any());
        handoff.verify(spiedFinalizer).publishVideoResult(eq(retry), eq("99"), eq("9"),
                eq("video-worker-old"), eq(1L), anyString(), anyString(), anyString(), any(),
                anyString(), anyInt(), anyInt(), anyDouble(), any(), any());
    }

    @Test
    @DisplayName("audio_mix 退避期间恢复扫描不提前重投，DB 与 MQ 使用同一延迟")
    void audioMixRecoveryRespectsPersistedPollBackoff() {
        long jobId = seedClaimedJob(9L, "audio_mix", "dock", "mix-worker", 5L);
        LocalDateTime before = LocalDateTime.now();
        assertThat(service.rescheduleProviderPoll(String.valueOf(jobId), "mix-worker", 5L, 0, 40_000L)).isTrue();
        LocalDateTime after = LocalDateTime.now();

        GenerationJobEntity row = readJob(jobId);
        assertThat(row.getNextActionAt()).isBetween(before.plusSeconds(38), after.plusSeconds(42));
        assertThat(jdbc.queryForList(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'generation_jobs' "
                        + "AND COLUMN_NAME = 'next_poll_at'", String.class)).isEmpty();
        assertThat(jobMapper.listDueAudioMixJobIds(100)).doesNotContain(jobId);
        jdbc.update("UPDATE generation_jobs SET next_action_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=?", jobId);
        assertThat(jobMapper.listDueAudioMixJobIds(100)).contains(jobId);
    }

    @Test
    @DisplayName("audio_mix 续租只允许当前 fencing 持有者且不复活已过期租约")
    void audioMixTransferLeaseIsFenced() {
        long jobId = seedClaimedJob(9L, "audio_mix", "dock", "mix-worker", 5L);
        jdbc.update("UPDATE generation_jobs SET lease_expires_at=DATE_ADD(NOW(), INTERVAL 10 SECOND) WHERE id=?", jobId);

        assertThat(service.renewAudioMixLease(String.valueOf(jobId), "mix-worker", 5L)).isTrue();
        assertThat(jdbc.queryForObject("SELECT TIMESTAMPDIFF(SECOND, NOW(), lease_expires_at) "
                + "FROM generation_jobs WHERE id=?", Integer.class, jobId)).isGreaterThan(400);
        assertThat(service.renewAudioMixLease(String.valueOf(jobId), "mix-worker", 4L)).isFalse();
        jdbc.update("UPDATE generation_jobs SET lease_expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=?", jobId);
        assertThat(service.renewAudioMixLease(String.valueOf(jobId), "mix-worker", 5L)).isFalse();
    }

    @Test
    @DisplayName("收割 reserve 以 owner+fence 定执行权：过期租约放行复活，旧候选快照不能接管")
    void parentReuseSubmitReservationBlocksStaleCandidateClaim() {
        long jobId = seedClaimedJob(9L, "video_matting", "dock", "old-worker", 5L);
        jdbc.update("UPDATE generation_jobs SET lease_expires_at=DATE_ADD(NOW(), INTERVAL 1 SECOND) WHERE id=?", jobId);

        assertThat(service.reserveParentReuseSubmit(String.valueOf(jobId), "old-worker", 5L)).isTrue();
        assertThat(jdbc.queryForObject("SELECT TIMESTAMPDIFF(SECOND, NOW(), lease_expires_at) "
                + "FROM generation_jobs WHERE id=?", Integer.class, jobId)).isGreaterThan(400);

        assertThat(jobMapper.claimImageCas(jobId, "new-worker", LocalDateTime.now().plusSeconds(420),
                5L, "processing")).isZero();
        assertThat(readJob(jobId).getLeaseOwner()).isEqualTo("old-worker");

        assertThat(service.reserveParentReuseSubmit(String.valueOf(jobId), "new-worker", 5L)).isFalse();

        jdbc.update("UPDATE generation_jobs SET lease_expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=?", jobId);
        assertThat(service.reserveParentReuseSubmit(String.valueOf(jobId), "old-worker", 5L)).isTrue();
        assertThat(jdbc.queryForObject("SELECT TIMESTAMPDIFF(SECOND, NOW(), lease_expires_at) "
                + "FROM generation_jobs WHERE id=?", Integer.class, jobId)).isGreaterThan(400);
        assertThat(jobMapper.claimImageCas(jobId, "new-worker", LocalDateTime.now().plusSeconds(420),
                5L, "processing")).isZero();
        assertThat(readJob(jobId).getLeaseOwner()).isEqualTo("old-worker");
    }

    @Test
    @DisplayName("收割慢转存耗尽租约后仍能收口：reserve 放行回退提交，已提交的任务不再被 reserve 接管")
    void parentReuseSlowTransferRecoversAfterLeaseExhaustion() {
        long parentId = seedJob(9L, "video", "bottom_dock", "processing", 0L,
                LocalDateTime.now().minusMinutes(200));
        jdbc.update("UPDATE generation_jobs SET provider_task_id='provider-parent-1' WHERE id=?", parentId);
        long jobId = seedClaimedJob(9L, "video_matting", "video_matting", "harvest-worker", 7L);
        jdbc.update("""
                UPDATE generation_jobs SET retry_of_job_id=?, provider_task_id=NULL,
                  gmt_create=DATE_SUB(NOW(), INTERVAL 200 MINUTE),
                  lease_expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND),
                  next_action_at=DATE_SUB(NOW(), INTERVAL 1 SECOND)
                WHERE id=?
                """, parentId, jobId);

        assertThat(jobMapper.listDueVideoMattingJobIds(100)).contains(jobId);

        assertThat(service.reserveParentReuseSubmit(String.valueOf(jobId), "harvest-worker", 7L)).isTrue();
        assertThat(service.markProviderSubmitted(String.valueOf(jobId), "harvest-worker", 7L,
                "provider-retry-1")).isTrue();
        assertThat(readJob(jobId).getProviderTaskId()).isEqualTo("provider-retry-1");
        assertThat(readJob(jobId).getLeaseOwner()).isNull();

        assertThat(service.reserveParentReuseSubmit(String.valueOf(jobId), "harvest-worker", 7L)).isFalse();

        jdbc.update("UPDATE generation_jobs SET next_action_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=?", jobId);
        assertThat(jobMapper.listDueVideoMattingJobIds(100)).contains(jobId);
    }

    @Test
    @DisplayName("media_extract 旧候选快照不能接管已续租任务；孤儿租约过期仍可接管")
    void mediaExtractStaleCandidateCannotTakeOverRenewedLease() {
        long renewedId = seedJob(9L, "media_extract", "dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        var claimed = claimService.claim(
                ClaimSpec.typeOnly(MediaExtractContract.TAG, 420, jobMapper,
                        jobMapper::claimMediaExtractCas),
                String.valueOf(renewedId), "worker-old");
        assertThat(claimed).isPresent();
        jdbc.update("UPDATE generation_jobs SET lease_expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=?",
                renewedId);
        GenerationJobEntity stale = jobMapper.findCandidateByTypeOnly(renewedId, "media_extract");
        assertThat(stale).isNotNull();
        assertThat(service.reserveParentReuseSubmit(String.valueOf(renewedId), "worker-old",
                stale.getFencingToken())).isTrue();
        assertThat(jobMapper.claimMediaExtractCas(renewedId, "new-worker",
                LocalDateTime.now().plusSeconds(420),
                stale.getFencingToken(), stale.getStatus())).isZero();
        assertThat(readJob(renewedId).getLeaseOwner()).isEqualTo("worker-old");

        long orphanId = seedJob(9L, "media_extract", "dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        assertThat(claimService.claim(
                ClaimSpec.typeOnly(MediaExtractContract.TAG, 420, jobMapper,
                        jobMapper::claimMediaExtractCas),
                String.valueOf(orphanId), "worker-old")).isPresent();
        jdbc.update("UPDATE generation_jobs SET lease_expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=?",
                orphanId);
        GenerationJobEntity orphanSnap = jobMapper.findCandidateByTypeOnly(orphanId, "media_extract");
        assertThat(orphanSnap).isNotNull();
        assertThat(jobMapper.claimMediaExtractCas(orphanId, "new-worker",
                LocalDateTime.now().plusSeconds(420),
                orphanSnap.getFencingToken(), orphanSnap.getStatus())).isOne();
        assertThat(readJob(orphanId).getLeaseOwner()).isEqualTo("new-worker");
    }

    @Test
    @DisplayName("audio_mix 真库闭环：领取→保存 task_id→转存后发布自家音频资产和精确时长")
    void audioMixTaskPersistsProviderIdentityAndLongLivedAsset() {
        long jobId = seedJob(9L, "audio_mix", "dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10), 99L,
                "{\"source_node_id\":\"source\",\"output_format\":\"mp3\",\"inputs\":[{\"asset_id\":\"11\",\"node_id\":\"source\",\"url\":\"https://tos/a.mp3\"},{\"asset_id\":\"12\",\"url\":\"https://tos/b.mp3\"}]}");
        var first = claimService.claim(
                ClaimSpec.bySources(AudioMixContract.TAG, 420, List.of(AudioMixContract.SOURCE), jobMapper),
                String.valueOf(jobId), "mix-worker");
        assertThat(first).isPresent();
        assertThat(first.get().input().get("source_node_id")).isEqualTo("source");
        assertThat(service.markProviderSubmitted(String.valueOf(jobId), "mix-worker",
                first.get().fencingToken(), "provider-mix-1")).isTrue();
        assertThat(readJob(jobId).getProviderTaskId()).isEqualTo("provider-mix-1");

        jdbc.update("UPDATE generation_jobs SET next_action_at=? WHERE id=?",
                LocalDateTime.now().minusSeconds(10), jobId);
        assertThat(jobMapper.listDueAudioMixJobIds(100)).contains(jobId);
        var second = claimService.claim(
                ClaimSpec.bySources(AudioMixContract.TAG, 420, List.of(AudioMixContract.SOURCE), jobMapper),
                String.valueOf(jobId), "mix-worker");
        assertThat(second).isPresent();
        assertThat(second.get().providerTaskId()).isEqualTo("provider-mix-1");
        assertThat(finalizer.publishAudioMixResult(new PublishMediaExtractDto(
                String.valueOf(jobId), "99", "9", "mix-worker", second.get().fencingToken(),
                "https://our-tos.example/audio.mp3", "generated/9/audio/out.mp3", "audio/mpeg",
                500L, "0123456789abcdef0123456789abcdef", 12.5))).isTrue();

        assertThat(readJob(jobId).getStatus()).isEqualTo("succeeded");
        assertThat(jdbc.queryForObject("SELECT url FROM user_assets WHERE generation_job_id=?", String.class, jobId))
                .isEqualTo("https://our-tos.example/audio.mp3");
        assertThat(jdbc.queryForObject("SELECT duration_ms FROM user_assets WHERE generation_job_id=?", Integer.class, jobId))
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
                    LocalDateTime.now().minusSeconds(10), 99L,
                    "{\"source_node_id\":\"source\",\"output_format\":\"mp3\",\"estimated_duration_ms\":12500,"
                    + "\"inputs\":["
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
            UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
            when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
            var processor = new AudioMixJobProcessor(service, claimService, jobMapper, finalizer,
                    upstreamCredential,
                    new NewApiMediaKitMixAudioClient(new UpstreamBaseUrl(base.get())), relay, producer);

            processor.handle(String.valueOf(jobId));
            assertThat(readJob(jobId).getProviderTaskId()).isEqualTo("mix-task-1");
            assertThat(submitted.get()).contains("\"audio_urls\":[\"https://tos/a.mp3\",\"https://tos/b.mp3\"]")
                    .contains("\"format\":\"mp3\"");
            verify(producer).enqueue(String.valueOf(jobId), 5_000L);
            jdbc.update("UPDATE generation_jobs SET next_action_at=? WHERE id=?",
                    LocalDateTime.now().minusSeconds(10), jobId);

            processor.handle(String.valueOf(jobId));
            assertThat(readJob(jobId).getStatus()).isEqualTo("succeeded");
            assertThat(countAssets(jobId)).isEqualTo(1);
            String assetUrl = jdbc.queryForObject("SELECT url FROM user_assets WHERE generation_job_id=?", String.class, jobId);
            assertThat(assetUrl).isEqualTo(base.get() + "/stored/out.mp3")
                    .isNotEqualTo(base.get() + "/temporary/out.mp3");
            assertThat(java.net.URI.create(assetUrl).toURL().openStream().readAllBytes()).isEqualTo(audio);
            assertThat(jdbc.queryForObject("SELECT duration_ms FROM user_assets WHERE generation_job_id=?", Integer.class, jobId))
                    .isEqualTo(12_500);
        } finally {
            gateway.stop(0);
        }
    }

    @Test
    @DisplayName("audio_mix 真库并发领取：同一 job 仅一个 worker 获得租约")
    void audioMixConcurrentClaimAllowsOneWinner() throws Exception {
        long jobId = seedJob(9L, "audio_mix", "dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
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
        var competingClaims = new JobClaimService(competingMapper, extraMapper);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(() -> competingClaims.claim(
                    ClaimSpec.bySources(AudioMixContract.TAG, 420,
                            List.of(AudioMixContract.SOURCE), competingMapper),
                    String.valueOf(jobId), "mix-worker-a"));
            var second = pool.submit(() -> competingClaims.claim(
                    ClaimSpec.bySources(AudioMixContract.TAG, 420,
                            List.of(AudioMixContract.SOURCE), competingMapper),
                    String.valueOf(jobId), "mix-worker-b"));
            var claims = List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
            assertThat(seenTokens).containsExactlyInAnyOrder(0L, 0L);
            assertThat(claims.stream().filter(Optional::isPresent).count()).isEqualTo(1);
            assertThat(readJob(jobId).getFencingToken()).isEqualTo(1L);
            assertThat(readJob(jobId).getStatus()).isEqualTo("processing");
            assertThat(readJob(jobId).getNextActionAt()).isEqualTo(originalNextActionAt);
            assertThat(countAssets(jobId)).isZero();
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM generation_job_logs WHERE generation_job_id=?",
                    Integer.class, jobId)).isZero();
        }
    }

    @Test
    @DisplayName("audio_mix 真库迟到 token：旧 worker 不能失败或发布新 worker 的任务")
    void audioMixLateFenceCannotOverwriteNewOwner() {
        long jobId = seedJob(9L, "audio_mix", "dock", "queued", 0L,
                LocalDateTime.now().minusSeconds(10));
        var first = claimService.claim(
                ClaimSpec.bySources(AudioMixContract.TAG, 420, List.of(AudioMixContract.SOURCE), jobMapper),
                String.valueOf(jobId), "mix-worker-a").orElseThrow();
        jdbc.update("UPDATE generation_jobs SET lease_expires_at=?, next_action_at=? WHERE id=?",
                LocalDateTime.now().minusSeconds(10), LocalDateTime.now().minusSeconds(10), jobId);
        var second = claimService.claim(
                ClaimSpec.bySources(AudioMixContract.TAG, 420, List.of(AudioMixContract.SOURCE), jobMapper),
                String.valueOf(jobId), "mix-worker-b").orElseThrow();
        assertThat(second.fencingToken()).isEqualTo(first.fencingToken() + 1);

        assertThat(finalizer.failMediaExtractJob(
                String.valueOf(jobId), "audio_mix_failed", "迟到失败", Map.of(),
                "mix-worker-a", first.fencingToken())).isFalse();
        assertThat(finalizer.publishAudioMixResult(new PublishMediaExtractDto(
                String.valueOf(jobId), "99", "9", "mix-worker-a", first.fencingToken(),
                "https://our-tos.example/stale.mp3", "generated/9/audio/stale.mp3", "audio/mpeg",
                500L, "0123456789abcdef0123456789abcdef", 12.5))).isFalse();
        assertThat(readJob(jobId).getStatus()).isEqualTo("processing");
        assertThat(countAssets(jobId)).isZero();

        assertThat(finalizer.publishAudioMixResult(new PublishMediaExtractDto(
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

            boolean ok = finalizer.publishMediaExtractResult(
                    String.valueOf(jobId), "99", "9", "worker-1", 1L,
                    "https://cdn/audio.mp3", "gen/audio.mp3", "audio/mpeg",
                    50_000L, "0123456789abcdef0123456789abcdef", 12.5);

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(jobId);
            assertThat(row.getStatus()).isEqualTo("succeeded");
            assertThat(row.getProgress()).isEqualTo(100);
            assertThat(row.getOutputAssetIds()).isNotNull();
            assertThat(countAssets(jobId)).isEqualTo(1);
            assertThat(countLogs(jobId)).isEqualTo(1);
        }

        @Test
        @DisplayName("failMediaExtractJob：status=failed, error JSON, 1 log, 1 event")
        void failExtract_happy() {
            long jobId = seedClaimedJob(9L, "media_extract", "dock", "worker-1", 1L);

            boolean ok = finalizer.failMediaExtractJob(
                    String.valueOf(jobId), "video_has_no_audio_track", "视频无音轨", null,
                    "worker-1", 1L);

            assertThat(ok).isTrue();
            GenerationJobEntity row = readJob(jobId);
            assertThat(row.getStatus()).isEqualTo("failed");
            assertThat(row.getError()).contains("video_has_no_audio_track");
            assertThat(countLogs(jobId)).isEqualTo(1);
        }
    }
}
