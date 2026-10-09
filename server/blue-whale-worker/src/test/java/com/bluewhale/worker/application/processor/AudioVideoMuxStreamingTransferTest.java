package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.application.service.WorkerClock;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient.MuxAudioVideoTaskObservation;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import com.sun.net.httpserver.HttpServer;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.model.object.DeleteObjectInput;
import com.volcengine.tos.model.object.PreSignedURLInput;
import com.volcengine.tos.model.object.PreSignedURLOutput;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.mockito.ArgumentCaptor;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AudioVideoMuxStreamingTransferTest {

    private static final int BLOCK_BYTES = 64 * 1024;
    private static final int BLOCK_COUNT = 12;

    private HttpServer sourceServer;
    private HttpServer uploadServer;
    private final CountDownLatch releaseStall = new CountDownLatch(1);
    private final AtomicLong uploadedBytes = new AtomicLong();
    private final ConcurrentHashMap<String, byte[]> tosObjects = new ConcurrentHashMap<>();
    private final JobClaimService claimService = mock(JobClaimService.class);
    private final GenerationJobMapper jobMapper = mock(GenerationJobMapper.class);

    private static byte[] patternBlock() {
        byte[] block = new byte[BLOCK_BYTES];
        for (int i = 0; i < BLOCK_BYTES; i++) block[i] = (byte) (i % 251);
        return block;
    }

    private static Map<String, Object> frozenInput() {
        return Map.of(
                "audio", Map.of("assetId", "11", "nodeId", "source-node", "url", "https://tos/a.mp3"),
                "video", Map.of("assetId", "12", "url", "https://tos/v.mp4"),
                "is_audio_reserve", true,
                "sync", "none",
                "submit_attempt", 1L);
    }

    private String serveSlow() throws IOException {
        byte[] block = patternBlock();
        sourceServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        sourceServer.createContext("/", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "video/webm");
            exchange.sendResponseHeaders(200, (long) BLOCK_BYTES * BLOCK_COUNT);
            try (OutputStream out = exchange.getResponseBody()) {
                for (int i = 0; i < BLOCK_COUNT; i++) {
                    out.write(block, 0, BLOCK_BYTES);
                    out.flush();
                    Thread.sleep(100);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        sourceServer.start();
        return "http://127.0.0.1:" + sourceServer.getAddress().getPort() + "/out.webm";
    }

    private String serveStalled() throws IOException {
        byte[] block = patternBlock();
        sourceServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        sourceServer.createContext("/", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "video/webm");
            exchange.sendResponseHeaders(200, 8L * 1024 * 1024);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(block, 0, BLOCK_BYTES);
                out.flush();
                releaseStall.await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        sourceServer.start();
        return "http://127.0.0.1:" + sourceServer.getAddress().getPort() + "/out.webm";
    }

    private TOSV2 tosStandin() throws IOException {
        uploadServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        uploadServer.createContext("/", exchange -> {
            String key = exchange.getRequestURI().getPath().substring(1);
            try (InputStream in = exchange.getRequestBody()) {
                byte[] body = in.readAllBytes();
                tosObjects.put(key, body);
                uploadedBytes.set(body.length);
                exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
                exchange.sendResponseHeaders(200, -1);
            } finally {
                exchange.close();
            }
        });
        uploadServer.start();
        TOSV2 client = mock(TOSV2.class);
        when(client.preSignedURL(any(PreSignedURLInput.class))).thenAnswer(invocation -> {
            PreSignedURLInput input = invocation.getArgument(0);
            return new PreSignedURLOutput("http://127.0.0.1:" + uploadServer.getAddress().getPort()
                    + "/" + input.getKey(), input.getHeader());
        });
        doAnswer(invocation -> {
            DeleteObjectInput input = invocation.getArgument(0);
            tosObjects.remove(input.getKey());
            return null;
        }).when(client).deleteObject(any(DeleteObjectInput.class));
        return client;
    }

    private static List<String> relayTempFiles() throws IOException {
        Path tmp = Path.of(System.getProperty("java.io.tmpdir"));
        try (var files = Files.list(tmp)) {
            return files.map(path -> path.getFileName().toString())
                    .filter(name -> name.startsWith("video-relay-"))
                    .sorted()
                    .toList();
        }
    }

    @AfterEach
    void stopServers() {
        releaseStall.countDown();
        if (uploadServer != null) uploadServer.stop(0);
        if (sourceServer != null) sourceServer.stop(0);
    }

    @Test
    @Timeout(30)
    @DisplayName("受控慢流持续有进度：处理器全程心跳续租，转存完成并发布长期 Asset（临时链接不充当最终产物）")
    void slowStreamingTransferCompletesAndPublishesLongTermAsset() throws Exception {
        String sourceUrl = serveSlow();
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosStandin(), "bkt", "tos.example.com");
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        ClaimedJob claim = new ClaimedJob(
                "70", "5", "9", frozenInput(), "audio_video_mux", "provider-1", false, "worker-1", 3L, 0, 0,
                WorkerClock.now(), WorkerClock.now().plusMinutes(10), null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", sourceUrl,
                        227.0, "1920x1080", null, null, null));
        AtomicInteger renewals = new AtomicInteger();
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L)))
                .thenAnswer(invocation -> renewals.incrementAndGet() > 0);
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(true);
        var processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 50;
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        processor.handle("70");

        assertThat(Duration.ofNanos(System.nanoTime() - startNanos).toMillis()).isGreaterThan(1_000);
        ArgumentCaptor<PublishAudioVideoMuxDto> published = ArgumentCaptor.forClass(PublishAudioVideoMuxDto.class);
        verify(finalizer).publishAudioVideoMuxResult(published.capture());
        assertThat(published.getValue().url()).startsWith("https://bkt.tos.example.com/generated/9/video/");
        assertThat(published.getValue().url()).isNotEqualTo(sourceUrl);
        assertThat(published.getValue().size()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        assertThat(published.getValue().sourceVideoAssetId()).isEqualTo("12");
        assertThat(uploadedBytes.get()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        verify(stateMachine, atLeast(3)).renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L));
        verify(finalizer, never()).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(15)
    @DisplayName("停滞源 + 心跳失租：真实转存及时中止——不发布、不落普通失败终态（recovery 兜底）、临时文件清理")
    void stalledTransferWithLostLeaseAbortsInTime() throws Exception {
        String sourceUrl = serveStalled();
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosStandin(), "bkt", "tos.example.com");
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        ClaimedJob claim = new ClaimedJob(
                "70", "5", "9", frozenInput(), "audio_video_mux", "provider-1", false, "worker-1", 3L, 0, 0,
                WorkerClock.now(), WorkerClock.now().plusMinutes(10), null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", sourceUrl,
                        227.0, "1920x1080", null, null, null));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true, false);
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(true);
        var processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 50;
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        processor.handle("70");

        assertThat(Duration.ofNanos(System.nanoTime() - startNanos))
                .isLessThan(Duration.ofSeconds(5));
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        assertThat(uploadedBytes.get()).isEqualTo(0);
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(15)
    @DisplayName("停滞源 + 用户取消：真实转存及时中止——不发布、不写普通失败（cancelled 终态由取消检查落）")
    void stalledTransferWithCancellationAbortsInTime() throws Exception {
        String sourceUrl = serveStalled();
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosStandin(), "bkt", "tos.example.com");
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        ClaimedJob claim = new ClaimedJob(
                "70", "5", "9", frozenInput(), "audio_video_mux", "provider-1", false, "worker-1", 3L, 0, 0,
                WorkerClock.now(), WorkerClock.now().plusMinutes(10), null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, false, false, true, true);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", sourceUrl,
                        227.0, "1920x1080", null, null, null));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(true);
        var processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 50;
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        processor.handle("70");

        assertThat(Duration.ofNanos(System.nanoTime() - startNanos))
                .isLessThan(Duration.ofSeconds(5));
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        assertThat(uploadedBytes.get()).isEqualTo(0);
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(15)
    @DisplayName("任务截止时间到点：慢流转存被明确中止并落失败终态，文案独立命名（区别于停流/超限/失租）")
    void taskDeadlineReachedFailsTheTransferWithDistinctMessage() throws Exception {
        String sourceUrl = serveSlow();
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosStandin(), "bkt", "tos.example.com");
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        ClaimedJob claim = new ClaimedJob(
                "70", "5", "9", frozenInput(), "audio_video_mux", "provider-1", false, "worker-1", 3L, 0, 0,
                WorkerClock.now(), WorkerClock.now().plusNanos(300_000_000), null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", sourceUrl,
                        227.0, "1920x1080", null, null, null));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.failMediaExtractJob(any(), any(), any(), any(), any(), anyLong())).thenReturn(true);
        var processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 50;
        List<String> tempBefore = relayTempFiles();

        processor.handle("70");

        verify(finalizer).failMediaExtractJob(any(), any(),
                org.mockito.ArgumentMatchers.argThat(message ->
                        message != null && message.contains("任务执行截止时间已到")),
                any(), any(), anyLong());
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        assertThat(uploadedBytes.get()).isEqualTo(0);
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }


    private TOSV2 fullyTransferredFixture(JobStateMachineService stateMachine,
                                          UpstreamCredential upstreamCredential,
                                          NewApiMediaKitMuxAudioVideoClient gateway,
                                          GenerationMessageProducer producer,
                                          String sourceUrl) throws IOException {
        TOSV2 tosClient = tosStandin();
        ClaimedJob claim = new ClaimedJob(
                "70", "5", "9", frozenInput(), "audio_video_mux", "provider-1", false, "worker-1", 3L, 0, 0,
                WorkerClock.now(), WorkerClock.now().plusMinutes(10), null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", sourceUrl,
                        227.0, "1920x1080", null, null, null));
        return tosClient;
    }

    private AudioVideoMuxJobProcessor quietHeartbeatProcessor(JobStateMachineService stateMachine,
                                                              JobFinalizer finalizer,
                                                              UpstreamCredential upstreamCredential,
                                                              NewApiMediaKitMuxAudioVideoClient gateway,
                                                              TosVideoMediaRelay relay,
                                                              GenerationMessageProducer producer) {
        var processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 5_000;
        return processor;
    }

    @Test
    @Timeout(30)
    @DisplayName("真实转存成功后失租：发布前放弃 → 权威核实未引用 → TOS 替身收到 deleteObject（key=本次上传）；不发布不失败")
    void realTransferThenLeaseLostBeforePublishCleansUpTheUploadedTosObject() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, upstreamCredential, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true, false);
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        assertThat(uploadedBytes.get()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        var deleted = ArgumentCaptor.forClass(DeleteObjectInput.class);
        verify(tosClient).deleteObject(deleted.capture());
        assertThat(deleted.getValue().getBucket()).isEqualTo("bkt");
        assertThat(deleted.getValue().getKey()).isEqualTo(uploaded.getValue().getKey());
        assertThat(deleted.getValue().getKey()).startsWith("generated/9/video/");
        assertThat(tosObjects).doesNotContainKey(uploaded.getValue().getKey());
        verify(finalizer).hasPublishedAsset("70", uploaded.getValue().getKey());
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("真实转存 + 发布成功：TOS 对象保留为已发布成品，Asset 与对象一致，绝不 deleteObject")
    void realTransferPublishedKeepsTheTosObject() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, upstreamCredential, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(true);
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        ArgumentCaptor<PublishAudioVideoMuxDto> published = ArgumentCaptor.forClass(PublishAudioVideoMuxDto.class);
        verify(finalizer).publishAudioVideoMuxResult(published.capture());
        assertThat(published.getValue().storageKey()).isEqualTo(uploaded.getValue().getKey());
        assertThat(published.getValue().size()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        assertThat(uploadedBytes.get()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        assertThat(tosObjects).containsKey(uploaded.getValue().getKey());
        assertThat(tosObjects.get(uploaded.getValue().getKey())).hasSize(BLOCK_BYTES * BLOCK_COUNT);
        verify(finalizer, never()).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("守卫拒绝但权威核实发现 Asset 已引用：保留对象（迟到清理不删已发布成品）")
    void realTransferGuardRejectionKeepsObjectWhenAuthorityConfirmsReference() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, upstreamCredential, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(false);
        when(finalizer.hasPublishedAsset(eq("70"), anyString())).thenReturn(true);
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        verify(finalizer).hasPublishedAsset("70", uploaded.getValue().getKey());
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        verify(finalizer, never()).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        assertThat(tosObjects).containsKey(uploaded.getValue().getKey());
        assertThat(uploadedBytes.get()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("发布抛异常但权威核实确认事务已提交（Asset 已引用）：保留对象，异常仍走既有 fail 终态")
    void realTransferPublishExceptionKeepsCommittedObject() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, upstreamCredential, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any()))
                .thenThrow(new RuntimeException("发布事务结果不明"));
        when(finalizer.hasPublishedAsset(eq("70"), anyString())).thenReturn(true);
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        verify(finalizer).hasPublishedAsset("70", uploaded.getValue().getKey());
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        assertThat(tosObjects).containsKey(uploaded.getValue().getKey());
        verify(finalizer).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("发布抛异常且权威核实确认未发布：清理本次上传的 TOS 对象（对象确实被删，key 精确匹配）")
    void realTransferPublishExceptionCleansUpWhenUnpublished() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, upstreamCredential, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any()))
                .thenThrow(new RuntimeException("发布事务结果不明"));
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        var deleted = ArgumentCaptor.forClass(DeleteObjectInput.class);
        verify(tosClient).deleteObject(deleted.capture());
        assertThat(deleted.getValue().getKey()).isEqualTo(uploaded.getValue().getKey());
        assertThat(tosObjects).doesNotContainKey(uploaded.getValue().getKey());
        verify(finalizer).hasPublishedAsset("70", uploaded.getValue().getKey());
        verify(finalizer).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("发布异常 + 在飞发布事务于重查窗口内提交：对象不删（权威引用已出现），异常仍走 fail 终态")
    void realTransferPublishExceptionWithCommittingTransactionKeepsObjectUntilReferenced() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, upstreamCredential, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any()))
                .thenThrow(new RuntimeException("发布事务提交窗口断连"));
        when(finalizer.hasInFlightJobWriteTransaction("70")).thenReturn(true, false);
        when(finalizer.hasPublishedAsset(eq("70"), anyString())).thenReturn(true);
        when(finalizer.failMediaExtractJob(any(), any(), any(), any(), any(), anyLong())).thenReturn(true);
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        verify(finalizer, org.mockito.Mockito.times(2)).hasInFlightJobWriteTransaction("70");
        verify(finalizer, org.mockito.Mockito.times(1)).hasPublishedAsset("70", uploaded.getValue().getKey());
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        assertThat(tosObjects).containsKey(uploaded.getValue().getKey());
        assertThat(tosObjects.get(uploaded.getValue().getKey())).hasSize(BLOCK_BYTES * BLOCK_COUNT);
        verify(finalizer).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("TOS 删除失败：删除动作仍发生（留对象身份与错误记录），失租静默退出不变、无临时文件残留")
    void realTransferTosDeleteFailureKeepsSilentExitAndCleansTempFiles() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, upstreamCredential, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true, false);
        doThrow(new RuntimeException("TOS 删除 5xx")).when(tosClient).deleteObject(any(DeleteObjectInput.class));
        List<String> tempBefore = relayTempFiles();

        assertThatCode(() ->
                quietHeartbeatProcessor(stateMachine, finalizer, upstreamCredential, gateway, relay, producer).handle("70"))
                .doesNotThrowAnyException();

        verify(tosClient).deleteObject(any(DeleteObjectInput.class));
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).failMediaExtractJob(any(), any(), any(), any(), any(), anyLong());
        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        assertThat(tosObjects).containsKey(uploaded.getValue().getKey());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }


    @Test
    @Timeout(30)
    @DisplayName("真实转存返回唯一键后取消状态查询异常（DB 断连）：对象被清理（真删）、不发布不产生 Asset，异常走既有 fail 终态")
    void realTransferThenCancelQueryErrorCleansUpTheUploadedTosObject() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        JobFinalizer finalizer = mock(JobFinalizer.class);
        UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = tosStandin();
        ClaimedJob claim = new ClaimedJob(
                "70", "5", "9", frozenInput(), "audio_video_mux", "provider-1", false, "worker-1", 3L, 0, 0,
                WorkerClock.now(), WorkerClock.now().plusMinutes(10), null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, false, false)
                .thenThrow(new RuntimeException("取消状态查询 DB 断连"));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", sourceUrl,
                        227.0, "1920x1080", null, null, null));
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.failMediaExtractJob(any(), any(), any(), any(), any(), anyLong())).thenReturn(true);
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        var deleted = ArgumentCaptor.forClass(DeleteObjectInput.class);
        verify(tosClient).deleteObject(deleted.capture());
        assertThat(deleted.getValue().getBucket()).isEqualTo("bkt");
        assertThat(deleted.getValue().getKey()).isEqualTo(uploaded.getValue().getKey());
        assertThat(tosObjects).doesNotContainKey(uploaded.getValue().getKey());
        assertThat(uploadedBytes.get()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer).hasPublishedAsset("70", uploaded.getValue().getKey());
        verify(finalizer, never()).hasInFlightJobWriteTransaction(anyString());
        ArgumentCaptor<String> failCode = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> failMessage = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(any(), failCode.capture(), failMessage.capture(),
                any(), any(), anyLong());
        assertThat(failCode.getValue()).isEqualTo("audio_video_mux_failed");
        assertThat(failMessage.getValue()).contains("取消状态查询 DB 断连");
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }
}
