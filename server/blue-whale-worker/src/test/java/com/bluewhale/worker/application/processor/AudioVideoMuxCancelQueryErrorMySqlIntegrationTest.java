package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobSettlementPublisher;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.application.service.ProjectEventPublisher;
import com.bluewhale.worker.application.service.SceneCardGenerationRecordSync;
import com.bluewhale.worker.application.service.StoryboardPreviewSync;
import com.bluewhale.worker.application.service.WorkerClock;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient.MuxAudioVideoTaskObservation;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.ProjectEventMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.StoryboardPreviewMapper;
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
import java.time.Duration;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;

@Testcontainers(disabledWithoutDocker = true)
@DisplayName("音视频合成取消状态查询异常的安全收口真库测试（MySQL Testcontainers，IKIN91）")
class AudioVideoMuxCancelQueryErrorMySqlIntegrationTest {

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
    static JobClaimService claimService;
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
        GenerationJobExtraMapper extraMapper(SqlSessionFactory sf) throws Exception {
            return factory(GenerationJobExtraMapper.class, sf).getObject();
        }

        @Bean
        JobStateMachineService service(
                GenerationJobMapper jm, AssetMapper am, GenerationJobLogMapper jlm,
                ProjectEventMapper pem, GenerationOutputSlotMapper sm,
                SceneCardGenerationRecordMapper rm, StoryboardPreviewMapper pm,
                GenerationJobExtraMapper em) {
            return new JobStateMachineService(jm, am, jlm, pem, sm, rm, pm, em);
        }

        @Bean
        JobFinalizer finalizer(
                GenerationJobMapper jm, AssetMapper am, GenerationJobLogMapper jlm,
                GenerationOutputSlotMapper sm, GenerationJobExtraMapper em,
                ProjectEventMapper pem,
                SceneCardGenerationRecordMapper rm, StoryboardPreviewMapper pm) {
            ProjectEventPublisher events = new ProjectEventPublisher(pem);
            return new JobFinalizer(jm, am, jlm, sm, em,
                    new SceneCardGenerationRecordSync(sm, rm, events),
                    new StoryboardPreviewSync(sm, pm, events),
                    events,
                    JobSettlementPublisher.noop());
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
        claimService = new JobClaimService(realJobMapper, ctx.getBean(GenerationJobExtraMapper.class));
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


    private static final byte[] PAYLOAD = "mux-result-payload".getBytes(java.nio.charset.StandardCharsets.UTF_8);

    private long seedClaimableMuxJob() {
        jdbc.update("""
                INSERT INTO generation_jobs
                  (user_id, project_id, type, source, status, fencing_token, next_action_at,
                   provider_task_id, input, progress,
                   gmt_create, gmt_modified, version, is_delete)
                VALUES (9, 99, 'audio_video_mux', 'dock', 'queued', 0, ?,
                        'mux-task-1', ?, 0, NOW(), NOW(), 0, false)
                """,
                WorkerClock.now().minusSeconds(30),
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
                "SELECT COUNT(*) FROM assets WHERE generation_job_id=? AND storage_key=?",
                Integer.class, jobId, storageKey);
        return count != null ? count : 0;
    }

    private record WiredProcessor(
            AudioVideoMuxJobProcessor processor,
            JobStateMachineService spyService,
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
                    objects.put(storageKey, PAYLOAD);
                    return new TosVideoMediaRelay.StoredVideo(
                            "https://bkt.tos.example.com/" + storageKey, storageKey,
                            "video/mp4", (long) PAYLOAD.length, "md5");
                });
        doAnswer(invocation -> {
            objects.remove((String) invocation.getArgument(0));
            return null;
        }).when(relay).deleteUnpublishedObject(anyString());
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        var processor = new AudioVideoMuxJobProcessor(spyService, claimService, realJobMapper, spyFinalizer,
                upstreamCredential, gateway, relay, producer);
        return new WiredProcessor(processor, spyService, spyFinalizer, objects);
    }

    private static final String CANCEL_QUERY_ERROR = "取消状态查询 DB 断连（IKIN91）";

    private void throwOnPostTransferCancelQuery(JobStateMachineService spyService, long jobId) {
        AtomicInteger cancelCalls = new AtomicInteger();
        doAnswer(invocation -> {
            if (cancelCalls.incrementAndGet() == 4) {
                throw new RuntimeException(CANCEL_QUERY_ERROR);
            }
            return invocation.callRealMethod();
        }).when(spyService)
                .cancelAudioVideoMuxIfRequested(eq(String.valueOf(jobId)), anyString(), anyLong());
    }

    private static List<String> captureProcessorLogs(Runnable action) {
        Logger logger = (Logger) LoggerFactory.getLogger(AudioVideoMuxJobProcessor.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            action.run();
            return appender.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
        } finally {
            logger.detachAppender(appender);
        }
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


    @Test
    @Timeout(90)
    @DisplayName("取消状态查询瞬断（发布未尝试）：对象安全收口真删、无 Asset 引用，GenerationJob 按既有失败语义落 failed 终态")
    void transientCancelQueryErrorCleansObjectAndClosesJobAsFailed() {
        long jobId = seedClaimableMuxJob();
        String key = "generated/9/video/cancel-query-error.mp4";
        ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
        WiredProcessor wired = wireProcessor(objects, key);
        throwOnPostTransferCancelQuery(wired.spyService(), jobId);

        wired.processor().handle(String.valueOf(jobId));

        assertThat(objects).doesNotContainKey(key);
        assertThat(countAssets(jobId, key)).isZero();
        GenerationJobEntity job = readJob(jobId);
        assertThat(job.getStatus()).isEqualTo("failed");
        assertThat(job.getError()).contains("audio_video_mux_failed").contains(CANCEL_QUERY_ERROR);
        assertThat(job.getLeaseOwner()).isNull();
    }

    @Test
    @Timeout(90)
    @DisplayName("组合（真实 relay）：取消查询 DB 异常——真实上传对象被真删、真库无该键 Asset、任务按失败语义落 failed 终态")
    void realRelayTransferThenCancelQueryErrorDeletesRealObjectWithoutAssetReference() throws Exception {
        long jobId = seedClaimableMuxJob();
        ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
        AtomicReference<String> realKey = new AtomicReference<>();
        TosVideoMediaRelay relay = new TosVideoMediaRelay(realTosStandin(objects, realKey), "bkt", "tos.example.com");
        JobStateMachineService spyService = spy(realService);
        JobFinalizer spyFinalizer = spy(realFinalizer);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        when(gateway.poll("sk-frozen", "mux-task-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", serveControlledSource(),
                        227.0, "1920x1080", null, null, "request-db-1"));
        var processor = new AudioVideoMuxJobProcessor(spyService, claimService, realJobMapper, spyFinalizer,
                upstreamCredential, gateway, relay, mock(GenerationMessageProducer.class));
        throwOnPostTransferCancelQuery(spyService, jobId);

        processor.handle(String.valueOf(jobId));

        assertThat(realKey.get()).startsWith("generated/9/video/");
        assertThat(objects).doesNotContainKey(realKey.get());
        assertThat(objects).isEmpty();
        assertThat(countAssets(jobId, realKey.get())).isZero();
        GenerationJobEntity job = readJob(jobId);
        assertThat(job.getStatus()).isEqualTo("failed");
        assertThat(job.getError()).contains("audio_video_mux_failed").contains(CANCEL_QUERY_ERROR);
        assertThat(job.getLeaseOwner()).isNull();
    }

    @Test
    @Timeout(90)
    @DisplayName("DB 持续不可用（fail 落库也失败）：对象仍先收口，原异常原样上抛，不声称已写终态（真库仍 processing），留未完成收口事实")
    void persistentDbOutageRecordsIncompleteClosureWithoutClaimingTerminalState() {
        long jobId = seedClaimableMuxJob();
        String key = "generated/9/video/persistent-outage.mp4";
        ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
        WiredProcessor wired = wireProcessor(objects, key);
        throwOnPostTransferCancelQuery(wired.spyService(), jobId);
        doAnswer(invocation -> {
            throw new RuntimeException("fail 落库断连");
        }).when(wired.spyFinalizer())
                .failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());

        List<String> logs = captureProcessorLogs(() ->
                assertThatThrownBy(() -> wired.processor().handle(String.valueOf(jobId)))
                        .hasMessageContaining(CANCEL_QUERY_ERROR));

        assertThat(objects).doesNotContainKey(key);
        assertThat(countAssets(jobId, key)).isZero();
        GenerationJobEntity job = readJob(jobId);
        assertThat(job.getStatus()).isEqualTo("processing");
        assertThat(job.getLeaseOwner()).isNotNull();
        assertThat(logs.stream().filter(message -> message.contains("失败终态落库未完成")).toList())
                .anySatisfy(message -> assertThat(message)
                        .contains("jobId=" + jobId)
                        .contains("fail 落库断连"));
    }
}
