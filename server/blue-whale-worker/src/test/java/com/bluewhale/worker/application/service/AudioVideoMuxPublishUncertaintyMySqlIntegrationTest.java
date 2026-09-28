package com.bluewhale.worker.application.service;

import com.bluewhale.worker.application.processor.AudioVideoMuxJobProcessor;
import com.bluewhale.worker.application.service.WorkerClock;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
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
import com.sun.net.httpserver.HttpServer;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.model.object.DeleteObjectInput;
import com.volcengine.tos.model.object.PreSignedURLInput;
import com.volcengine.tos.model.object.PreSignedURLOutput;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.slf4j.LoggerFactory;
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
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
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
import static org.mockito.Mockito.doThrow;
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

    // ========== 真实 relay 组合线法（IKIN8V：处理器级组合用例，复用 StreamingTransferTest 线法） ==========

    private HttpServer sourceServer;
    private HttpServer uploadServer;

    /** 受控源分块参数：4×64KiB、块间 20ms——真实 HTTP 流式下载（持续有进度），转存亚秒完成。 */
    private static final int SOURCE_BLOCK_BYTES = 64 * 1024;
    private static final int SOURCE_BLOCK_COUNT = 4;

    @AfterEach
    void stopLocalServers() {
        if (uploadServer != null) uploadServer.stop(0);
        if (sourceServer != null) sourceServer.stop(0);
    }

    /** 本地受控视频源（真实 relay 线法，AudioVideoMuxStreamingTransferTest 同款缩小版）。 */
    private String serveControlledSource() throws IOException {
        byte[] block = new byte[SOURCE_BLOCK_BYTES];
        for (int i = 0; i < SOURCE_BLOCK_BYTES; i++) block[i] = (byte) (i % 251);
        sourceServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        sourceServer.createContext("/", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "video/mp4");
            exchange.sendResponseHeaders(200, (long) SOURCE_BLOCK_BYTES * SOURCE_BLOCK_COUNT);
            try (OutputStream out = exchange.getResponseBody()) {
                for (int i = 0; i < SOURCE_BLOCK_COUNT; i++) {
                    out.write(block, 0, SOURCE_BLOCK_BYTES);
                    out.flush();
                    Thread.sleep(20);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        sourceServer.start();
        return "http://127.0.0.1:" + sourceServer.getAddress().getPort() + "/out.mp4";
    }

    /** 真实 relay 的有状态 TOS 替身：preSignedURL 走 mock 指向本地上传桩（key 可经 sink 捕获），
     *  上传字节真实流式送达并按 key 落对象表；deleteObject 查表真删——对象存在性断言以此为准。 */
    private TOSV2 realTosStandin(ConcurrentHashMap<String, byte[]> objects,
                                 AtomicReference<String> keySink) throws IOException {
        uploadServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        uploadServer.createContext("/", exchange -> {
            String key = exchange.getRequestURI().getPath().substring(1);
            try (InputStream in = exchange.getRequestBody()) {
                objects.put(key, in.readAllBytes());
                exchange.sendResponseHeaders(200, -1);
            } finally {
                exchange.close();
            }
        });
        uploadServer.start();
        TOSV2 client = mock(TOSV2.class);
        when(client.preSignedURL(any(PreSignedURLInput.class))).thenAnswer(invocation -> {
            PreSignedURLInput input = invocation.getArgument(0);
            if (keySink != null) keySink.set(input.getKey());
            return new PreSignedURLOutput("http://127.0.0.1:" + uploadServer.getAddress().getPort()
                    + "/" + input.getKey(), input.getHeader());
        });
        doAnswer(invocation -> {
            DeleteObjectInput input = invocation.getArgument(0);
            objects.remove(input.getKey());
            return null;
        }).when(client).deleteObject(any(DeleteObjectInput.class));
        return client;
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

    /**
     * 处理器级组合用例（IKIN8V，规格 Testing Decisions「Worker 处理器使用真实 relay、隔离
     * MySQL、受控租约与提交时序，并复用同一有状态 TOS 替身」）：与
     * {@link #inFlightPublishCommittingAfterFirstProbeKeepsObjectAndBlocksOldExecutor} 同一
     * 交错（发布异常 + 在飞事务于探测窗口内提交），但转存换**真实 relay**——本地 HttpServer
     * 受控源 + mock TOSV2 仅签名 + 上传真实流式落对象表（真实 key 含本次执行独有 uuid，非
     * 测试预置）：对象确实完整送达过替身，保留 / 引用 / 终态断言全部对着真实上传结果。
     */
    @Test
    @Timeout(90)
    @DisplayName("组合（真实 relay）：在飞发布事务于探测窗口内提交——替身对象保留、真库 Asset 引用真实 key、成功终态、旧执行者 fail/publish 被 fencing 拒")
    void realRelayInFlightPublishCommitKeepsUploadedObjectWithRealKeyReferenced() throws Exception {
        long jobId = seedClaimableMuxJob();
        ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
        AtomicReference<String> realKey = new AtomicReference<>();
        AtomicReference<String> oldWorkerId = new AtomicReference<>();
        AtomicReference<Long> oldToken = new AtomicReference<>();
        TosVideoMediaRelay relay = new TosVideoMediaRelay(realTosStandin(objects, null), "bkt", "tos.example.com");
        JobStateMachineService spyService = spy(realService);
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        when(gateway.poll("sk-frozen", "mux-task-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", serveControlledSource(),
                        227.0, "1920x1080", null, null, "request-db-1"));
        var processor = new AudioVideoMuxJobProcessor(spyService, credentials, gateway, relay,
                mock(GenerationMessageProducer.class));

        CountDownLatch rawTxOpen = new CountDownLatch(1);
        CountDownLatch firstProbeDone = new CountDownLatch(1);
        CountDownLatch rawTxSettled = new CountDownLatch(1);
        AtomicInteger probes = new AtomicInteger();
        AtomicReference<Connection> rawRef = new AtomicReference<>();

        // 发布调用视角「结果不明」：真实转存产物（真实 key）进入在飞发布事务后抛异常
        doAnswer(invocation -> {
            PublishAudioVideoMuxDto dto = invocation.getArgument(0);
            realKey.set(dto.storageKey());
            oldWorkerId.set(dto.workerId());
            oldToken.set(dto.fencingToken());
            Connection raw = openRawConnection();
            rawRef.set(raw);
            executeInFlightPublish(raw, jobId, dto.workerId(), dto.fencingToken(), dto.storageKey());
            rawTxOpen.countDown();
            throw new RuntimeException("发布事务提交窗口断连（结果不明）");
        }).when(spyService).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        // 探测钩子：首轮真跑（行锁被在飞事务占用 → in-flight）；后续轮等主线程落定 raw 事务再放行
        doAnswer(invocation -> {
            if (probes.incrementAndGet() == 1) {
                boolean inFlight = (Boolean) invocation.callRealMethod();
                firstProbeDone.countDown();
                return inFlight;
            }
            assertThat(rawTxSettled.await(20, TimeUnit.SECONDS)).as("主线程应先落定在飞事务").isTrue();
            return (Boolean) invocation.callRealMethod();
        }).when(spyService).hasInFlightJobWriteTransaction(String.valueOf(jobId));

        ExecutorService single = Executors.newSingleThreadExecutor();
        try {
            var handle = single.submit(() -> processor.handle(String.valueOf(jobId)));
            assertThat(rawTxOpen.await(20, TimeUnit.SECONDS)).as("真实转存应完成并进入发布异常").isTrue();
            assertThat(firstProbeDone.await(20, TimeUnit.SECONDS)).as("首轮探测应已执行").isTrue();
            // 真实上传的完整字节数（受控源 4×64KiB 全量送达替身）；提交前 Asset 行对并发查询不可见
            assertThat(objects).containsKey(realKey.get());
            assertThat(objects.get(realKey.get())).hasSize(SOURCE_BLOCK_BYTES * SOURCE_BLOCK_COUNT);
            assertThat(countAssets(jobId, realKey.get())).as("提交前 Asset 行对并发查询不可见").isZero();
            rawRef.get().commit();
            rawTxSettled.countDown();
            handle.get(60, TimeUnit.SECONDS);
        } finally {
            settleQuietly(rawRef.get());
            single.shutdownNow();
        }

        // 替身中真实上传对象仍在（未删）+ 真库 Asset 引用真实 key + GenerationJob 成功终态
        assertThat(objects).containsKey(realKey.get());
        assertThat(countAssets(jobId, realKey.get())).isOne();
        GenerationJobEntity job = readJob(jobId);
        assertThat(job.getStatus()).isEqualTo("succeeded");
        assertThat(job.getLeaseOwner()).isNull();
        // 旧执行者 fencing：发布异常上抛后的 fail 尝试被守卫拒绝，不能改写成功终态
        verify(spyService).failMediaExtractJob(any());
        assertThat(readJob(jobId).getError()).isNull();
        assertThat(realService.failMediaExtractJob(new com.bluewhale.worker.domain.dto.FailMediaExtractDto(
                String.valueOf(jobId), oldWorkerId.get(), oldToken.get(),
                "audio_video_mux_failed", "迟到失败", Map.of()))).isFalse();
        assertThat(realService.publishAudioVideoMuxResult(new PublishAudioVideoMuxDto(
                String.valueOf(jobId), "99", "9", oldWorkerId.get(), oldToken.get(),
                "https://bkt.tos.example.com/" + realKey.get(), realKey.get(), "video/mp4",
                (long) SOURCE_BLOCK_BYTES * SOURCE_BLOCK_COUNT, "md5", 227.0, "1920x1080", "12"))).isFalse();
        assertThat(readJob(jobId).getStatus()).isEqualTo("succeeded");
        assertThat(probes.get()).isEqualTo(2);
    }

    /**
     * UNCONFIRMED 保守保留 + 恢复复判（IKIN8V，规格缺失 a2）：在飞发布事务对 generation_jobs
     * 行持 X 锁贯穿全部探测轮（默认 {@code publishSettleProbeAttempts=3}、轮间 500ms——探测轮
     * 与延时为 processor 包级旋钮，本类跨包不可注入，默认值窗口 ~1s 对 {@code @Timeout(90)}
     * 缩比可忽略）→ 判 UNCONFIRMED 保守保留并留 {@code [pending-cleanup]} 结构化记录；随后
     * 提交该在飞事务（同键 Asset 落定、job 由守卫 CAS 写成 succeeded）→ fail 落库被守卫拒绝
     * （不改写成功终态）→ 再次调用清理决策（同一决策入口，结果不明口径）→ 权威引用已可见 →
     * 对象保留。raw 连接 finally 兜底落定防容器复用污染。
     */
    @Test
    @Timeout(90)
    @DisplayName("在飞事务贯穿全部探测轮：UNCONFIRMED 保守保留 + [pending-cleanup] 结构化记录；提交后再次清理决策 → Asset 已可见，对象仍保留")
    void inFlightTransactionAcrossAllProbesKeepsObjectThenRecheckAfterCommitRetainsIt() throws Exception {
        long jobId = seedClaimableMuxJob();
        ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
        AtomicReference<String> realKey = new AtomicReference<>();
        TosVideoMediaRelay relay = new TosVideoMediaRelay(realTosStandin(objects, null), "bkt", "tos.example.com");
        JobStateMachineService spyService = spy(realService);
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        when(gateway.poll("sk-frozen", "mux-task-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", serveControlledSource(),
                        227.0, "1920x1080", null, null, "request-db-1"));
        AudioVideoMuxJobProcessor processor = new AudioVideoMuxJobProcessor(spyService, credentials,
                gateway, relay, mock(GenerationMessageProducer.class));

        CountDownLatch rawTxOpen = new CountDownLatch(1);
        CountDownLatch failAttempted = new CountDownLatch(1);
        AtomicInteger probes = new AtomicInteger();
        AtomicReference<Connection> rawRef = new AtomicReference<>();

        doAnswer(invocation -> {
            PublishAudioVideoMuxDto dto = invocation.getArgument(0);
            realKey.set(dto.storageKey());
            Connection raw = openRawConnection();
            rawRef.set(raw);
            executeInFlightPublish(raw, jobId, dto.workerId(), dto.fencingToken(), dto.storageKey());
            rawTxOpen.countDown();
            throw new RuntimeException("发布事务提交窗口断连（结果不明）");
        }).when(spyService).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        // 全部探测轮真跑：行锁被在飞事务占用 → in-flight；窗口耗尽即 UNCONFIRMED（默认 3 轮）
        doAnswer(invocation -> {
            probes.incrementAndGet();
            return invocation.callRealMethod();
        }).when(spyService).hasInFlightJobWriteTransaction(String.valueOf(jobId));

        // fail 落库钩子：[pending-cleanup] 记录在 discard 内同步先于 fail 写出——latch 放行即
        // 留痕已定；真实 fail UPDATE 阻塞在在飞事务行锁上，等主线程提交后守卫不命中（已 succeeded）
        doAnswer(invocation -> {
            failAttempted.countDown();
            return invocation.callRealMethod();
        }).when(spyService).failMediaExtractJob(any(com.bluewhale.worker.domain.dto.FailMediaExtractDto.class));

        Logger processorLogger = (Logger) LoggerFactory.getLogger(AudioVideoMuxJobProcessor.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        processorLogger.addAppender(appender);
        ExecutorService single = Executors.newSingleThreadExecutor();
        try {
            var handle = single.submit(() -> processor.handle(String.valueOf(jobId)));
            assertThat(rawTxOpen.await(20, TimeUnit.SECONDS)).as("在飞发布事务应已开启").isTrue();
            assertThat(failAttempted.await(20, TimeUnit.SECONDS))
                    .as("探测窗口应耗尽（UNCONFIRMED）并进入 fail 落库").isTrue();
            // 行锁贯穿全部探测轮（publishSettleProbeAttempts 默认 3）：无一轮见到锁空闲
            assertThat(probes.get()).isEqualTo(3);
            rawRef.get().commit();
            handle.get(60, TimeUnit.SECONDS);

            // 第一次决策（UNCONFIRMED）：对象保守保留 + 结构化待处理记录（jobId/storageKey/reason/resolution）
            assertThat(objects).containsKey(realKey.get());
            assertThat(appender.list.stream().map(ILoggingEvent::getFormattedMessage)
                    .filter(message -> message.contains("[pending-cleanup]")).toList())
                    .anySatisfy(message -> assertThat(message)
                            .contains("jobId=" + jobId)
                            .contains("storageKey=" + realKey.get())
                            .contains("发布结果不明")
                            .contains("resolution=retain-pending"));
            // 在飞事务提交后：Asset 引用可见、job 成功终态，迟到 fail 守卫被拒不改写终态
            assertThat(countAssets(jobId, realKey.get())).isOne();
            GenerationJobEntity job = readJob(jobId);
            assertThat(job.getStatus()).isEqualTo("succeeded");
            verify(spyService).failMediaExtractJob(any());
            assertThat(readJob(jobId).getError()).isNull();

            // 恢复复判：状态恢复后再次调用同一清理决策（发布结果不明口径）——探测锁空闲 +
            // Asset 引用已可见 → REFERENCED 保留，对象不删
            ClaimedMediaExtractJobDto jobDto = new ClaimedMediaExtractJobDto(String.valueOf(jobId),
                    "99", "9", Map.of(), "mux-task-1", "amux-recheck", job.getFencingToken(),
                    0, 0, WorkerClock.now(), null);
            TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay.StoredVideo(
                    "https://bkt.tos.example.com/" + realKey.get(), realKey.get(), "video/mp4",
                    (long) SOURCE_BLOCK_BYTES * SOURCE_BLOCK_COUNT, "md5");
            var decision = AudioVideoMuxJobProcessor.class.getDeclaredMethod(
                    "discardUnpublishedTransfer", ClaimedMediaExtractJobDto.class,
                    TosVideoMediaRelay.StoredVideo.class, boolean.class);
            decision.setAccessible(true);
            decision.invoke(processor, jobDto, stored, true);
            assertThat(objects).containsKey(realKey.get());
            assertThat(countAssets(jobId, realKey.get())).isOne();
            assertThat(readJob(jobId).getStatus()).isEqualTo("succeeded");
        } finally {
            processorLogger.detachAppender(appender);
            settleQuietly(rawRef.get());
            single.shutdownNow();
        }
    }

    /**
     * 发布异常路径删除失败不记成功（IKIN8V，规格缺失 a3）：发布异常且已确认可删（无在飞事务、
     * 无 Asset 引用）时 TOS {@code deleteObject} 抛错——真实 relay 链路上删除失败由 relay 吞掉
     * 并留失败痕迹（storageKey + err），不得报告清理成功（无成功记录）；对象保留在替身（删除
     * 未生效）；清理失败不改写任务失败原因（failed 的 error 仍是发布异常，不含删除错误）。
     */
    @Test
    @Timeout(90)
    @DisplayName("组合（真实 relay）：已确认可删但 TOS deleteObject 抛错——对象保留、失败留痕含 storageKey 与错误、不报告清理成功、失败原因不改写")
    void realRelayTosDeleteFailureOnConfirmedDeletableKeepsObjectWithoutReportingSuccess() throws Exception {
        long jobId = seedClaimableMuxJob();
        ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
        AtomicReference<String> realKey = new AtomicReference<>();
        TOSV2 tosClient = realTosStandin(objects, null);
        doThrow(new RuntimeException("TOS 删除 5xx")).when(tosClient)
                .deleteObject(any(DeleteObjectInput.class));
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        JobStateMachineService spyService = spy(realService);
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        when(gateway.poll("sk-frozen", "mux-task-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", serveControlledSource(),
                        227.0, "1920x1080", null, null, "request-db-1"));
        var processor = new AudioVideoMuxJobProcessor(spyService, credentials, gateway, relay,
                mock(GenerationMessageProducer.class));
        doAnswer(invocation -> {
            realKey.set(((PublishAudioVideoMuxDto) invocation.getArgument(0)).storageKey());
            throw new RuntimeException("发布事务结果不明");
        }).when(spyService).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        Logger relayLogger = (Logger) LoggerFactory.getLogger(TosVideoMediaRelay.class);
        ListAppender<ILoggingEvent> relayLogs = new ListAppender<>();
        relayLogs.start();
        relayLogger.addAppender(relayLogs);
        try {
            processor.handle(String.valueOf(jobId));

            // 删除动作确实发生且失败未生效：真实上传对象仍完整保留在替身（不得记为清理成功）
            assertThat(realKey.get()).startsWith("generated/9/video/");
            assertThat(objects).containsKey(realKey.get());
            assertThat(objects.get(realKey.get())).hasSize(SOURCE_BLOCK_BYTES * SOURCE_BLOCK_COUNT);
            List<String> messages = relayLogs.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
            // 失败留痕含对象身份与错误（jobId 由失败终态行关联，见下）；成功留痕不得出现
            assertThat(messages.stream().filter(m -> m.contains("清理未发布 TOS 对象失败")).toList())
                    .anySatisfy(m -> assertThat(m)
                            .contains("storageKey=" + realKey.get())
                            .contains("TOS 删除 5xx"));
            assertThat(messages).noneMatch(m -> m.contains("清理未发布 TOS 对象 storageKey="));
            // 不转成（额外的）任务失败：failed 的原因仍是发布异常，清理失败不改写失败语义
            GenerationJobEntity job = readJob(jobId);
            assertThat(job.getStatus()).isEqualTo("failed");
            assertThat(job.getError())
                    .contains("audio_video_mux_failed")
                    .contains("发布事务结果不明")
                    .doesNotContain("TOS 删除");
            verify(spyService).failMediaExtractJob(any());
        } finally {
            relayLogger.detachAppender(relayLogs);
        }
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
