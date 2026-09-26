package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.application.service.WorkerClock;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient.MuxAudioVideoTaskObservation;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import com.sun.net.httpserver.HttpServer;
import com.volcengine.tos.TOSV2;
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
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 音视频合成结果转存的**真实流式**集成测试（IKILVH）：Worker 处理器 + 真实
 * {@link TosVideoMediaRelay}（仅 TOS 签名走 mock、上传走本地 HTTP 桩）+ 受控慢速/停滞源 +
 * 失租/取消信号——不复刻「模拟转存函数返回值」的单测口径，端到端钉四条路径：
 * <ol>
 *   <li>受控慢流持续有进度 → 转存完成并发布**长期 Asset**（供应商临时 URL 不充当最终产物）</li>
 *   <li>停滞源 + 心跳失租 → 转存及时中止：不发布、不落普通失败终态（recovery 兜底）</li>
 *   <li>停滞源 + 用户取消 → 转存及时中止（cancelled 终态由取消检查落，不写失败）</li>
 *   <li>任务截止时间（execution_deadline_at）到点 → 明确失败终态，文案独立命名</li>
 * </ol>
 * 容量超限（> maxBytes）路径在本规模无法真实化（本家族上限 10 GiB 常量，源桩发不完），由
 * {@code TosVideoMediaRelayTest#persistStreaming_rejectsResultOverCallerCap} 以注入小上限
 * 真实流式覆盖。
 * <p>
 * 缩比口径说明：受控慢流 64KiB/100ms ≈ 0.6MiB/s、总转存时长 ~1.2s——「持续有进度且未过
 * 截止时间即可完成」的语义已端到端验证；线上 10 GiB 能否在任务截止时间内完成取决于实际
 * 吞吐（10GiB@2MiB/s ≈ 85 分钟），本套件不宣称线上任意速率均可完成 10 GiB。
 */
class AudioVideoMuxStreamingTransferTest {

    private static final int BLOCK_BYTES = 64 * 1024;
    private static final int BLOCK_COUNT = 12;

    private HttpServer sourceServer;
    private HttpServer uploadServer;
    private final CountDownLatch releaseStall = new CountDownLatch(1);
    private final AtomicLong uploadedBytes = new AtomicLong();

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
                "submit_attempt", 1L,
                "provider_credential", "sk-frozen");
    }

    /** 受控慢速源：块间 sleep——持续有进度但速率受限（真实 HTTP/TCP 流式读写）。 */
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

    /** 停滞源：响应头 + 64KiB 首块后挂住连接（转存必然阻塞在下一个 read 上）。 */
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

    /** TOS 替身：preSignedURL 走 mock 指向本地上传桩，上传字节真实流式送达并计数。 */
    private TOSV2 tosStandin() throws IOException {
        uploadServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        uploadServer.createContext("/", exchange -> {
            try (InputStream in = exchange.getRequestBody()) {
                byte[] buffer = new byte[64 * 1024];
                long total = 0;
                int read;
                while ((read = in.read(buffer)) != -1) total += read;
                uploadedBytes.set(total);
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
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        // 截止时间给足（10 分钟）：慢流合法传输不受总时限约束，heartbeat 50ms 全程续租命中
        ClaimedMediaExtractJobDto claim = new ClaimedMediaExtractJobDto("70", "5", "9", frozenInput(),
                "provider-1", "worker-1", 3L, 0, 0, WorkerClock.now(), WorkerClock.now().plusMinutes(10));
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", sourceUrl,
                        227.0, "1920x1080", null, null, null));
        AtomicInteger renewals = new AtomicInteger();
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L)))
                .thenAnswer(invocation -> renewals.incrementAndGet() > 0);
        when(stateMachine.publishAudioVideoMuxResult(any())).thenReturn(true);
        var processor = new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 50;
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        processor.handle("70");

        // 真实流式端到端：下载 768KiB 慢流 + 上传全部送达 TOS 替身；发布的 url 是自有 bucket
        // 公开地址（供应商临时链接只作下载源，不充当最终产物）
        assertThat(Duration.ofNanos(System.nanoTime() - startNanos).toMillis()).isGreaterThan(1_000);
        ArgumentCaptor<PublishAudioVideoMuxDto> published = ArgumentCaptor.forClass(PublishAudioVideoMuxDto.class);
        verify(stateMachine).publishAudioVideoMuxResult(published.capture());
        assertThat(published.getValue().url()).startsWith("https://bkt.tos.example.com/generated/9/video/");
        assertThat(published.getValue().url()).isNotEqualTo(sourceUrl);
        assertThat(published.getValue().size()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        assertThat(published.getValue().sourceVideoAssetId()).isEqualTo("12");
        assertThat(uploadedBytes.get()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        // 转存时长跨多个心跳窗（~1.2s / 50ms 心跳），所有权全程保持
        verify(stateMachine, atLeast(3)).renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L));
        verify(stateMachine, never()).failMediaExtractJob(any());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(15)
    @DisplayName("停滞源 + 心跳失租：真实转存及时中止——不发布、不落普通失败终态（recovery 兜底）、临时文件清理")
    void stalledTransferWithLostLeaseAbortsInTime() throws Exception {
        String sourceUrl = serveStalled();
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosStandin(), "bkt", "tos.example.com");
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        ClaimedMediaExtractJobDto claim = new ClaimedMediaExtractJobDto("70", "5", "9", frozenInput(),
                "provider-1", "worker-1", 3L, 0, 0, WorkerClock.now(), WorkerClock.now().plusMinutes(10));
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", sourceUrl,
                        227.0, "1920x1080", null, null, null));
        // 转存前续租命中；心跳里失租（recovery 已重新领取）→ abort 打断停滞中的真实下载
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true, false);
        when(stateMachine.publishAudioVideoMuxResult(any())).thenReturn(true);
        var processor = new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 50;
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        processor.handle("70");

        // 及时性即证明：失租后一个心跳窗（50ms）内中止，不是等停流超时（60s）或对端断连
        assertThat(Duration.ofNanos(System.nanoTime() - startNanos))
                .isLessThan(Duration.ofSeconds(5));
        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
        // 失租不写成普通失败终态：任务由新执行者 / recovery 按既有 fencing 规则接管
        verify(stateMachine, never()).failMediaExtractJob(any());
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
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        ClaimedMediaExtractJobDto claim = new ClaimedMediaExtractJobDto("70", "5", "9", frozenInput(),
                "provider-1", "worker-1", 3L, 0, 0, WorkerClock.now(), WorkerClock.now().plusMinutes(10));
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim));
        // runStep 入口 + poll 观察后 + 续租前共三次未命中；心跳里第四次命中取消
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, false, false, true, true);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", sourceUrl,
                        227.0, "1920x1080", null, null, null));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(stateMachine.publishAudioVideoMuxResult(any())).thenReturn(true);
        var processor = new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 50;
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        processor.handle("70");

        assertThat(Duration.ofNanos(System.nanoTime() - startNanos))
                .isLessThan(Duration.ofSeconds(5));
        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
        verify(stateMachine, never()).failMediaExtractJob(any());
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
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        // 截止 300ms：慢流总长 ~1.2s，中途必撞截止 → 明确失败（区别于失租/取消的静默退出）
        ClaimedMediaExtractJobDto claim = new ClaimedMediaExtractJobDto("70", "5", "9", frozenInput(),
                "provider-1", "worker-1", 3L, 0, 0, WorkerClock.now(), WorkerClock.now().plusNanos(300_000_000));
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", sourceUrl,
                        227.0, "1920x1080", null, null, null));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);
        var processor = new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 50;
        List<String> tempBefore = relayTempFiles();

        processor.handle("70");

        // 截止到点 = 明确结果（任务预算耗尽落失败终态），不发布
        verify(stateMachine).failMediaExtractJob(org.mockito.ArgumentMatchers.argThat(failure ->
                failure.message() != null && failure.message().contains("任务执行截止时间已到")));
        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
        assertThat(uploadedBytes.get()).isEqualTo(0);
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }
}
