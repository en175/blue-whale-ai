package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishVideoMattingDto;
import com.bluewhale.worker.domain.dto.UpdateVideoMattingProgressDto;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient.MatteVideoTaskObservation;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.sun.net.httpserver.HttpServer;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.model.object.DeleteObjectInput;
import com.volcengine.tos.model.object.PreSignedURLInput;
import com.volcengine.tos.model.object.PreSignedURLOutput;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * IKIN7Z 行为测试：视频智能抠像转存成功返回后的放弃路径（失租 / 取消 / 发布守卫拒绝 / 发布
 * 异常）清理本次上传的无 Asset 引用 TOS 对象（IKIN03 音视频合成同款敞口，PR !876 先例平移）。
 * <p>
 * 与 VideoMattingJobProcessorTest 的 mock relay 分支钉线互补：本套件按验收口径使用**真实
 * 转存组件**（{@link TosVideoMediaRelay}，四参流式入口）+ 有状态 TOS 替身（签名指向本地
 * 上传对端、对象表真存真删）+ 受控租约与发布守卫（stateMachine mock）+ 本地源视频桩——
 * 清理结论断言对象表里的真实对象存在性，不以「转存函数模拟成立即返回 + verify 删除调用」
 * 代替。每个用例同时断言成功 / 失败 / 中止后系统临时目录无 video-relay-* 残留。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class VideoMattingTransferCleanupTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobClaimService claimService;
    @Mock private GenerationJobMapper jobMapper;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitMatteVideoClient matteVideoClient;
    @Mock private GenerationMessageProducer producer;

    private TOSV2 tosClient;
    private TosVideoMediaRelay relay;
    private VideoMattingJobProcessor processor;
    private HttpServer sourceServer;
    private HttpServer uploadServer;

    /** 有状态 TOS 替身的对象表：上传对端按请求 path 存 key→字节；deleteObject 查表真删。 */
    private final ConcurrentHashMap<String, byte[]> tosObjects = new ConcurrentHashMap<>();
    /** preSignedURL 收到的签名请求（含 storageKey——发布不可达的用例经此取对象身份）。 */
    private final List<PreSignedURLInput> signRequests = new CopyOnWriteArrayList<>();
    /** 上传对端每读一块的延时（>0 模拟慢上传，供转存期失租用例让中止落在 PUT 段）。 */
    private volatile long uploadChunkDelayMs = 0;

    private static Map<String, Object> webmInput() {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("mode", "portrait");
        input.put("format", "WEBM");
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    @BeforeEach
    void setUp() {
        tosClient = mock(TOSV2.class);
        relay = new TosVideoMediaRelay(tosClient, "bkt", "tos.example.com");
        processor = new VideoMattingJobProcessor(
                stateMachine, claimService, jobMapper, finalizer, new AssetSourceService(assetMapper),
                credentialService, matteVideoClient, relay, producer);
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
        when(finalizer.failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong())).thenReturn(true);
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(new ClaimedJob(
                        "100", "42", "9", webmInput(), "video_matting", "amk-task-1", false,
                        "worker-1", 5L, 3, 0, null, null, null)));
        // 默认放行租约与「无引用、无在飞事务」权威结论；专项用例按需覆写
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenReturn(true);
        when(finalizer.hasPublishedAsset(anyString(), anyString())).thenReturn(false);
        when(finalizer.hasInFlightJobWriteTransaction(anyString())).thenReturn(false);
    }

    @AfterEach
    void tearDown() {
        if (uploadServer != null) uploadServer.stop(0);
        if (sourceServer != null) sourceServer.stop(0);
    }

    /** 本地源视频桩：固定 video/webm 响应（contentLength 为块重复次数）。 */
    private String serveSourceVideo(int blockCount) throws IOException {
        byte[] block = new byte[16 * 1024];
        for (int i = 0; i < block.length; i++) block[i] = (byte) (i % 251);
        sourceServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        sourceServer.createContext("/", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "video/webm");
            exchange.sendResponseHeaders(200, (long) block.length * blockCount);
            try (OutputStream out = exchange.getResponseBody()) {
                for (int i = 0; i < blockCount; i++) out.write(block);
            }
        });
        sourceServer.start();
        return "http://127.0.0.1:" + sourceServer.getAddress().getPort() + "/out.webm";
    }

    /** 本地源桩：HTTP 错误形态（404 下载失败用例）。 */
    private String serveSourceError(int status) throws IOException {
        sourceServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        sourceServer.createContext("/", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "video/webm");
            byte[] body = "not found".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, body.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(body);
            }
        });
        sourceServer.start();
        return "http://127.0.0.1:" + sourceServer.getAddress().getPort() + "/out.webm";
    }

    /**
     * 有状态 TOS 替身：签名 URL 指向本地上传对端（path 携带真实 storageKey），上传对端按
     * path 把完整 PUT 体存入对象表；客户端中途取消（中止路径）不落成对象，与真实 TOS 的
     * PUT 原子口径一致。deleteObject 默认查表真删（幂等：key 不存在静默通过）。
     */
    private void wireTosDouble() throws IOException {
        uploadServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        uploadServer.createContext("/", exchange -> {
            String key = exchange.getRequestURI().getPath().substring(1);
            try (InputStream in = exchange.getRequestBody()) {
                byte[] buffer = new byte[16 * 1024];
                var body = new java.io.ByteArrayOutputStream();
                int read;
                while ((read = in.read(buffer)) != -1) {
                    body.write(buffer, 0, read);
                    if (uploadChunkDelayMs > 0) Thread.sleep(uploadChunkDelayMs);
                }
                tosObjects.put(key, body.toByteArray());
                exchange.sendResponseHeaders(200, -1);
            } catch (IOException | InterruptedException cancelled) {
                // 客户端中止取消上传：PUT 未完整落地，对象不入表（PUT 原子口径）
            } finally {
                exchange.close();
            }
        });
        uploadServer.start();
        doAnswer(invocation -> {
            PreSignedURLInput input = invocation.getArgument(0);
            signRequests.add(input);
            return new PreSignedURLOutput("http://127.0.0.1:" + uploadServer.getAddress().getPort()
                    + "/" + input.getKey(), input.getHeader());
        }).when(tosClient).preSignedURL(any(PreSignedURLInput.class));
        doAnswer(invocation -> {
            tosObjects.remove(invocation.getArgument(0, DeleteObjectInput.class).getKey());
            return null;
        }).when(tosClient).deleteObject(any(DeleteObjectInput.class));
    }

    /** 钉「上游 completed」观察：结果 URL 指向本地源桩。 */
    private void stubCompletedPoll(String sourceUrl) {
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded", sourceUrl, "1080p", 65.5,
                        null, null));
    }

    /** 本次转存实际上传的对象 key（发布调用已发出时经发布 DTO 取回）。 */
    private String publishedStorageKey() {
        ArgumentCaptor<PublishVideoMattingDto> captor =
                ArgumentCaptor.forClass(PublishVideoMattingDto.class);
        verify(finalizer).publishVideoMattingResult(captor.capture());
        return captor.getValue().storageKey();
    }

    /** 系统临时目录里本转存器留下的文件（前后对比验证清理，java.io.tmpdir 启动即冻结）。 */
    private static List<String> relayTempFiles() throws IOException {
        Path tmp = Path.of(System.getProperty("java.io.tmpdir"));
        try (var files = Files.list(tmp)) {
            return files.map(path -> path.getFileName().toString())
                    .filter(name -> name.startsWith("video-relay-"))
                    .sorted()
                    .toList();
        }
    }

    /** 捕获指定类 WARN/INFO 日志（结构化待处理记录与 relay 清理留痕断言用）。 */
    private static List<String> captureLogs(Class<?> loggerClass, Runnable action) {
        Logger logger = (Logger) LoggerFactory.getLogger(loggerClass);
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

    @Test
    @DisplayName("发布成功 → 上传对象保留为成品，不进入清理，无临时文件残留")
    void successfulPublishKeepsTheUploadedObject() throws Exception {
        stubCompletedPoll(serveSourceVideo(4));
        wireTosDouble();
        when(finalizer.publishVideoMattingResult(any())).thenReturn(true);
        List<String> tempBefore = relayTempFiles();

        processor.handle("100");

        String storageKey = publishedStorageKey();
        assertThat(tosObjects).containsKey(storageKey);
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("发布守卫拒绝（stale worker 或已终态）→ 核实无 Asset 引用后删除本次上传对象，不落失败终态")
    void guardRejectionDeletesUnreferencedUpload() throws Exception {
        stubCompletedPoll(serveSourceVideo(4));
        wireTosDouble();
        when(finalizer.publishVideoMattingResult(any())).thenReturn(false);
        List<String> tempBefore = relayTempFiles();

        processor.handle("100");

        String storageKey = publishedStorageKey();
        // 删除前先经权威核实（同 jobId + storageKey 判据），确认未被 Asset 引用
        verify(finalizer).hasPublishedAsset("100", storageKey);
        assertThat(tosObjects).doesNotContainKey(storageKey);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("发布守卫拒绝但权威核实已被 Asset 引用（接管者已发布同 key）→ 保留对象不删")
    void guardRejectionKeepsUploadWhenAssetReferencesIt() throws Exception {
        stubCompletedPoll(serveSourceVideo(4));
        wireTosDouble();
        when(finalizer.publishVideoMattingResult(any())).thenReturn(false);
        when(finalizer.hasPublishedAsset(eq("100"), anyString())).thenReturn(true);
        List<String> tempBefore = relayTempFiles();

        processor.handle("100");

        String storageKey = publishedStorageKey();
        assertThat(tosObjects).containsKey(storageKey);
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("权威核实自身异常（DB 断连）→ 保守保留对象 + 结构化待处理记录，不删不落失败终态")
    void guardRejectionWithAuthorityCheckErrorKeepsUploadAndLogsPendingRecord() throws Exception {
        stubCompletedPoll(serveSourceVideo(4));
        wireTosDouble();
        when(finalizer.publishVideoMattingResult(any())).thenReturn(false);
        when(finalizer.hasPublishedAsset(eq("100"), anyString()))
                .thenThrow(new RuntimeException("核实查询断连"));
        List<String> tempBefore = relayTempFiles();

        List<String> logs = captureLogs(VideoMattingJobProcessor.class, () -> processor.handle("100"));

        String storageKey = publishedStorageKey();
        assertThat(tosObjects).containsKey(storageKey);
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        assertThat(logs.stream().filter(message -> message.contains("[pending-cleanup]")).toList())
                .anySatisfy(message -> assertThat(message)
                        .contains("jobId=100")
                        .contains("storageKey=" + storageKey)
                        .contains("resolution=retain-pending"));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("TOS 删除失败（5xx）→ 对象保留 + relay 留可定位的对象身份与错误记录，不转成任务失败")
    void deleteFailureLeavesRelayLogAndRetainsUpload() throws Exception {
        stubCompletedPoll(serveSourceVideo(4));
        wireTosDouble();
        when(finalizer.publishVideoMattingResult(any())).thenReturn(false);
        doThrow(new RuntimeException("TOS 删除 5xx")).when(tosClient).deleteObject(any(DeleteObjectInput.class));
        List<String> tempBefore = relayTempFiles();

        // deleteUnpublishedObject 的既定契约（IKIN03/IKIN90 不复查）：删除失败内部只记日志
        // 不上抛——留痕形态 = relay 的「对象身份 + 原始错误」记录，可据 storageKey 定位清理责任
        List<String> logs = captureLogs(TosVideoMediaRelay.class, () -> processor.handle("100"));

        String storageKey = publishedStorageKey();
        // 删除失败不得记为成功：对象仍在
        assertThat(tosObjects).containsKey(storageKey);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        assertThat(logs.stream().filter(message -> message.contains("清理未发布 TOS 对象失败")).toList())
                .anySatisfy(message -> assertThat(message)
                        .contains("storageKey=" + storageKey)
                        .contains("TOS 删除 5xx"));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(30)
    @DisplayName("转存期失租（心跳未命中中止上传）→ relay 内部清理已发起 PUT + 静默退出：不发布、不落失败、无对象无临时文件残留")
    void leaseLostDuringTransferAbortsAndCleansUpWithoutPublishing() throws Exception {
        stubCompletedPoll(serveSourceVideo(32));
        uploadChunkDelayMs = 30;
        wireTosDouble();
        // 转存前续租命中（进入传输），心跳续租未命中（已被接管/终态）→ 中止句柄打断 PUT 段
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenReturn(true, false, false, false, false);
        processor.leaseRenewIntervalMs = 20;
        List<String> tempBefore = relayTempFiles();

        processor.handle("100");

        verify(finalizer, never()).publishVideoMattingResult(any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        // 中止时 PUT 已发起：relay 内部幂等清理后对象表无该 key（PUT 未完整落地本就不成对象，
        // 清理幂等通过——两种到达形态的最终状态一致：无孤儿）
        assertThat(signRequests).hasSize(1);
        assertThat(tosObjects).doesNotContainKey(signRequests.get(0).getKey());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("下载失败（源 404，转存未成功返回）→ 1050 整体失败：无 PUT 无对象、无临时文件残留")
    void downloadFailureFailsJobWithoutObjectOrTempFile() throws Exception {
        stubCompletedPoll(serveSourceError(404));
        wireTosDouble();
        List<String> tempBefore = relayTempFiles();

        processor.handle("100");

        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED), anyString(), any(),
                eq("worker-1"), eq(5L));
        verify(finalizer, never()).publishVideoMattingResult(any());
        assertThat(signRequests).isEmpty();
        assertThat(tosObjects).isEmpty();
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    // ========== 发布调用抛异常（结果不明）：有界核实后删除或保留（IKIN7Z，IKIN8Z 同口径） ==========

    @Test
    @DisplayName("发布异常 + 在飞事务已结束且无 Asset 引用 → 删除对象；异常继续上抛走既有 fail 终态路径")
    void publishExceptionDeletesAfterSettledAndUnreferenced() throws Exception {
        stubCompletedPoll(serveSourceVideo(4));
        wireTosDouble();
        when(finalizer.publishVideoMattingResult(any()))
                .thenThrow(new RuntimeException("发布事务结果不明"));
        processor.publishSettleProbeDelayMs = 5;
        List<String> tempBefore = relayTempFiles();

        processor.handle("100");

        String storageKey = publishedStorageKey();
        // 不凭本地异常直接删除：先核实「可能发布该键的事务」已结束（行锁空闲）且无 Asset 引用
        verify(finalizer).hasInFlightJobWriteTransaction("100");
        verify(finalizer).hasPublishedAsset("100", storageKey);
        assertThat(tosObjects).doesNotContainKey(storageKey);
        // 异常不吞：继续上抛由 handle 归并 1050 落失败终态（守卫仍 fencing，语义不变）
        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED), anyString(), any(),
                eq("worker-1"), eq(5L));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("发布异常 + 有界重查后事务提交结束且 Asset 已引用 → 保留成品不删；异常仍上抛落失败终态")
    void publishExceptionKeepsUploadWhenAssetAppearsAfterSettle() throws Exception {
        stubCompletedPoll(serveSourceVideo(4));
        wireTosDouble();
        when(finalizer.publishVideoMattingResult(any()))
                .thenThrow(new RuntimeException("commit 窗口断连"));
        // 首次探测：可能发布该键的事务仍在服务端进行（行锁被占）；短延时重查后事务已提交结束
        when(finalizer.hasInFlightJobWriteTransaction("100")).thenReturn(true, false);
        when(finalizer.hasPublishedAsset(eq("100"), anyString())).thenReturn(true);
        processor.publishSettleProbeDelayMs = 5;
        List<String> tempBefore = relayTempFiles();

        processor.handle("100");

        String storageKey = publishedStorageKey();
        assertThat(tosObjects).containsKey(storageKey);
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        verify(finalizer).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("发布异常 + 有界重查窗口内事务始终未结束 → 保守保留 + 结构化待处理记录，不删；异常仍上抛")
    void publishExceptionKeepsUploadWithPendingRecordWhenTransactionNeverSettles() throws Exception {
        stubCompletedPoll(serveSourceVideo(4));
        wireTosDouble();
        when(finalizer.publishVideoMattingResult(any()))
                .thenThrow(new RuntimeException("发布事务结果不明"));
        when(finalizer.hasInFlightJobWriteTransaction("100")).thenReturn(true);
        processor.publishSettleProbeAttempts = 2;
        processor.publishSettleProbeDelayMs = 5;
        List<String> tempBefore = relayTempFiles();

        List<String> logs = captureLogs(VideoMattingJobProcessor.class, () -> processor.handle("100"));

        String storageKey = publishedStorageKey();
        // 权威状态暂不可确认：保留对象，不进入 Asset 引用查询与删除
        verify(finalizer, never()).hasPublishedAsset(anyString(), anyString());
        verify(tosClient, never()).deleteObject(any(DeleteObjectInput.class));
        assertThat(tosObjects).containsKey(storageKey);
        assertThat(logs.stream().filter(message -> message.contains("[pending-cleanup]")).toList())
                .anySatisfy(message -> assertThat(message)
                        .contains("jobId=100")
                        .contains("storageKey=" + storageKey)
                        .contains("resolution=retain-pending"));
        verify(finalizer).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }
}
