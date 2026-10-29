package com.bluewhale.worker.application.service;

import com.bluewhale.worker.application.processor.AudioVideoMuxJobProcessor;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient.MuxAudioVideoTaskObservation;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
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
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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
    static JobFinalizer realFinalizer;
    static JobClaimService realClaimService;
    static GenerationJobMapper realJobMapper;
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
        GenerationJobExtraMapper extraMapper(SqlSessionFactory sf) throws Exception {
            return factory(GenerationJobExtraMapper.class, sf).getObject();
        }

        @Bean
        JobStateMachineService service(
                GenerationJobMapper jm, AssetMapper am, GenerationJobLogMapper jlm,
                GenerationOutputSlotMapper sm,
                GenerationJobExtraMapper em) {
            return new JobStateMachineService(jm, am, jlm, sm, em);
        }

        @Bean
        JobFinalizer finalizer(
                GenerationJobMapper jm, AssetMapper am, GenerationJobLogMapper jlm,
                GenerationOutputSlotMapper sm, GenerationJobExtraMapper em) {
            return new JobFinalizer(jm, am, jlm, sm, em, TerminalEventOutbox.noop());
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
        realFinalizer = ctx.getBean(JobFinalizer.class);
        realJobMapper = ctx.getBean(GenerationJobMapper.class);
        realClaimService = new JobClaimService(realJobMapper, ctx.getBean(GenerationJobExtraMapper.class));
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


    private static final byte[] OLD_KEY_PAYLOAD = "mux-result-payload".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    private static final byte[] NEW_KEY_PAYLOAD = "mux-result-payload-new".getBytes(java.nio.charset.StandardCharsets.UTF_8);

    private long seedClaimableMuxJob() {
        jdbc.update("""
                INSERT INTO generation_jobs
                  (user_id, project_id, type, source, status, fencing_token, next_action_at,
                   provider_task_id, input, progress,
                   gmt_create, gmt_modified, version, is_delete)
                VALUES (9, 99, 'audio_video_mux', 'dock', 'queued', 0, ?,
                        'mux-task-1', ?, 0, NOW(), NOW(), 0, false)
                """,
                LocalDateTime.now().minusSeconds(30),
                "{\"audio\":{\"assetId\":\"11\",\"nodeId\":\"source-node\",\"url\":\"https://tos/a.mp3\"},"
                        + "\"video\":{\"assetId\":\"12\",\"url\":\"https://tos/v.mp4\"},"
                        + "\"is_audio_reserve\":true,\"sync\":\"none\",\"submit_attempt\":1}");
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
                "SELECT COUNT(*) FROM user_assets WHERE generation_job_id=? AND storage_key=?",
                Integer.class, jobId, storageKey);
        return count != null ? count : 0;
    }

    private record WiredProcessor(
            AudioVideoMuxJobProcessor processor,
            JobFinalizer spyFinalizer,
            ConcurrentHashMap<String, byte[]> objects) {}

    private WiredProcessor wireProcessor(ConcurrentHashMap<String, byte[]> objects, String storageKey) {
        JobStateMachineService spyService = spy(realService);
        JobFinalizer spyFinalizer = spy(realFinalizer);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
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
        var processor = new AudioVideoMuxJobProcessor(spyService, realClaimService, realJobMapper, spyFinalizer,
                upstreamCredential, gateway, relay, producer);
        return new WiredProcessor(processor, spyFinalizer, objects);
    }

    private Connection openRawConnection() throws Exception {
        Connection raw = DriverManager.getConnection(mysql.getJdbcUrl(), mysql.getUsername(), mysql.getPassword());
        raw.setAutoCommit(false);
        return raw;
    }


    private HttpServer sourceServer;
    private HttpServer uploadServer;

    private static final int SOURCE_BLOCK_BYTES = 64 * 1024;
    private static final int SOURCE_BLOCK_COUNT = 4;

    @AfterEach
    void stopLocalServers() {
        if (uploadServer != null) uploadServer.stop(0);
        if (sourceServer != null) sourceServer.stop(0);
    }

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
        try (PreparedStatement guard = raw.prepareStatement("""
                UPDATE generation_jobs
                SET status = 'succeeded', progress = 100, next_action_at = NULL,
                    lease_owner = NULL, lease_expires_at = NULL, version = version + 1
                WHERE id = ? AND status = 'processing' AND lease_owner = ? AND fencing_token = ?
                """)) {
            guard.setLong(1, jobId);
            guard.setString(2, workerId);
            guard.setLong(3, token);
            assertThat(guard.executeUpdate()).as("在飞发布事务的守卫 CAS 应命中当前租约").isOne();
        }
        try (PreparedStatement asset = raw.prepareStatement("""
                INSERT INTO user_assets (user_id, project_id, generation_job_id, type, storage_key, url, mime, size)
                VALUES (9, 99, ?, 'video', ?, ?, 'video/mp4', 100)
                """)) {
            asset.setLong(1, jobId);
            asset.setString(2, storageKey);
            asset.setString(3, "https://bkt.tos.example.com/" + storageKey);
            assertThat(asset.executeUpdate()).isOne();
        }
    }


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

        doAnswer(invocation -> {
            PublishAudioVideoMuxDto dto = invocation.getArgument(0);
            Connection raw = openRawConnection();
            rawRef.set(raw);
            executeInFlightPublish(raw, jobId, dto.workerId(), dto.fencingToken(), oldKey);
            rawTxOpen.countDown();
            throw new RuntimeException("发布事务提交窗口断连（结果不明）");
        }).when(wired.spyFinalizer()).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        doAnswer(invocation -> {
            if (probes.incrementAndGet() == 1) {
                boolean inFlight = (Boolean) invocation.callRealMethod();
                firstProbeDone.countDown();
                return inFlight;
            }
            assertThat(rawTxSettled.await(20, TimeUnit.SECONDS)).as("主线程应先落定在飞事务").isTrue();
            return (Boolean) invocation.callRealMethod();
        }).when(wired.spyFinalizer()).hasInFlightJobWriteTransaction(String.valueOf(jobId));

        ExecutorService single = Executors.newSingleThreadExecutor();
        try {
            var handle = single.submit(() -> wired.processor().handle(String.valueOf(jobId)));
            assertThat(rawTxOpen.await(20, TimeUnit.SECONDS)).as("在飞发布事务应已开启").isTrue();
            assertThat(firstProbeDone.await(20, TimeUnit.SECONDS)).as("首轮探测应已执行").isTrue();
            assertThat(countAssets(jobId, oldKey)).as("提交前 Asset 行对并发查询不可见").isZero();
            rawRef.get().commit();
            rawTxSettled.countDown();
            handle.get(60, TimeUnit.SECONDS);
        } finally {
            settleQuietly(rawRef.get());
            single.shutdownNow();
        }

        assertThat(objects).containsKey(oldKey);
        assertThat(countAssets(jobId, oldKey)).isOne();
        GenerationJobEntity job = readJob(jobId);
        assertThat(job.getStatus()).isEqualTo("succeeded");
        assertThat(job.getLeaseOwner()).isNull();
        verify(wired.spyFinalizer()).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
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
        }).when(wired.spyFinalizer()).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        doAnswer(invocation -> {
            if (probes.incrementAndGet() == 1) {
                boolean inFlight = (Boolean) invocation.callRealMethod();
                firstProbeDone.countDown();
                return inFlight;
            }
            assertThat(rawTxSettled.await(20, TimeUnit.SECONDS)).as("主线程应先回滚在飞事务").isTrue();
            return (Boolean) invocation.callRealMethod();
        }).when(wired.spyFinalizer()).hasInFlightJobWriteTransaction(String.valueOf(jobId));

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

        assertThat(objects).doesNotContainKey(oldKey);
        assertThat(countAssets(jobId, oldKey)).isZero();
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

        doAnswer(invocation -> {
            PublishAudioVideoMuxDto dto = invocation.getArgument(0);
            oldWorkerId.set(dto.workerId());
            oldToken.set(dto.fencingToken());
            assertThat(dto.storageKey()).isEqualTo(oldKey);
            jdbc.update("UPDATE generation_jobs SET lease_owner='amux-new', fencing_token=fencing_token+1, "
                    + "lease_expires_at=? WHERE id=?", LocalDateTime.now().plusMinutes(5), jobId);
            Long newToken = jdbc.queryForObject("SELECT fencing_token FROM generation_jobs WHERE id=?",
                    Long.class, jobId);
            boolean published = realFinalizer.publishAudioVideoMuxResult(new PublishAudioVideoMuxDto(
                    String.valueOf(jobId), "99", "9", "amux-new", newToken,
                    "https://bkt.tos.example.com/" + newKey, newKey, "video/mp4",
                    (long) NEW_KEY_PAYLOAD.length, "md5", 227.0, "1920x1080", "12"));
            assertThat(published).as("新执行者用新键发布应成功").isTrue();
            objects.put(newKey, NEW_KEY_PAYLOAD);
            return false;
        }).when(wired.spyFinalizer()).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        wired.processor().handle(String.valueOf(jobId));

        assertThat(objects).doesNotContainKey(oldKey);
        assertThat(objects).containsKey(newKey);
        assertThat(countAssets(jobId, newKey)).isOne();
        assertThat(countAssets(jobId, oldKey)).isZero();
        Integer totalAssets = jdbc.queryForObject(
                "SELECT COUNT(*) FROM user_assets WHERE generation_job_id=?", Integer.class, jobId);
        assertThat(totalAssets).isEqualTo(1);
        GenerationJobEntity job = readJob(jobId);
        assertThat(job.getStatus()).isEqualTo("succeeded");

        assertThat(realFinalizer.failMediaExtractJob(
                String.valueOf(jobId), "audio_video_mux_failed", "迟到失败", Map.of(),
                oldWorkerId.get(), oldToken.get())).isFalse();
        assertThat(realFinalizer.publishAudioVideoMuxResult(new PublishAudioVideoMuxDto(
                String.valueOf(jobId), "99", "9", oldWorkerId.get(), oldToken.get(),
                "https://bkt.tos.example.com/" + oldKey, oldKey, "video/mp4",
                (long) OLD_KEY_PAYLOAD.length, "md5", 227.0, "1920x1080", "12"))).isFalse();
        assertThat(readJob(jobId).getStatus()).isEqualTo("succeeded");
        assertThat(countAssets(jobId, oldKey)).isZero();
        verify(wired.spyFinalizer(), never()).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
    }

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
        JobFinalizer spyFinalizer = spy(realFinalizer);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        when(gateway.poll("sk-frozen", "mux-task-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", serveControlledSource(),
                        227.0, "1920x1080", null, null, "request-db-1"));
        var processor = new AudioVideoMuxJobProcessor(spyService, realClaimService, realJobMapper, spyFinalizer,
                upstreamCredential, gateway, relay,
                mock(GenerationMessageProducer.class));

        CountDownLatch rawTxOpen = new CountDownLatch(1);
        CountDownLatch firstProbeDone = new CountDownLatch(1);
        CountDownLatch rawTxSettled = new CountDownLatch(1);
        AtomicInteger probes = new AtomicInteger();
        AtomicReference<Connection> rawRef = new AtomicReference<>();

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
        }).when(spyFinalizer).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        doAnswer(invocation -> {
            if (probes.incrementAndGet() == 1) {
                boolean inFlight = (Boolean) invocation.callRealMethod();
                firstProbeDone.countDown();
                return inFlight;
            }
            assertThat(rawTxSettled.await(20, TimeUnit.SECONDS)).as("主线程应先落定在飞事务").isTrue();
            return (Boolean) invocation.callRealMethod();
        }).when(spyFinalizer).hasInFlightJobWriteTransaction(String.valueOf(jobId));

        ExecutorService single = Executors.newSingleThreadExecutor();
        try {
            var handle = single.submit(() -> processor.handle(String.valueOf(jobId)));
            assertThat(rawTxOpen.await(20, TimeUnit.SECONDS)).as("真实转存应完成并进入发布异常").isTrue();
            assertThat(firstProbeDone.await(20, TimeUnit.SECONDS)).as("首轮探测应已执行").isTrue();
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

        assertThat(objects).containsKey(realKey.get());
        assertThat(countAssets(jobId, realKey.get())).isOne();
        GenerationJobEntity job = readJob(jobId);
        assertThat(job.getStatus()).isEqualTo("succeeded");
        assertThat(job.getLeaseOwner()).isNull();
        verify(spyFinalizer).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        assertThat(readJob(jobId).getError()).isNull();
        assertThat(realFinalizer.failMediaExtractJob(
                String.valueOf(jobId), "audio_video_mux_failed", "迟到失败", Map.of(),
                oldWorkerId.get(), oldToken.get())).isFalse();
        assertThat(realFinalizer.publishAudioVideoMuxResult(new PublishAudioVideoMuxDto(
                String.valueOf(jobId), "99", "9", oldWorkerId.get(), oldToken.get(),
                "https://bkt.tos.example.com/" + realKey.get(), realKey.get(), "video/mp4",
                (long) SOURCE_BLOCK_BYTES * SOURCE_BLOCK_COUNT, "md5", 227.0, "1920x1080", "12"))).isFalse();
        assertThat(readJob(jobId).getStatus()).isEqualTo("succeeded");
        assertThat(probes.get()).isEqualTo(2);
    }

    @Test
    @Timeout(90)
    @DisplayName("在飞事务贯穿全部探测轮：UNCONFIRMED 保守保留 + [pending-cleanup] 结构化记录；提交后再次清理决策 → Asset 已可见，对象仍保留")
    void inFlightTransactionAcrossAllProbesKeepsObjectThenRecheckAfterCommitRetainsIt() throws Exception {
        long jobId = seedClaimableMuxJob();
        ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
        AtomicReference<String> realKey = new AtomicReference<>();
        TosVideoMediaRelay relay = new TosVideoMediaRelay(realTosStandin(objects, null), "bkt", "tos.example.com");
        JobStateMachineService spyService = spy(realService);
        JobFinalizer spyFinalizer = spy(realFinalizer);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        when(gateway.poll("sk-frozen", "mux-task-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", serveControlledSource(),
                        227.0, "1920x1080", null, null, "request-db-1"));
        AudioVideoMuxJobProcessor processor = new AudioVideoMuxJobProcessor(spyService,
                realClaimService, realJobMapper, spyFinalizer, upstreamCredential, gateway, relay,
                mock(GenerationMessageProducer.class));

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
        }).when(spyFinalizer).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        doAnswer(invocation -> {
            probes.incrementAndGet();
            return invocation.callRealMethod();
        }).when(spyFinalizer).hasInFlightJobWriteTransaction(String.valueOf(jobId));

        doAnswer(invocation -> {
            failAttempted.countDown();
            return invocation.callRealMethod();
        }).when(spyFinalizer).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());

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
            assertThat(probes.get()).isEqualTo(3);
            rawRef.get().commit();
            handle.get(60, TimeUnit.SECONDS);

            assertThat(objects).containsKey(realKey.get());
            assertThat(appender.list.stream().map(ILoggingEvent::getFormattedMessage)
                    .filter(message -> message.contains("[pending-cleanup]")).toList())
                    .anySatisfy(message -> assertThat(message)
                            .contains("jobId=" + jobId)
                            .contains("storageKey=" + realKey.get())
                            .contains("发布结果不明")
                            .contains("resolution=retain-pending"));
            assertThat(countAssets(jobId, realKey.get())).isOne();
            GenerationJobEntity job = readJob(jobId);
            assertThat(job.getStatus()).isEqualTo("succeeded");
            verify(spyFinalizer).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
            assertThat(readJob(jobId).getError()).isNull();

            ClaimedJob jobDto = new ClaimedJob(String.valueOf(jobId),
                    "99", "9", Map.of(), "audio_video_mux", "mux-task-1", false, "amux-recheck",
                    job.getFencingToken(), 0, 0, LocalDateTime.now(), null, null);
            TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay.StoredVideo(
                    "https://bkt.tos.example.com/" + realKey.get(), realKey.get(), "video/mp4",
                    (long) SOURCE_BLOCK_BYTES * SOURCE_BLOCK_COUNT, "md5");
            var decision = AudioVideoMuxJobProcessor.class.getDeclaredMethod(
                    "discardUnpublishedTransfer", ClaimedJob.class,
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
        JobFinalizer spyFinalizer = spy(realFinalizer);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        when(gateway.poll("sk-frozen", "mux-task-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", serveControlledSource(),
                        227.0, "1920x1080", null, null, "request-db-1"));
        var processor = new AudioVideoMuxJobProcessor(spyService, realClaimService, realJobMapper, spyFinalizer,
                upstreamCredential, gateway, relay,
                mock(GenerationMessageProducer.class));
        doAnswer(invocation -> {
            realKey.set(((PublishAudioVideoMuxDto) invocation.getArgument(0)).storageKey());
            throw new RuntimeException("发布事务结果不明");
        }).when(spyFinalizer).publishAudioVideoMuxResult(any(PublishAudioVideoMuxDto.class));

        Logger relayLogger = (Logger) LoggerFactory.getLogger(TosVideoMediaRelay.class);
        ListAppender<ILoggingEvent> relayLogs = new ListAppender<>();
        relayLogs.start();
        relayLogger.addAppender(relayLogs);
        try {
            processor.handle(String.valueOf(jobId));

            assertThat(realKey.get()).startsWith("generated/9/video/");
            assertThat(objects).containsKey(realKey.get());
            assertThat(objects.get(realKey.get())).hasSize(SOURCE_BLOCK_BYTES * SOURCE_BLOCK_COUNT);
            List<String> messages = relayLogs.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
            assertThat(messages.stream().filter(m -> m.contains("清理未发布 TOS 对象失败")).toList())
                    .anySatisfy(m -> assertThat(m)
                            .contains("storageKey=" + realKey.get())
                            .contains("TOS 删除 5xx"));
            assertThat(messages).noneMatch(m -> m.contains("清理未发布 TOS 对象 storageKey="));
            GenerationJobEntity job = readJob(jobId);
            assertThat(job.getStatus()).isEqualTo("failed");
            assertThat(job.getError())
                    .contains("audio_video_mux_failed")
                    .contains("发布事务结果不明")
                    .doesNotContain("TOS 删除");
            verify(spyFinalizer).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        } finally {
            relayLogger.detachAppender(relayLogs);
        }
    }

    private static void settleQuietly(Connection raw) {
        if (raw == null) return;
        try {
            if (!raw.isClosed()) {
                raw.rollback();
                raw.close();
            }
        } catch (Exception ignore) {
        }
    }
}
