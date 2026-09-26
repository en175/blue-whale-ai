package com.bluewhale.worker.application.service;

import com.bluewhale.worker.application.processor.AudioVideoMuxJobProcessor;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient.MuxAudioVideoTaskObservation;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper;
import com.bluewhale.worker.infrastructure.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.mapper.StoryboardPreviewMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 音视频合成「发布结果不明」清理决策真库交错测试（IKIN8Z）。
 * <p>
 * 夹具仿 {@link JobStateMachineMySqlIntegrationTest}（手动 AnnotationConfigApplicationContext +
 * MySQL Testcontainers + TRUNCATE 隔离）。交错控制方式：处理器跑在独立线程上，用
 * {@code spy(service)} 在发布/探测两个点上挂钩子；「服务端仍在进行的发布事务」用独立
 * JDBC 连接（DriverManager，非池内连接）开启事务、逐字复刻 {@code publishResultGuard}
 * CAS UPDATE + assets 插入后保持未提交——与生产 {@code @Transactional publishSingleAssetResult}
 * 同形（守卫 UPDATE 先持 generation_jobs 行 X 锁，Asset 插入不可见于并发查询）。
 * <p>
 * 钉的行为（验收硬口径）：
 * <ol>
 *   <li>清理首次查询尚未看到 Asset、发布事务随后提交成功 → 不删；提交后 Asset 引用的
 *       对象仍存在，GenerationJob 为正确成功终态，旧执行者不能改写终态（fail 守卫被拒）。</li>
 *   <li>发布事务回滚 → 确认不会再被提交且无 Asset 引用后删除该次未发布对象。</li>
 *   <li>新执行者用另一对象键成功发布 → 旧键按对象键核实后删除、新键保留——GenerationJob
 *       成功不作旧键已发布的判据；旧执行者 fencing 不能写 Asset 或改写终态。</li>
 * </ol>
 * 容器复用（withReuse）下每测试 TRUNCATE + raw 连接 finally 落定（提交/回滚并关闭），防污染。
 */
@Testcontainers(disabledWithoutDocker = true)
@DisplayName("音视频合成发布结果不明的清理决策真库交错测试（MySQL Testcontainers，IKIN8Z）")
class AudioVideoMuxPublishUncertaintyMySqlIntegrationTest {

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
    static JobStateMachineService realService;
    static JdbcTemplate jdbc;

    /** 最小 Spring 上下文：与金标夹具同款（Hikari +08:00 会话、7 Mapper、7-mapper 测试直连 service）。 */
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
        realService = ctx.getBean(JobStateMachineService.class);
        jdbc = new JdbcTemplate(ctx.getBean(DataSource.class));
    }

    @AfterAll
    static void shutdown() {
        if (ctx != null) ctx.close();
    }

    /** 截断所有表，保留结构；每个测试隔离（容器 withReuse 防污染）。 */
    @BeforeEach
    void cleanup() {
        List<String> tables = jdbc.queryForList(
                "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
                String.class, mysql.getDatabaseName());
        jdbc.execute("SET FOREIGN_KEY_CHECKS = 0");
        tables.forEach(t -> jdbc.execute("TRUNCATE TABLE `" + t + "`"));
        jdbc.execute("SET FOREIGN_KEY_CHECKS = 1");
    }

    // ========== 种子与夹具 ==========

    private static final byte[] OLD_KEY_PAYLOAD = "mux-result-payload".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    private static final byte[] NEW_KEY_PAYLOAD = "mux-result-payload-new".getBytes(java.nio.charset.StandardCharsets.UTF_8);

    /** 可领取的 audio_video_mux 冻结任务（provider_task_id 已持久化 → handle 直接进 poll 相）。 */
    private long seedClaimableMuxJob() {
        jdbc.update("""
                INSERT INTO generation_jobs
                  (user_id, project_id, type, source, status, fencing_token, next_action_at,
                   provider_task_id, input, progress, expected_output_count,
                   gmt_create, gmt_modified, version, is_delete)
                VALUES (9, 99, 'audio_video_mux', 'dock', 'queued', 0, ?,
                        'mux-task-1', ?, 0, 1, NOW(), NOW(), 0, false)
                """,
                WorkerClock.now().minusSeconds(30),
                "{\"audio\":{\"assetId\":\"11\",\"nodeId\":\"source-node\",\"url\":\"https://tos/a.mp3\"},"
                        + "\"video\":{\"assetId\":\"12\",\"url\":\"https://tos/v.mp4\"},"
                        + "\"is_audio_reserve\":true,\"sync\":\"none\",\"submit_attempt\":1,"
                        + "\"provider_credential\":\"sk-frozen\"}");
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id != null ? id : -1;
    }

    private GenerationJobEntity readJob(long jobId) {
        return jdbc.queryForObject("SELECT * FROM generation_jobs WHERE id=?",
                (rs, rowNum) -> {
                    GenerationJobEntity job = new GenerationJobEntity();
                    job.setId(rs.getLong("id"));
                    job.setStatus(rs.getString("status"));
                    job.setError(rs.getString("error"));
                    job.setLeaseOwner(rs.getString("lease_owner"));
                    job.setOutputAssetIds(rs.getString("output_asset_ids"));
                    job.setFencingToken(rs.getLong("fencing_token"));
                    return job;
                }, jobId);
    }

    private int countAssets(long jobId, String storageKey) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assets WHERE generation_job_id=? AND storage_key=?",
                Integer.class, jobId, storageKey);
        return count != null ? count : 0;
    }

    /** 有状态 TOS 替身 + 全链处理器：转存落 objects 表，deleteUnpublishedObject 真删。 */
    private record WiredProcessor(
            AudioVideoMuxJobProcessor processor,
            JobStateMachineService spyService,
            ConcurrentHashMap<String, byte[]> objects) {}

    private WiredProcessor wireProcessor(ConcurrentHashMap<String, byte[]> objects, String storageKey) {
        JobStateMachineService spyService = spy(realService);
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        when(gateway.poll("sk-frozen", "mux-task-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, "request-db-1"));
        TosVideoMediaRelay relay = mock(TosVideoMediaRelay.class);
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenAnswer(invocation -> {
                    objects.put(storageKey, OLD_KEY_PAYLOAD);
                    return new TosVideoMediaRelay.StoredVideo(
                            "https://bkt.tos.example.com/" + storageKey, storageKey,
                            "video/mp4", (long) OLD_KEY_PAYLOAD.length, "md5");
                });
        doAnswer(invocation -> {
            objects.remove((String) invocation.getArgument(0));
            return null;
        }).when(relay).deleteUnpublishedObject(anyString());
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        var processor = new AudioVideoMuxJobProcessor(spyService, credentials, gateway, relay, producer);
        return new WiredProcessor(processor, spyService, objects);
    }

    /** 独立 JDBC 连接（非池内）：模拟服务端仍在进行的发布事务（guard CAS + Asset 插入，未提交）。 */
    private Connection openRawConnection() throws Exception {
        Connection raw = DriverManager.getConnection(mysql.getJdbcUrl(), mysql.getUsername(), mysql.getPassword());
        raw.setAutoCommit(false);
        return raw;
    }

    private void executeInFlightPublish(Connection raw, long jobId, String workerId, long token,
                                        String storageKey) throws Exception {
        // 逐字复刻 publishResultGuard（守卫 CAS：第一句即持 generation_jobs 行 X 锁直至提交/回滚）
        try (PreparedStatement guard = raw.prepareStatement("""
                UPDATE generation_jobs
                SET status = 'succeeded', progress = 100, next_action_at = NULL, next_poll_at = NULL,
                    lease_owner = NULL, lease_expires_at = NULL, version = version + 1
                WHERE id = ? AND status = 'processing' AND lease_owner = ? AND fencing_token = ?
                """)) {
            guard.setLong(1, jobId);
            guard.setString(2, workerId);
            guard.setLong(3, token);
            assertThat(guard.executeUpdate()).as("在飞发布事务的守卫 CAS 应命中当前租约").isOne();
        }
        try (PreparedStatement asset = raw.prepareStatement("""
                INSERT INTO assets (user_id, project_id, generation_job_id, type, storage_key, url, mime, size)
                VALUES (9, 99, ?, 'video', ?, ?, 'video/mp4', 100)
                """)) {
            asset.setLong(1, jobId);
            asset.setString(2, storageKey);
            asset.setString(3, "https://bkt.tos.example.com/" + storageKey);
            assertThat(asset.executeUpdate()).isOne();
        }
    }

    // ========== 用例 ==========

    @Test
    @Timeout(90)
    @DisplayName("在飞发布事务于首次探测后提交：对象不删、Asset 引用存在、任务成功终态且旧执行者不能改写")
    void inFlightPublishCommittingAfterFirstProbeKeepsObjectAndBlocksOldExecutor() throws Exception {
        long jobId = seedClaimableMuxJob();
        String oldKey = "generated/9/video/old-exec.mp4";
        ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
        WiredProcessor wired = wireProcessor(objects, oldKey);

        CountDownLatch rawTxOpen = new CountDownLatch(1);
        CountDownLatch firstProbeDone = new CountDownLatch(1);
        CountDownLatch rawTxSettled = new CountDownLatch(1);
        AtomicInteger probes = new AtomicInteger();
        AtomicReference<Connection> rawRef = new AtomicReference<>();

        // 发布调用视角「结果不明」：方法抛异常，但服务端发布事务仍在另一连接上进行
        doAnswer(invocation -> {
            PublishAudioVideoMuxDto dto = invocation.getArgument(0);
            Connection raw = openRawConnection();
            rawRef.set(raw);
            executeInFlightPublish(raw, jobId, dto.workerId(), dto.fencingToken(), oldKey);
            rawTxOpen.countDown();
            throw new RuntimeException("发布事务提交窗口断连（结果不明）");
        }).when(wired.spyService()).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        // 探测钩子：首轮真跑（行锁被在飞事务占用 → in-flight）；后续轮等主线程落定 raw 事务再放行（交错确定化）
        doAnswer(invocation -> {
            if (probes.incrementAndGet() == 1) {
                boolean inFlight = (Boolean) invocation.callRealMethod();
                firstProbeDone.countDown();
                return inFlight;
            }
            assertThat(rawTxSettled.await(20, TimeUnit.SECONDS)).as("主线程应先落定在飞事务").isTrue();
            return (Boolean) invocation.callRealMethod();
        }).when(wired.spyService()).hasInFlightJobWriteTransaction(String.valueOf(jobId));

        ExecutorService single = Executors.newSingleThreadExecutor();
        try {
            var handle = single.submit(() -> wired.processor().handle(String.valueOf(jobId)));
            assertThat(rawTxOpen.await(20, TimeUnit.SECONDS)).as("在飞发布事务应已开启").isTrue();
            assertThat(firstProbeDone.await(20, TimeUnit.SECONDS)).as("首轮探测应已执行").isTrue();
            // 此刻权威查询尚未看到 Asset（在飞事务未提交，REPEATABLE READ 不可见）——正式提交
            assertThat(countAssets(jobId, oldKey)).as("提交前 Asset 行对并发查询不可见").isZero();
            rawRef.get().commit();
            rawTxSettled.countDown();
            handle.get(60, TimeUnit.SECONDS);
        } finally {
            settleQuietly(rawRef.get());
            single.shutdownNow();
        }

        // 对象保留（未被删除）+ 提交后 Asset 引用存在 + GenerationJob 正确成功终态
        assertThat(objects).containsKey(oldKey);
        assertThat(countAssets(jobId, oldKey)).isOne();
        GenerationJobEntity job = readJob(jobId);
        assertThat(job.getStatus()).isEqualTo("succeeded");
        assertThat(job.getLeaseOwner()).isNull();
        // 旧执行者 fencing：发布异常上抛后的 fail 尝试被守卫拒绝，不能改写成功终态
        verify(wired.spyService()).failMediaExtractJob(any());
        assertThat(readJob(jobId).getStatus()).isEqualTo("succeeded");
        assertThat(readJob(jobId).getError()).isNull();
        assertThat(probes.get()).isEqualTo(2);
    }

    @Test
    @Timeout(90)
    @DisplayName("在飞发布事务回滚：确认不会再被提交且无 Asset 引用后删除该次未发布对象")
    void rolledBackPublishTransactionAllowsSafeDelete() throws Exception {
        long jobId = seedClaimableMuxJob();
        String oldKey = "generated/9/video/old-exec.mp4";
        ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
        WiredProcessor wired = wireProcessor(objects, oldKey);

        CountDownLatch rawTxOpen = new CountDownLatch(1);
        CountDownLatch firstProbeDone = new CountDownLatch(1);
        CountDownLatch rawTxSettled = new CountDownLatch(1);
        AtomicInteger probes = new AtomicInteger();
        AtomicReference<Connection> rawRef = new AtomicReference<>();

        doAnswer(invocation -> {
            PublishAudioVideoMuxDto dto = invocation.getArgument(0);
            Connection raw = openRawConnection();
            rawRef.set(raw);
            executeInFlightPublish(raw, jobId, dto.workerId(), dto.fencingToken(), oldKey);
            rawTxOpen.countDown();
            throw new RuntimeException("发布事务提交窗口断连（结果不明）");
        }).when(wired.spyService()).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        doAnswer(invocation -> {
            if (probes.incrementAndGet() == 1) {
                boolean inFlight = (Boolean) invocation.callRealMethod();
                firstProbeDone.countDown();
                return inFlight;
            }
            assertThat(rawTxSettled.await(20, TimeUnit.SECONDS)).as("主线程应先回滚在飞事务").isTrue();
            return (Boolean) invocation.callRealMethod();
        }).when(wired.spyService()).hasInFlightJobWriteTransaction(String.valueOf(jobId));

        ExecutorService single = Executors.newSingleThreadExecutor();
        try {
            var handle = single.submit(() -> wired.processor().handle(String.valueOf(jobId)));
            assertThat(rawTxOpen.await(20, TimeUnit.SECONDS)).isTrue();
            assertThat(firstProbeDone.await(20, TimeUnit.SECONDS)).isTrue();
            rawRef.get().rollback();
            rawTxSettled.countDown();
            handle.get(60, TimeUnit.SECONDS);
        } finally {
            settleQuietly(rawRef.get());
            single.shutdownNow();
        }

        // 事务已结束（回滚）且无 Asset 引用 → 安全删除该次未发布对象
        assertThat(objects).doesNotContainKey(oldKey);
        assertThat(countAssets(jobId, oldKey)).isZero();
        // 租约仍在旧执行者手上：发布异常按既有语义上抛 fail 终态（守卫命中，非 fencing 拒绝）
        GenerationJobEntity job = readJob(jobId);
        assertThat(job.getStatus()).isEqualTo("failed");
        assertThat(job.getError()).contains("audio_video_mux_failed");
        assertThat(probes.get()).isEqualTo(2);
    }

    @Test
    @Timeout(90)
    @DisplayName("接管者用另一对象键发布成功：旧键按对象键核实后删除、新键保留；旧执行者 fencing 不能写 Asset 或改写终态")
    void takeoverPublishingAnotherKeyCleansOnlyOldKeyDespiteJobSuccess() throws Exception {
        long jobId = seedClaimableMuxJob();
        String oldKey = "generated/9/video/old-exec.mp4";
        String newKey = "generated/9/video/new-exec.mp4";
        ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
        WiredProcessor wired = wireProcessor(objects, oldKey);

        AtomicReference<String> oldWorkerId = new AtomicReference<>();
        AtomicReference<Long> oldToken = new AtomicReference<>();

        // 旧执行者发布瞬间被接管：新执行者换租约 + 换对象键发布成功，旧执行者的守卫被拒
        doAnswer(invocation -> {
            PublishAudioVideoMuxDto dto = invocation.getArgument(0);
            oldWorkerId.set(dto.workerId());
            oldToken.set(dto.fencingToken());
            assertThat(dto.storageKey()).isEqualTo(oldKey);
            jdbc.update("UPDATE generation_jobs SET lease_owner='amux-new', fencing_token=fencing_token+1, "
                    + "lease_expires_at=? WHERE id=?", WorkerClock.now().plusMinutes(5), jobId);
            Long newToken = jdbc.queryForObject("SELECT fencing_token FROM generation_jobs WHERE id=?",
                    Long.class, jobId);
            boolean published = realService.publishAudioVideoMuxResult(new PublishAudioVideoMuxDto(
                    String.valueOf(jobId), "99", "9", "amux-new", newToken,
                    "https://bkt.tos.example.com/" + newKey, newKey, "video/mp4",
                    (long) NEW_KEY_PAYLOAD.length, "md5", 227.0, "1920x1080", "12"));
            assertThat(published).as("新执行者用新键发布应成功").isTrue();
            objects.put(newKey, NEW_KEY_PAYLOAD);
            return false;
        }).when(wired.spyService()).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        wired.processor().handle(String.valueOf(jobId));

        // GenerationJob 已成功不充当旧键已发布的判据：按对象键核实——旧键无引用 → 删旧键、新键保留
        assertThat(objects).doesNotContainKey(oldKey);
        assertThat(objects).containsKey(newKey);
        assertThat(countAssets(jobId, newKey)).isOne();
        assertThat(countAssets(jobId, oldKey)).isZero();
        Integer totalAssets = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assets WHERE generation_job_id=?", Integer.class, jobId);
        assertThat(totalAssets).isEqualTo(1);
        GenerationJobEntity job = readJob(jobId);
        assertThat(job.getStatus()).isEqualTo("succeeded");

        // 旧执行者 fencing：迟到 fail（旧 worker/token）被守卫拒绝——不能写 Asset、不能改写成功终态
        assertThat(realService.failMediaExtractJob(new com.bluewhale.worker.domain.dto.FailMediaExtractDto(
                String.valueOf(jobId), oldWorkerId.get(), oldToken.get(),
                "audio_video_mux_failed", "迟到失败", Map.of()))).isFalse();
        assertThat(realService.publishAudioVideoMuxResult(new PublishAudioVideoMuxDto(
                String.valueOf(jobId), "99", "9", oldWorkerId.get(), oldToken.get(),
                "https://bkt.tos.example.com/" + oldKey, oldKey, "video/mp4",
                (long) OLD_KEY_PAYLOAD.length, "md5", 227.0, "1920x1080", "12"))).isFalse();
        assertThat(readJob(jobId).getStatus()).isEqualTo("succeeded");
        assertThat(countAssets(jobId, oldKey)).isZero();
        // 守卫拒绝路径不落失败终态（对象键清理即收口）
        verify(wired.spyService(), never()).failMediaExtractJob(any());
    }

    /** raw 连接兜底落定（容器复用防污染）：未关闭则回滚并关闭。 */
    private static void settleQuietly(Connection raw) {
        if (raw == null) return;
        try {
            if (!raw.isClosed()) {
                raw.rollback();
                raw.close();
            }
        } catch (Exception ignore) {
            // 兜底路径：主断言失败时不因清理噪声掩盖原因
        }
    }
}
