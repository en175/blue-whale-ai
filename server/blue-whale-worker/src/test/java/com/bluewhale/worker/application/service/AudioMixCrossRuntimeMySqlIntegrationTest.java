package com.bluewhale.worker.application.service;

import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.application.processor.AudioMixJobProcessor;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper;
import com.bluewhale.worker.infrastructure.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.mapper.StoryboardPreviewMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
import com.sun.net.httpserver.HttpServer;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.jdbc.core.JdbcTemplate;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 只消费外层 Node 验收新建的隔离库；普通金标类始终使用自己持有的 Testcontainers。 */
class AudioMixCrossRuntimeMySqlIntegrationTest {
    private static AudioMixCrossRuntimeDbGuard.Target target;
    private static HikariDataSource dataSource;
    private static JobStateMachineService service;
    private static JdbcTemplate jdbc;
    private static GenerationJobMapper jobMapper;

    @BeforeAll
    static void boot() throws Exception {
        var env = System.getenv();
        Assumptions.assumeTrue(AudioMixCrossRuntimeDbGuard.requested(env), "未请求 IKI68N 跨端验收");
        target = AudioMixCrossRuntimeDbGuard.validate(env);
        // 所有写路径之前只读核对随机标记，错库/错端口立即失败。
        AudioMixCrossRuntimeDbGuard.verifyMarker(target);

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(target.jdbcUrl());
        config.setUsername("test");
        config.setPassword("test");
        config.setMaximumPoolSize(5);
        config.setConnectionInitSql("SET time_zone='+08:00'");
        dataSource = new HikariDataSource(config);
        jdbc = new JdbcTemplate(dataSource);
        MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
        factory.setDataSource(dataSource);
        SqlSessionFactory session = factory.getObject();
        jobMapper = mapper(GenerationJobMapper.class, session);
        service = new JobStateMachineService(jobMapper,
                mapper(AssetMapper.class, session),
                mapper(GenerationJobLogMapper.class, session),
                mapper(ProjectEventMapper.class, session),
                mapper(GenerationOutputSlotMapper.class, session),
                mapper(SceneCardGenerationRecordMapper.class, session),
                mapper(StoryboardPreviewMapper.class, session));
    }

    @AfterAll
    static void shutdown() {
        if (dataSource != null) dataSource.close();
    }

    private static <T> T mapper(Class<T> type, SqlSessionFactory session) throws Exception {
        MapperFactoryBean<T> factory = new MapperFactoryBean<>(type);
        factory.setSqlSessionFactory(session);
        factory.afterPropertiesSet();
        return factory.getObject();
    }

    private static GenerationJobEntity readJob(long jobId) {
        return jobMapper.selectById(jobId);
    }

    private static int countAssets(long jobId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM assets WHERE generation_job_id=?", Integer.class, jobId);
    }

    @Test
    @DisplayName("audio_mix 跨 Node/Java 贯通：消费真实业务 API 写入的同库任务")
    void audioMixCrossRuntimeBusinessApiToAsset() throws Exception {
        String jobId = target.jobId();
        if ("cancel".equals(System.getenv("IKI68N_CROSS_RUNTIME_PHASE"))) {
            assertThat(jdbc.queryForObject("SELECT cancel_requested_at FROM generation_jobs WHERE id=?",
                    java.sql.Timestamp.class, Long.parseLong(jobId))).isNotNull();
            var credentials = mock(GenerationCredentialService.class);
            var gateway = mock(NewApiMediaKitMixAudioClient.class);
            var relay = mock(TosAudioMediaRelay.class);
            var producer = mock(GenerationMessageProducer.class);
            new AudioMixJobProcessor(service, credentials, gateway, relay, producer).handle(jobId);
            assertThat(readJob(Long.parseLong(jobId)).getStatus()).isEqualTo("cancelled");
            assertThat(countAssets(Long.parseLong(jobId))).isZero();
            verifyNoInteractions(credentials, gateway, relay, producer);
            return;
        }
        boolean failPhase = "fail".equals(System.getenv("IKI68N_CROSS_RUNTIME_PHASE"));
        String storageUploadUrl = target.storageUploadUrl();
        String storagePublicUrl = target.storagePublicUrl();
        String audioFile = System.getenv("IKI68N_CROSS_RUNTIME_AUDIO_FILE");
        if (audioFile != null && !"/fixture/result.mp3".equals(audioFile)) {
            throw new IllegalStateException("跨端测试音频只允许只读挂载的 /fixture/result.mp3");
        }
        byte[] audio = audioFile == null
                ? "ID3-cross-runtime-output".getBytes(StandardCharsets.UTF_8)
                : Files.readAllBytes(Path.of(audioFile));
        var submitted = new AtomicReference<String>();
        var base = new AtomicReference<String>();
        String oldFence = System.getenv("IKI68N_OLD_FENCE");
        if (oldFence != null) {
            assertThat(service.publishAudioMixResult(new com.bluewhale.worker.domain.dto.PublishMediaExtractDto(
                    jobId, "0", "9", "amix-stale", Long.parseLong(oldFence),
                    "https://stale.invalid/out.mp3", "generated/9/audio/stale.mp3", "audio/mpeg",
                    1L, "0123456789abcdef0123456789abcdef", 1.0))).isFalse();
            assertThat(countAssets(Long.parseLong(jobId))).isZero();
        }
        HttpServer gateway = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        gateway.createContext("/v1/mediakit/mix-audio", exchange -> {
            submitted.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"success\":true,\"task_id\":\"cross-task-1\",\"request_id\":\"request-cross\"}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) { output.write(response); }
        });
        gateway.createContext("/v1/mediakit/tasks/cross-task-1", exchange -> {
            byte[] response = (failPhase
                    ? "{\"status\":\"failed\",\"error\":{\"code\":\"provider_error\",\"message\":\"上游混音失败\"},\"request_id\":\"request-cross-fail\"}"
                    : "{\"status\":\"completed\",\"result\":{\"audio_url\":\""
                    + base.get() + "/temporary/out.mp3\",\"duration\":37.25}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) { output.write(response); }
        });
        gateway.createContext("/temporary/out.mp3", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "audio/mpeg");
            exchange.sendResponseHeaders(200, audio.length);
            try (var output = exchange.getResponseBody()) { output.write(audio); }
        });
        gateway.start();
        base.set("http://127.0.0.1:" + gateway.getAddress().getPort());
        try {
            assertThat(readJob(Long.parseLong(jobId)).getType()).isEqualTo("audio_mix");
            TosAudioMediaRelay relay = mock(TosAudioMediaRelay.class);
            when(relay.persist(anyString(), eq("9"), eq("mp3"))).thenAnswer(invocation -> {
                byte[] downloaded = java.net.URI.create((String) invocation.getArgument(0))
                        .toURL().openStream().readAllBytes();
                var request = java.net.http.HttpRequest.newBuilder(java.net.URI.create(storageUploadUrl))
                        .PUT(java.net.http.HttpRequest.BodyPublishers.ofByteArray(downloaded))
                        .header("Content-Type", "audio/mpeg").build();
                var response = java.net.http.HttpClient.newHttpClient().send(request,
                        java.net.http.HttpResponse.BodyHandlers.discarding());
                assertThat(response.statusCode()).isEqualTo(200);
                return new TosAudioMediaRelay.StoredAudio(storagePublicUrl,
                        "generated/9/audio/out.mp3", "audio/mpeg", (long) downloaded.length,
                        "0123456789abcdef0123456789abcdef");
            });
            GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
            var processor = new AudioMixJobProcessor(service, new GenerationCredentialService(),
                    new NewApiMediaKitMixAudioClient(new UpstreamBaseUrl(base.get())), relay, producer);
            processor.handle(jobId);
            assertThat(readJob(Long.parseLong(jobId)).getProviderTaskId()).isEqualTo("cross-task-1");
            var json = new com.fasterxml.jackson.databind.ObjectMapper();
            var frozen = json.readTree(readJob(Long.parseLong(jobId)).getInput()).path("inputs");
            var outbound = json.readTree(submitted.get());
            String expectedCountValue = System.getenv("IKI68N_CROSS_RUNTIME_EXPECTED_INPUT_COUNT");
            int expectedCount = expectedCountValue == null ? 2 : Integer.parseInt(expectedCountValue);
            assertThat(expectedCount).isIn(2, 4);
            assertThat(frozen.size()).isEqualTo(expectedCount);
            List<String> expectedUrls = IntStream.range(0, expectedCount)
                    .mapToObj(index -> frozen.get(index).path("url").asText())
                    .toList();
            assertThat(expectedUrls).allSatisfy(url -> assertThat(url).isNotBlank());
            assertThat(outbound.path("audio_urls")).isEqualTo(json.valueToTree(expectedUrls));
            assertThat(outbound.path("format").asText()).isEqualTo("mp3");
            verify(producer).enqueue(jobId, 5_000L);
            jdbc.update("UPDATE generation_jobs SET next_action_at=? WHERE id=?",
                    WorkerClock.now().minusSeconds(10), Long.parseLong(jobId));
            processor.handle(jobId);
            assertThat(readJob(Long.parseLong(jobId)).getStatus()).isEqualTo(failPhase ? "failed" : "succeeded");
            if (failPhase) {
                assertThat(readJob(Long.parseLong(jobId)).getError()).contains("request-cross-fail");
                assertThat(countAssets(Long.parseLong(jobId))).isZero();
                return;
            }
            assertThat(countAssets(Long.parseLong(jobId))).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT url FROM assets WHERE generation_job_id=?", String.class,
                    Long.parseLong(jobId))).isEqualTo(storagePublicUrl);
            assertThat(jdbc.queryForObject("SELECT duration_ms FROM assets WHERE generation_job_id=?", Integer.class,
                    Long.parseLong(jobId))).isEqualTo(37_250);
        } finally {
            gateway.stop(0);
        }
    }

}
