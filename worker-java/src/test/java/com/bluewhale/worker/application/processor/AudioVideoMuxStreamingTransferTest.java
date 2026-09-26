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
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
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
    /** 有状态 TOS 替身的对象表（IKIN8Z）：key → 字节；deleteObject 查表真删，断言以对象存在性为准。 */
    private final ConcurrentHashMap<String, byte[]> tosObjects = new ConcurrentHashMap<>();

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

    /** TOS 替身（有状态）：preSignedURL 走 mock 指向本地上传桩，上传字节真实流式送达并按
     *  key 落对象表；deleteObject 查表真删——发布异常系列的清理断言以对象存在性为准，
     *  不再只 verify 删除接口调用次数。 */
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

    // ========== IKIN03：转存成功返回后 → 发布前的未发布对象清理（真实 relay + TOS 替身） ==========

    /** 真实转存 + 发布链的受控替身夹具：慢流源完整转存（768KiB 真实送达 TOS 替身）。 */
    private TOSV2 fullyTransferredFixture(JobStateMachineService stateMachine,
                                          GenerationCredentialService credentials,
                                          NewApiMediaKitMuxAudioVideoClient gateway,
                                          GenerationMessageProducer producer,
                                          String sourceUrl) throws IOException {
        TOSV2 tosClient = tosStandin();
        ClaimedMediaExtractJobDto claim = new ClaimedMediaExtractJobDto("70", "5", "9", frozenInput(),
                "provider-1", "worker-1", 3L, 0, 0, WorkerClock.now(), WorkerClock.now().plusMinutes(10));
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", sourceUrl,
                        227.0, "1920x1080", null, null, null));
        return tosClient;
    }

    /** 心跳窗拉长到 5s（转存 ~1.2s 内不触发）：让「转存后」分支由打桩的续租/发布返回值确定性控制。 */
    private AudioVideoMuxJobProcessor quietHeartbeatProcessor(JobStateMachineService stateMachine,
                                                              GenerationCredentialService credentials,
                                                              NewApiMediaKitMuxAudioVideoClient gateway,
                                                              TosVideoMediaRelay relay,
                                                              GenerationMessageProducer producer) {
        var processor = new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 5_000;
        return processor;
    }

    @Test
    @Timeout(30)
    @DisplayName("真实转存成功后失租：发布前放弃 → 权威核实未引用 → TOS 替身收到 deleteObject（key=本次上传）；不发布不失败")
    void realTransferThenLeaseLostBeforePublishCleansUpTheUploadedTosObject() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, credentials, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        // 转存前续租命中；转存成功返回后续租未命中（已被接管/终态）→ 发布前放弃并清理
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true, false);
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        // 该次上传真实完整送达过 TOS 替身（对象确实存在），清理必须精确指向本次上传的 key
        assertThat(uploadedBytes.get()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        var deleted = ArgumentCaptor.forClass(DeleteObjectInput.class);
        verify(tosClient).deleteObject(deleted.capture());
        assertThat(deleted.getValue().getBucket()).isEqualTo("bkt");
        assertThat(deleted.getValue().getKey()).isEqualTo(uploaded.getValue().getKey());
        assertThat(deleted.getValue().getKey()).startsWith("generated/9/video/");
        // 对象存在性（有状态替身真删）：该次上传对象清理后确实不存在
        assertThat(tosObjects).doesNotContainKey(uploaded.getValue().getKey());
        // 旧执行者 fencing：不生成 Asset、不把失租写成普通失败终态（hasPublishedAsset 默认未引用）
        verify(stateMachine).hasPublishedAsset("70", uploaded.getValue().getKey());
        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
        verify(stateMachine, never()).failMediaExtractJob(any());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("真实转存 + 发布成功：TOS 对象保留为已发布成品，Asset 与对象一致，绝不 deleteObject")
    void realTransferPublishedKeepsTheTosObject() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, credentials, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(stateMachine.publishAudioVideoMuxResult(any())).thenReturn(true);
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        // Asset 与 GenerationJob 结果一致：发布的 storageKey 即本次真实上传的 key
        ArgumentCaptor<PublishAudioVideoMuxDto> published = ArgumentCaptor.forClass(PublishAudioVideoMuxDto.class);
        verify(stateMachine).publishAudioVideoMuxResult(published.capture());
        assertThat(published.getValue().storageKey()).isEqualTo(uploaded.getValue().getKey());
        assertThat(published.getValue().size()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        assertThat(uploadedBytes.get()).isEqualTo((long) BLOCK_BYTES * BLOCK_COUNT);
        // 对象存在性：已发布成品完整保留在 TOS 替身
        assertThat(tosObjects).containsKey(uploaded.getValue().getKey());
        assertThat(tosObjects.get(uploaded.getValue().getKey())).hasSize(BLOCK_BYTES * BLOCK_COUNT);
        verify(stateMachine, never()).failMediaExtractJob(any());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("守卫拒绝但权威核实发现 Asset 已引用：保留对象（迟到清理不删已发布成品）")
    void realTransferGuardRejectionKeepsObjectWhenAuthorityConfirmsReference() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, credentials, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(stateMachine.publishAudioVideoMuxResult(any())).thenReturn(false);
        // 权威核实替身：该 job 的转存对象已被 Asset 引用（发布事务已提交）→ 保留
        when(stateMachine.hasPublishedAsset(eq("70"), anyString())).thenReturn(true);
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        verify(stateMachine).hasPublishedAsset("70", uploaded.getValue().getKey());
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        verify(stateMachine, never()).failMediaExtractJob(any());
        // 成品完整保留在 TOS 替身（对象存在性，非仅删除接口未调用）
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
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, credentials, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(stateMachine.publishAudioVideoMuxResult(any()))
                .thenThrow(new RuntimeException("发布事务结果不明"));
        // 提交结果不明：先核实权威状态——已被 Asset 引用（事务实际已提交）则保留
        when(stateMachine.hasPublishedAsset(eq("70"), anyString())).thenReturn(true);
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        verify(stateMachine).hasPublishedAsset("70", uploaded.getValue().getKey());
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        // 对象存在性：提交后 Asset 引用的对象仍存在（迟到清理不删已发布成品）
        assertThat(tosObjects).containsKey(uploaded.getValue().getKey());
        // 异常继续上抛走既有 fail 终态路径（守卫仍 fencing），不吞异常
        verify(stateMachine).failMediaExtractJob(any());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("发布抛异常且权威核实确认未发布：清理本次上传的 TOS 对象（对象确实被删，key 精确匹配）")
    void realTransferPublishExceptionCleansUpWhenUnpublished() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, credentials, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(stateMachine.publishAudioVideoMuxResult(any()))
                .thenThrow(new RuntimeException("发布事务结果不明"));
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        var deleted = ArgumentCaptor.forClass(DeleteObjectInput.class);
        verify(tosClient).deleteObject(deleted.capture());
        assertThat(deleted.getValue().getKey()).isEqualTo(uploaded.getValue().getKey());
        // 对象存在性（有状态替身真删）：确认不会再被提交且无引用 → 该次上传对象清理后确实不存在
        assertThat(tosObjects).doesNotContainKey(uploaded.getValue().getKey());
        verify(stateMachine).hasPublishedAsset("70", uploaded.getValue().getKey());
        verify(stateMachine).failMediaExtractJob(any());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("发布异常 + 在飞发布事务于重查窗口内提交：对象不删（权威引用已出现），异常仍走 fail 终态")
    void realTransferPublishExceptionWithCommittingTransactionKeepsObjectUntilReferenced() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, credentials, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(stateMachine.publishAudioVideoMuxResult(any()))
                .thenThrow(new RuntimeException("发布事务提交窗口断连"));
        // 受控交错：首轮探测 = 发布事务仍在服务端进行（Asset 行尚不可见）；短延时重查 =
        // 事务已提交结束，权威查询命中 Asset 引用 → 保留对象
        when(stateMachine.hasInFlightJobWriteTransaction("70")).thenReturn(true, false);
        when(stateMachine.hasPublishedAsset(eq("70"), anyString())).thenReturn(true);
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);
        List<String> tempBefore = relayTempFiles();

        quietHeartbeatProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        verify(stateMachine, org.mockito.Mockito.times(2)).hasInFlightJobWriteTransaction("70");
        verify(stateMachine, org.mockito.Mockito.times(1)).hasPublishedAsset("70", uploaded.getValue().getKey());
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        // 对象存在性：发布事务随后提交成功，被 Asset 引用的对象仍存在
        assertThat(tosObjects).containsKey(uploaded.getValue().getKey());
        assertThat(tosObjects.get(uploaded.getValue().getKey())).hasSize(BLOCK_BYTES * BLOCK_COUNT);
        verify(stateMachine).failMediaExtractJob(any());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("TOS 删除失败：删除动作仍发生（留对象身份与错误记录），失租静默退出不变、无临时文件残留")
    void realTransferTosDeleteFailureKeepsSilentExitAndCleansTempFiles() throws Exception {
        String sourceUrl = serveSlow();
        JobStateMachineService stateMachine = mock(JobStateMachineService.class);
        GenerationCredentialService credentials = mock(GenerationCredentialService.class);
        NewApiMediaKitMuxAudioVideoClient gateway = mock(NewApiMediaKitMuxAudioVideoClient.class);
        GenerationMessageProducer producer = mock(GenerationMessageProducer.class);
        TOSV2 tosClient = fullyTransferredFixture(stateMachine, credentials, gateway, producer, sourceUrl);
        TosVideoMediaRelay relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true, false);
        doThrow(new RuntimeException("TOS 删除 5xx")).when(tosClient).deleteObject(any(DeleteObjectInput.class));
        List<String> tempBefore = relayTempFiles();

        assertThatCode(() ->
                quietHeartbeatProcessor(stateMachine, credentials, gateway, relay, producer).handle("70"))
                .doesNotThrowAnyException();

        // 删除尝试确实发生（relay 内部记录 storageKey + 错误后吞掉异常），主语义不变
        verify(tosClient).deleteObject(any(DeleteObjectInput.class));
        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
        verify(stateMachine, never()).failMediaExtractJob(any());
        // 对象存在性：删除失败不得记为成功——对象仍完整保留在 TOS 替身（留待处理清理责任）
        var uploaded = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(uploaded.capture());
        assertThat(tosObjects).containsKey(uploaded.getValue().getKey());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }
}
