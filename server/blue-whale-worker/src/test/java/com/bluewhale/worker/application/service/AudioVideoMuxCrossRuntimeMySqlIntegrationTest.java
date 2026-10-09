package com.bluewhale.worker.application.service;

import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.bluewhale.worker.application.processor.AudioVideoMuxJobProcessor;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
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
import com.sun.net.httpserver.HttpServer;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.jdbc.core.JdbcTemplate;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AudioVideoMuxCrossRuntimeMySqlIntegrationTest {
    private static final String SOURCE_VIDEO_NAME = "my_vlog.mp4";

    private static AudioVideoMuxCrossRuntimeDbGuard.Target target;
    private static HikariDataSource dataSource;
    private static JobStateMachineService service;
    private static JobFinalizer finalizer;
    private static JdbcTemplate jdbc;
    private static GenerationJobMapper jobMapper;
    private static JobClaimService claimService;

    @BeforeAll
    static void boot() throws Exception {
        var env = System.getenv();
        Assumptions.assumeTrue(AudioVideoMuxCrossRuntimeDbGuard.requested(env), "未请求 IKIHPJ 跨端验收");
        target = AudioVideoMuxCrossRuntimeDbGuard.validate(env);
        AudioVideoMuxCrossRuntimeDbGuard.verifyMarker(target);

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(target.jdbcUrl());
        config.setUsername("test");
        config.setPassword("test");
        config.setMaximumPoolSize(5);
        config.addDataSourceProperty("connectionTimeZone", "Asia/Shanghai");
        config.addDataSourceProperty("forceConnectionTimeZoneToSession", "true");
        dataSource = new HikariDataSource(config);
        jdbc = new JdbcTemplate(dataSource);
        MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
        factory.setDataSource(dataSource);
        SqlSessionFactory session = factory.getObject();
        jobMapper = mapper(GenerationJobMapper.class, session);
        var extraMapper = mapper(GenerationJobExtraMapper.class, session);
        claimService = new JobClaimService(jobMapper, extraMapper);
        service = new JobStateMachineService(jobMapper,
                mapper(AssetMapper.class, session),
                mapper(GenerationJobLogMapper.class, session),
                mapper(ProjectEventMapper.class, session),
                mapper(GenerationOutputSlotMapper.class, session),
                mapper(SceneCardGenerationRecordMapper.class, session),
                mapper(StoryboardPreviewMapper.class, session),
                extraMapper);

        var assetMapper = mapper(AssetMapper.class, session);
        var jobLogMapper = mapper(GenerationJobLogMapper.class, session);
        var slotMapper = mapper(GenerationOutputSlotMapper.class, session);
        var events = new ProjectEventPublisher(mapper(ProjectEventMapper.class, session));
        finalizer = new JobFinalizer(jobMapper, assetMapper, jobLogMapper, slotMapper, extraMapper,
                new SceneCardGenerationRecordSync(slotMapper,
                        mapper(SceneCardGenerationRecordMapper.class, session), events),
                new StoryboardPreviewSync(slotMapper,
                        mapper(StoryboardPreviewMapper.class, session), events),
                events,
                JobSettlementPublisher.noop());
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
    @DisplayName("audio_video_mux 跨 Node/Java 贯通：消费真实业务 API 写入的同库任务")
    void audioVideoMuxCrossRuntimeBusinessApiToAsset() throws Exception {
        String jobId = target.jobId();
        if ("cancel".equals(System.getenv("IKIHPJ_CROSS_RUNTIME_PHASE"))) {
            assertThat(jdbc.queryForObject("SELECT cancel_requested_at FROM generation_jobs WHERE id=?",
                    java.sql.Timestamp.class, Long.parseLong(jobId))).isNotNull();
            var upstreamCredential = mock(UpstreamCredential.class);
            var gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
            var relay = mock(TosVideoMediaRelay.class);
            var producer = mock(GenerationMessageProducer.class);
            new AudioVideoMuxJobProcessor(service, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle(jobId);
            assertThat(readJob(Long.parseLong(jobId)).getStatus()).isEqualTo("cancelled");
            assertThat(countAssets(Long.parseLong(jobId))).isZero();
            verifyNoInteractions(upstreamCredential, gateway, relay, producer);
            return;
        }
        boolean failPhase = "fail".equals(System.getenv("IKIHPJ_CROSS_RUNTIME_PHASE"));
        String storageUploadUrl = target.storageUploadUrl();
        String storagePublicUrl = target.storagePublicUrl();
        byte[] video = "ftypisom-cross-runtime-output".getBytes(StandardCharsets.UTF_8);
        var submitted = new AtomicReference<String>();
        var base = new AtomicReference<String>();
        String oldFence = System.getenv("IKIHPJ_OLD_FENCE");
        if (oldFence != null) {
            assertThat(finalizer.publishAudioVideoMuxResult(new com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto(
                    jobId, "0", "9", "amux-stale", Long.parseLong(oldFence),
                    "https://stale.invalid/out.mp4", "generated/9/video/stale.mp4", "video/mp4",
                    1L, "0123456789abcdef0123456789abcdef", 1.0, "1920x1080", "12"))).isFalse();
            assertThat(countAssets(Long.parseLong(jobId))).isZero();
        }
        HttpServer gateway = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        gateway.createContext("/v1/mediakit/mux-audio-video", exchange -> {
            submitted.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"success\":true,\"task_id\":\"cross-task-1\",\"request_id\":\"request-cross\"}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) { output.write(response); }
        });
        gateway.createContext("/v1/mediakit/tasks/cross-task-1", exchange -> {
            byte[] response = (failPhase
                    ? "{\"status\":\"failed\",\"error\":{\"code\":\"provider_error\",\"message\":\"上游合成失败\"},\"request_id\":\"request-cross-fail\"}"
                    : "{\"status\":\"completed\",\"result\":{\"video_url\":\""
                    + base.get() + "/temporary/out.mp4\",\"duration\":227.0,\"resolution\":\"1920x1080\"}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) { output.write(response); }
        });
        gateway.createContext("/temporary/out.mp4", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "video/mp4");
            exchange.sendResponseHeaders(200, video.length);
            try (var output = exchange.getResponseBody()) { output.write(video); }
        });
        gateway.start();
        base.set("http://127.0.0.1:" + gateway.getAddress().getPort());
        try {
            assertThat(readJob(Long.parseLong(jobId)).getType()).isEqualTo("audio_video_mux");
            TosVideoMediaRelay relay = mock(TosVideoMediaRelay.class);
            when(relay.persistStreaming(anyString(), eq("9"), anyLong(), any(), any())).thenAnswer(invocation -> {
                byte[] downloaded = java.net.URI.create((String) invocation.getArgument(0))
                        .toURL().openStream().readAllBytes();
                var request = java.net.http.HttpRequest.newBuilder(java.net.URI.create(storageUploadUrl))
                        .PUT(java.net.http.HttpRequest.BodyPublishers.ofByteArray(downloaded))
                        .header("Content-Type", "video/mp4").build();
                var response = java.net.http.HttpClient.newHttpClient().send(request,
                        java.net.http.HttpResponse.BodyHandlers.discarding());
                assertThat(response.statusCode()).isEqualTo(200);
                return new TosVideoMediaRelay.StoredVideo(storagePublicUrl,
                        "generated/9/video/out.mp4", "video/mp4", (long) downloaded.length,
                        "0123456789abcdef0123456789abcdef");
            });
            GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
            UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
            when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
            var processor = new AudioVideoMuxJobProcessor(service, claimService, jobMapper, finalizer,
                    upstreamCredential,
                    new NewApiMediaKitMuxAudioVideoClient(new UpstreamBaseUrl(base.get())), relay, producer);
            processor.handle(jobId);
            assertThat(readJob(Long.parseLong(jobId)).getProviderTaskId()).isEqualTo("cross-task-1");
            var json = new com.fasterxml.jackson.databind.ObjectMapper();
            var frozen = json.readTree(readJob(Long.parseLong(jobId)).getInput());
            var outbound = json.readTree(submitted.get());

            assertThat(outbound.path("model").asText()).isEqualTo("mediakit-mux-audio-video");
            assertThat(outbound.path("video_url").asText()).isEqualTo(frozen.path("video").path("url").asText());
            assertThat(outbound.path("audio_url").asText()).isEqualTo(frozen.path("audio").path("url").asText());
            assertThat(outbound.path("is_audio_reserve").asBoolean())
                    .isEqualTo(frozen.path("is_audio_reserve").asBoolean());
            assertThat(outbound.path("client_token").asText()).isEqualTo("bwmux-" + jobId + "-1");
            assertThat(outbound.has("media_output_destination")).isFalse();
            assertThat(outbound.has("callback_url")).isFalse();
            assertThat(outbound.has("queue_id")).isFalse();
            String sync = frozen.path("sync").asText();
            if ("none".equals(sync)) {
                assertThat(outbound.has("is_video_audio_sync")).isFalse();
                assertThat(outbound.has("sync_mode")).isFalse();
                assertThat(outbound.has("sync_method")).isFalse();
            } else {
                assertThat(outbound.path("is_video_audio_sync").asBoolean()).isTrue();
                assertThat(outbound.path("sync_mode").asText()).isEqualTo(sync);
                assertThat(outbound.path("sync_method").asText()).isEqualTo("trim");
            }
            verify(producer).enqueue(jobId, 5_000L);
            jdbc.update("UPDATE generation_jobs SET next_action_at=? WHERE id=?",
                    LocalDateTime.now().minusSeconds(10), Long.parseLong(jobId));
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
                    Long.parseLong(jobId))).isEqualTo(227_000);
            assertThat(jdbc.queryForObject("SELECT width FROM assets WHERE generation_job_id=?", Integer.class,
                    Long.parseLong(jobId))).isEqualTo(1920);
            assertThat(jdbc.queryForObject("SELECT height FROM assets WHERE generation_job_id=?", Integer.class,
                    Long.parseLong(jobId))).isEqualTo(1080);
            assertThat(jdbc.queryForObject("SELECT name FROM assets WHERE generation_job_id=?", String.class,
                    Long.parseLong(jobId))).isEqualTo(
                    SOURCE_VIDEO_NAME.substring(0, SOURCE_VIDEO_NAME.lastIndexOf('.')) + "(音视频合成).mp4");
        } finally {
            gateway.stop(0);
        }
    }
}
