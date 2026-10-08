package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.application.service.WorkerClock;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient.MuxAudioVideoTaskObservation;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AudioVideoMuxJobProcessorTest {
    @Mock JobStateMachineService stateMachine;
    @Mock JobClaimService claimService;
    @Mock GenerationJobMapper jobMapper;
    @Mock JobFinalizer finalizer;
    @Mock UpstreamCredential upstreamCredential;
    @Mock NewApiMediaKitMuxAudioVideoClient gateway;
    @Mock TosVideoMediaRelay relay;
    @Mock GenerationMessageProducer producer;

    private Map<String, Object> input() {
        return input("none", 1L);
    }

    private Map<String, Object> input(String sync, long submitAttempt) {
        return Map.of(
                "audio", Map.of("assetId", "11", "nodeId", "source-node", "url", "https://tos/a.mp3"),
                "video", Map.of("assetId", "12", "url", "https://tos/v.mp4"),
                "is_audio_reserve", true,
                "sync", sync,
                "submit_attempt", submitAttempt);
    }

    private ClaimedJob claim(String providerTaskId) {
        return new ClaimedJob(
                "70", "5", "9", input(), "audio_video_mux", providerTaskId, false, "worker-1", 3L, 0, 0,
                null, null, null);
    }

    /** 发布异常系列共用前置：领取→轮询观察 succeeded→转存返回→续租命中，直接推进到发布调用。 */
    private AudioVideoMuxJobProcessor transferCompletedProcessor() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        var processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.publishSettleProbeDelayMs = 5;
        return processor;
    }

    /** 捕获 processor WARN 日志（结构化待处理记录断言用）。 */
    private static List<ILoggingEvent> captureProcessorLogs(Runnable action) {
        Logger logger = (Logger) LoggerFactory.getLogger(AudioVideoMuxJobProcessor.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            action.run();
            return appender.list;
        } finally {
            logger.detachAppender(appender);
        }
    }

    private static List<String> formatted(List<ILoggingEvent> events) {
        return events.stream().map(ILoggingEvent::getFormattedMessage).toList();
    }

    @Test
    void submitPersistsProviderTaskIdWithDerivedClientTokenAndSchedulesPoll() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-1"))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), eq("provider-1"))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(producer).enqueue("70", 5_000L);
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
    }

    @Test
    void crashResubmitReusesTheSameClientTokenWhileRetryAttemptChangesIt() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.submit(eq("sk-frozen"), anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), anyString())).thenReturn(true);

        var processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.handle("70");
        // 崩溃重提：provider_task_id 未持久化前重入 submit，同 token 由供应商去重。
        processor.handle("70");
        verify(gateway, times(2)).submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-1");

        // 用户重试递增 submit_attempt → 新 token（input() 快照由重试票递增，此处换快照模拟）。
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(
                new ClaimedJob(
                        "70", "5", "9", input("none", 2L), "audio_video_mux", null, false, "worker-1", 3L,
                        0, 0, null, null, null)));
        processor.handle("70");
        verify(gateway).submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-2");
    }

    @Test
    void delegatesTheFrozenSyncTierToTheGateway() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(
                new ClaimedJob(
                        "70", "5", "9", input("video", 1L), "audio_video_mux", null, false, "worker-1", 3L,
                        0, 0, null, null, null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "video", "bwmux-70-1"))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), eq("provider-1"))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(gateway).submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "video", "bwmux-70-1");
    }

    @Test
    void dirtyFrozenSnapshotFailsBeforeAnyUpstreamWork() {
        Map<String, Object> dirty = new java.util.HashMap<>(input());
        dirty.remove("submit_attempt");
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(
                new ClaimedJob(
                        "70", "5", "9", dirty, "audio_video_mux", null, false, "worker-1", 3L, 0, 0, null,
                        null, null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer).failMediaExtractJob(eq("70"), argThat(code -> code.equals("invalid_input")),
                anyString(), any(), eq("worker-1"), anyLong());
        verifyNoInteractions(gateway, relay, producer);
    }

    @Test
    void keepsPollingALongVideoPastADayWithoutMistakingItForFailure() {
        Map<String, Object> frozen = new java.util.HashMap<>(input());
        frozen.put("estimated_duration_ms", 20L * 60 * 60 * 1000);
        ClaimedJob longJob = new ClaimedJob(
                "70", "5", "9", frozen, "audio_video_mux", "provider-1", false, "worker-1", 3L, 18000, 0,
                WorkerClock.now().minusHours(25), null, null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(longJob));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("processing", null, null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("70"), anyString(), eq(3L), eq(0), eq(60_000L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(producer).enqueue("70", 60_000L);
        verify(stateMachine).rescheduleProviderPoll(eq("70"), anyString(), eq(3L), eq(0), eq(60_000L));
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    void eventuallyFailsAStalledOneHourVideoByWallClockAfterRestart() {
        Map<String, Object> frozen = new java.util.HashMap<>(input());
        frozen.put("estimated_duration_ms", 60L * 60 * 1000);
        ClaimedJob stale = new ClaimedJob(
                "70", "5", "9", frozen, "audio_video_mux", "provider-1", false, "worker-1", 3L, 300, 0,
                WorkerClock.now().minusHours(25), null, null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(stale));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("processing", null, null, null, null, null));
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer).failMediaExtractJob(eq("70"), anyString(),
                argThat(message -> message.contains("查询超时")), any(), eq("worker-1"), anyLong());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    void capsTheFallbackBudgetAt365Days() {
        Map<String, Object> frozen = new java.util.HashMap<>(input());
        frozen.put("estimated_duration_ms", 400L * 24 * 60 * 60 * 1000);
        ClaimedJob ancient = new ClaimedJob(
                "70", "5", "9", frozen, "audio_video_mux", "provider-1", false, "worker-1", 3L, 300, 0,
                WorkerClock.now().minusDays(366), null, null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(ancient));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("processing", null, null, null, null, null));
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer).failMediaExtractJob(eq("70"), anyString(),
                argThat(message -> message.contains("查询超时")), any(), eq("worker-1"), anyLong());
    }

    @Test
    void retryGetsANewDeadlineWithoutChangingOriginalCreationTime() {
        Map<String, Object> frozen = new java.util.HashMap<>(input());
        frozen.put("estimated_duration_ms", 60L * 60 * 1000);
        ClaimedJob retry = new ClaimedJob(
                "70", "5", "9", frozen, "audio_video_mux", "provider-2", false, "worker-1", 9L, 1, 0,
                WorkerClock.now().minusDays(3), WorkerClock.now().plusHours(23), null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(retry));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(9L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-2"))
                .thenReturn(new MuxAudioVideoTaskObservation("processing", null, null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("70"), anyString(), eq(9L), eq(0), eq(5_000L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(producer).enqueue("70", 5_000L);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    void relayFailureIncludesPollRequestId() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, "request-relay-1"));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenThrow(new MediaExtractError("upload_failed", "TOS 转存失败"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer).failMediaExtractJob(eq("70"), anyString(), argThat(message ->
                message.contains("TOS 转存失败") && message.contains("request-relay-1")),
                any(), eq("worker-1"), anyLong());
    }

    @Test
    void largeResultWithinCapacityIsTransferredAndPublished() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "3840x2160", null, null, null));
        // 5 GiB 产物超过抠像 1 GiB 旧口径：本家族 10 GiB 上限内照常转存发布，杜绝「供应商成功而用户结果丢失」。
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 5L << 30, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        ArgumentCaptor<PublishAudioVideoMuxDto> result = ArgumentCaptor.forClass(PublishAudioVideoMuxDto.class);
        verify(finalizer).publishAudioVideoMuxResult(result.capture());
        assertThat(result.getValue().url()).isEqualTo("https://our-tos/out.mp4");
        assertThat(result.getValue().size()).isEqualTo(5L << 30);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    void completedTaskPublishesStoredUrlProviderDurationAndResolution() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        ArgumentCaptor<PublishAudioVideoMuxDto> result = ArgumentCaptor.forClass(PublishAudioVideoMuxDto.class);
        verify(finalizer).publishAudioVideoMuxResult(result.capture());
        assertThat(result.getValue().url()).isEqualTo("https://our-tos/out.mp4");
        assertThat(result.getValue().durationSec()).isEqualTo(227.0);
        assertThat(result.getValue().resolution()).isEqualTo("1920x1080");
        assertThat(result.getValue().sourceVideoAssetId()).isEqualTo("12");
    }

    @Test
    void missingDurationOrResolutionStillPublishesForSourceFallback() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        null, null, null, null, "request-min"));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        ArgumentCaptor<PublishAudioVideoMuxDto> result = ArgumentCaptor.forClass(PublishAudioVideoMuxDto.class);
        verify(finalizer).publishAudioVideoMuxResult(result.capture());
        assertThat(result.getValue().durationSec()).isNull();
        assertThat(result.getValue().resolution()).isNull();
    }

    @Test
    void longResultTransferKeepsItsLeaseAndStopsHeartbeatsAfterPublishing() throws Exception {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        CountDownLatch heartbeat = new CountDownLatch(1);
        AtomicInteger renewals = new AtomicInteger();
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenAnswer(invocation -> {
            if (renewals.incrementAndGet() == 2) heartbeat.countDown();
            return true;
        });
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenAnswer(invocation -> {
                    assertThat(heartbeat.await(2, TimeUnit.SECONDS)).isTrue();
                    return new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                            "video/mp4", 100L, "md5");
                });
        var processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 20;

        processor.handle("70");

        verify(finalizer).publishAudioVideoMuxResult(any());
        int calls = renewals.get();
        assertThat(calls).isGreaterThanOrEqualTo(3);
        Thread.sleep(70);
        assertThat(renewals.get()).isEqualTo(calls);
    }

    @Test
    void lostLeaseDuringTransferCannotPublishAnAsset() throws Exception {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        CountDownLatch lost = new CountDownLatch(1);
        AtomicInteger renewals = new AtomicInteger();
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenAnswer(invocation -> {
            if (renewals.incrementAndGet() == 1) return true;
            lost.countDown();
            return false;
        });
        // IKILVH：失租经中止句柄打断进行中的传输（不再等传输自然结束才检查 flag）
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenAnswer(invocation -> {
                    TosVideoMediaRelay.TransferAbortHandle handle = invocation.getArgument(3);
                    long deadline = System.currentTimeMillis() + 5_000;
                    while (!handle.aborted() && System.currentTimeMillis() < deadline) {
                        Thread.sleep(10);
                    }
                    assertThat(handle.aborted()).as("心跳失租必须中止转存句柄").isTrue();
                    assertThat(handle.reason()).contains("租约未命中");
                    throw new TosVideoMediaRelay.TransferAbortedException(handle.reason());
                });
        var processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 20;

        processor.handle("70");

        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    void cancellationDuringTransferAbortsTheStreamingRelay() throws Exception {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        // 转存前三次取消检查（runStep 入口 + poll 观察后 + 续租前）都未命中；心跳里第四次命中取消
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, false, false, true, true);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenAnswer(invocation -> {
                    TosVideoMediaRelay.TransferAbortHandle handle = invocation.getArgument(3);
                    long deadline = System.currentTimeMillis() + 5_000;
                    while (!handle.aborted() && System.currentTimeMillis() < deadline) {
                        Thread.sleep(10);
                    }
                    assertThat(handle.aborted()).as("取消必须中止转存句柄").isTrue();
                    assertThat(handle.reason()).contains("取消");
                    throw new TosVideoMediaRelay.TransferAbortedException(handle.reason());
                });
        var processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 20;

        processor.handle("70");

        // 取消路径：cancelled 终态由 cancelIfRequested 落，本执行者不发布也不写普通失败
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    void abortedTransferReturningAResultCleansUpWithoutPublishingOrFailing() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenAnswer(invocation -> {
                    // 传输返回成功结果前一刻失租：发布前再查句柄，命中即静默放弃
                    TosVideoMediaRelay.TransferAbortHandle handle = invocation.getArgument(3);
                    handle.abort("结果转存期租约未命中（已被接管/终态）");
                    return new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                            "video/mp4", 100L, "md5");
                });

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        // IKIN03：转存已成功返回但本执行者放弃发布 → 核实未被 Asset 引用后清理该次上传
        verify(finalizer).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
    }

    @Test
    void cancellationAfterSuccessfulTransferCleansUpTheUnpublishedObject() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        // 转存前三段取消检查未命中；转存返回后命中取消（cancelled 终态由取消检查落）
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, false, false, true);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(finalizer).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
    }

    @Test
    void leaseMissedAfterSuccessfulTransferCleansUpTheUnpublishedObject() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        // 转存前续租命中；转存成功返回后续租未命中（已被接管/终态）→ 放弃发布
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true, false);
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(finalizer).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
    }

    @Test
    void leaseRenewalErrorAfterSuccessfulTransferCleansUpAndKeepsFailSemantics() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        // 转存前续租命中；转存返回后续租抛异常（DB 断连）→ 清理孤儿后按既有语义上抛走 fail
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L)))
                .thenReturn(true)
                .thenThrow(new RuntimeException("续租 DB 断连"));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
        verify(finalizer).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
    }

    @Test
    void guardRejectionCleansUpWhenAuthorityConfirmsUnpublished() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        // 发布守卫明确拒绝（旧 fencing token）：published=false 无法区分被拒与已被接管，
        // 删除前先核实权威状态（此处确认未被 Asset 引用）才清理。
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(false);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(finalizer).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
    }

    @Test
    void guardRejectionKeepsObjectWhenAuthorityConfirmsAssetReference() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(false);
        // 权威核实：assets 已有 generation_job_id + storage_key 匹配行（如接管者已发布同 key
        // 或本执行者事务已提交）→ 保留对象，不删。
        when(finalizer.hasPublishedAsset("70", "generated/9/video/out.mp4")).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(relay, never()).deleteUnpublishedObject(anyString());
    }

    @Test
    void publishExceptionCleansUpOnlyAfterAuthorityConfirmsUnpublished() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any())).thenThrow(new RuntimeException("发布事务结果不明"));
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        // 不能仅凭本地异常直接删除：先核实权威状态，确认未被 Asset 引用才清理
        verify(finalizer).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
        // 异常继续上抛走既有 fail 终态路径（守卫仍 fencing），不吞异常
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
    }

    @Test
    void publishExceptionKeepsObjectWhenAuthorityConfirmsPublishedAsset() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any())).thenThrow(new RuntimeException("提交后网络才断"));
        // 权威核实：发布事务实际已提交（assets 已有匹配行）→ 保留成品，迟到清理不删
        when(finalizer.hasPublishedAsset("70", "generated/9/video/out.mp4")).thenReturn(true);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(relay, never()).deleteUnpublishedObject(anyString());
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
    }

    // ========== IKIN8Z：发布结果不明（发布调用抛异常）的清理决策系列 ==========

    @Test
    void publishExceptionWaitsForInFlightPublishTransactionThenKeepsObjectWhenAssetAppears() {
        var processor = transferCompletedProcessor();
        when(finalizer.publishAudioVideoMuxResult(any())).thenThrow(new RuntimeException("commit 窗口断连"));
        // 首次核实：可能发布该键的事务仍在服务端进行（行锁被占，Asset 行对查询不可见）；
        // 短延时重查后事务已提交结束 → 权威查询命中 Asset 引用
        when(finalizer.hasInFlightJobWriteTransaction("70")).thenReturn(true, false);
        when(finalizer.hasPublishedAsset("70", "generated/9/video/out.mp4")).thenReturn(true);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        processor.handle("70");

        // 受控交错：首次查询尚未看到 Asset、事务随后提交成功 → 不删除该对象
        verify(finalizer, times(2)).hasInFlightJobWriteTransaction("70");
        verify(finalizer, times(1)).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay, never()).deleteUnpublishedObject(anyString());
        // 异常仍上抛走既有 fail 终态路径（守卫仍 fencing）
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
    }

    @Test
    void publishExceptionDeletesOnlyAfterTransactionSettledWithoutReference() {
        var processor = transferCompletedProcessor();
        when(finalizer.publishAudioVideoMuxResult(any())).thenThrow(new RuntimeException("发布事务结果不明"));
        // 事务已结束（行锁空闲）且权威查询确认无 Asset 引用 → 判定不会再被提交，安全删除
        when(finalizer.hasInFlightJobWriteTransaction("70")).thenReturn(false);
        when(finalizer.hasPublishedAsset("70", "generated/9/video/out.mp4")).thenReturn(false);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        processor.handle("70");

        verify(finalizer, times(1)).hasInFlightJobWriteTransaction("70");
        verify(finalizer, times(1)).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay, times(1)).deleteUnpublishedObject("generated/9/video/out.mp4");
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
    }

    @Test
    void publishExceptionKeepsObjectWithPendingRecordWhenAuthorityUnreachable() {
        var processor = transferCompletedProcessor();
        when(finalizer.publishAudioVideoMuxResult(any())).thenThrow(new RuntimeException("发布事务结果不明"));
        // 权威核实自身异常（DB 断连）：暂不可确认 → 保留对象 + 结构化待处理记录，不删
        when(finalizer.hasInFlightJobWriteTransaction("70")).thenThrow(new RuntimeException("核实查询断连"));
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        List<String> logs = formatted(captureProcessorLogs(() -> processor.handle("70")));

        verify(relay, never()).deleteUnpublishedObject(anyString());
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
        assertThat(logs.stream().filter(message -> message.contains("[pending-cleanup]")).toList())
                .anySatisfy(message -> {
                    assertThat(message).contains("jobId=70");
                    assertThat(message).contains("storageKey=generated/9/video/out.mp4");
                    assertThat(message).contains("resolution=retain-pending");
                });
    }

    @Test
    void publishExceptionKeepsObjectWithPendingRecordWhenTransactionNeverSettles() {
        var processor = transferCompletedProcessor();
        processor.publishSettleProbeAttempts = 2;
        when(finalizer.publishAudioVideoMuxResult(any())).thenThrow(new RuntimeException("发布事务结果不明"));
        // 有界重查窗口内事务始终未结束（行锁一直被占）→ 保守保留 + 待处理记录，不删
        when(finalizer.hasInFlightJobWriteTransaction("70")).thenReturn(true);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        List<String> logs = formatted(captureProcessorLogs(() -> processor.handle("70")));

        verify(finalizer, times(2)).hasInFlightJobWriteTransaction("70");
        verify(finalizer, never()).hasPublishedAsset(anyString(), anyString());
        verify(relay, never()).deleteUnpublishedObject(anyString());
        assertThat(logs.stream().filter(message -> message.contains("[pending-cleanup]")).toList())
                .anySatisfy(message -> assertThat(message).contains("jobId=70")
                        .contains("storageKey=generated/9/video/out.mp4")
                        .contains("resolution=retain-pending"));
    }

    @Test
    void takeoverPublishingAnotherKeyCleansOnlyTheOldKeyDespiteJobSuccess() {
        var processor = transferCompletedProcessor();
        // 接管者已用另一对象键发布成功（GenerationJob 已成功），旧执行者发布守卫被拒
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(false);
        // GenerationJob 成功不作判据：按对象键核实——旧键无 Asset 引用 → 删旧键
        when(finalizer.hasPublishedAsset("70", "generated/9/video/out.mp4")).thenReturn(false);

        processor.handle("70");

        // 旧键清理；「新键留」由决策单位=对象键保证（新键不在本执行者清理面内）
        verify(relay, times(1)).deleteUnpublishedObject("generated/9/video/out.mp4");
        verify(relay, times(1)).deleteUnpublishedObject(anyString());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    void cleanupFailureLeavesStructuredPendingRecordWithoutTurningIntoJobFailure() {
        var processor = transferCompletedProcessor();
        when(finalizer.publishAudioVideoMuxResult(any())).thenThrow(new RuntimeException("发布事务结果不明"));
        when(finalizer.hasInFlightJobWriteTransaction("70")).thenReturn(false);
        when(finalizer.hasPublishedAsset("70", "generated/9/video/out.mp4")).thenReturn(false);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);
        // 删除动作自身失败：不得记为成功——对象保留 + 结构化待处理记录；发布异常仍按既有语义上抛 fail
        doThrow(new RuntimeException("TOS 删除 5xx")).when(relay).deleteUnpublishedObject("generated/9/video/out.mp4");

        List<String> logs = formatted(captureProcessorLogs(() -> processor.handle("70")));

        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
        assertThat(logs.stream().filter(message -> message.contains("[pending-cleanup]")).toList())
                .anySatisfy(message -> assertThat(message).contains("jobId=70")
                        .contains("storageKey=generated/9/video/out.mp4")
                        .contains("resolution=retain-pending"));
    }

    // ========== IKIN91：转存成功返回后、发布尝试前，取消状态查询抛异常的安全收口 ==========

    @Test
    void cancelQueryErrorAfterSuccessfulTransferCleansUpAndKeepsFailSemantics() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        // 转存前三段取消检查（runStep 入口 + poll 观察后 + 续租前）未命中；转存返回后首次
        // 取消状态查询抛异常（DB 断连）——发布调用尚未发出
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, false, false)
                .thenThrow(new RuntimeException("取消状态查询 DB 断连"));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        // 发布从未开始：不产生引用该键的 Asset
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        // 与「发布已开始」的保守规则严格区分：未尝试发布 → 单次权威核实即删，不进入在飞事务探测
        verify(finalizer, never()).hasInFlightJobWriteTransaction(anyString());
        verify(finalizer).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
        // 原 DB 异常上抛走既有 fail 语义（audio_video_mux_failed），不吞、不伪装成主动取消的静默退出
        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(eq("70"), code.capture(), message.capture(), any(),
                eq("worker-1"), anyLong());
        assertThat(code.getValue()).isEqualTo("audio_video_mux_failed");
        assertThat(message.getValue()).contains("取消状态查询 DB 断连");
    }

    @Test
    void cancelQueryErrorWithTosCleanupFailureLeavesPendingRecordAndKeepsFailSemantics() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, false, false)
                .thenThrow(new RuntimeException("取消状态查询 DB 断连"));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);
        // 清理 TOS 失败：留 GenerationJob + 对象键 + 错误的结构化待处理记录，不得记为成功
        doThrow(new RuntimeException("TOS 删除 5xx")).when(relay).deleteUnpublishedObject("generated/9/video/out.mp4");

        List<String> logs = formatted(captureProcessorLogs(() ->
                new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70")));

        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
        assertThat(logs.stream().filter(message -> message.contains("[pending-cleanup]")).toList())
                .anySatisfy(message -> assertThat(message).contains("jobId=70")
                        .contains("storageKey=generated/9/video/out.mp4")
                        .contains("TOS 删除 5xx")
                        .contains("resolution=retain-pending"));
        // 清理失败不吞原异常：fail 语义保持
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
    }

    @Test
    void cancelQueryErrorWithFailWriteFailureRecordsIncompleteClosureWithoutClaimingTerminalState() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, false, false)
                .thenThrow(new RuntimeException("取消状态查询 DB 断连"));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        // DB 持续不可用：fail 落库自身也失败
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenThrow(new RuntimeException("fail 落库断连"));

        AudioVideoMuxJobProcessor processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        List<String> logs = formatted(captureProcessorLogs(() ->
                assertThatThrownBy(() -> processor.handle("70")).hasMessageContaining("取消状态查询 DB 断连")));

        // 对象已在放弃路径安全收口（清理先于 fail 落库，不受 fail 失败影响）
        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
        // 未完成的任务收口事实留痕（含 job 身份与失败原因，不声称已写入终态），交既有恢复扫描/重投
        assertThat(logs.stream().filter(message -> message.contains("失败终态落库未完成")).toList())
                .anySatisfy(message -> assertThat(message).contains("jobId=70").contains("token=3")
                        .contains("fail 落库断连"));
    }

    @Test
    void successfulPublishKeepsTheTosObject() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        // Finalize 成功：TOS 对象保留为已发布成品，绝不进入清理
        verify(finalizer).publishAudioVideoMuxResult(any());
        verify(relay, never()).deleteUnpublishedObject(anyString());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    void tosCleanupFailureIsRecordedWithoutTurningIntoJobFailure() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(false);
        // TOS 删除失败（如 5xx）：留可定位的对象身份与错误记录，不改变主语义、不落失败终态
        doThrow(new RuntimeException("TOS 删除 5xx")).when(relay).deleteUnpublishedObject("generated/9/video/out.mp4");

        assertThatCode(() -> new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer)
                .handle("70")).doesNotThrowAnyException();

        // 守卫拒绝（published=false）本就未生成 Asset；清理失败不把任务写成失败终态
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    void authorityCheckFailureSkipsCleanupWithoutFailingTheJob() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(false);
        // 权威核实自身异常（DB 断连）：无法确认未发布 → 保守保留对象，不删、不落失败终态
        when(finalizer.hasPublishedAsset("70", "generated/9/video/out.mp4"))
                .thenThrow(new RuntimeException("核实查询断连"));

        assertThatCode(() -> new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer)
                .handle("70")).doesNotThrowAnyException();

        verify(relay, never()).deleteUnpublishedObject(anyString());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    void leaseMissedBeforeTransferSkipsTheRelayEntirely() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        // 转存前续租未命中（已被接管/终态）：不进转存，静默退出
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(false);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verifyNoInteractions(relay);
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    void cancellationBeforeSubmitStopsUpstreamWork() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verifyNoInteractions(gateway, relay, producer);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    void cancellationAfterSubmitStopsPolling() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, true);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-1"))
                .thenReturn("provider-1");

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(), anyLong(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    void providerFailurePersistsRequestIdAndDoesNotCreateAsset() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("failed", null, null, null,
                        "provider_error", "上游合成失败", "request-42"));
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(eq("70"), code.capture(), message.capture(), any(),
                eq("worker-1"), anyLong());
        assertThat(code.getValue()).isEqualTo("audio_video_mux_failed");
        assertThat(message.getValue()).contains("request-42");
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verifyNoInteractions(relay);
    }

    @Test
    void missingProviderResultFailsBeforeStorage() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", null, 227.0,
                        "1920x1080", null, null, "request-43"));
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(eq("70"), anyString(), message.capture(), any(),
                eq("worker-1"), anyLong());
        assertThat(message.getValue()).contains("request-43");
        verifyNoInteractions(relay);
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
    }

    @Test
    void relayFailureMarksJobFailedWithoutPublishingTemporaryUrl() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenThrow(new MediaExtractError("upload_failed", "TOS 转存失败"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer).failMediaExtractJob(eq("70"),
                argThat(code -> code.equals("audio_video_mux_failed")),
                argThat(message -> message.contains("TOS 转存失败")), any(), eq("worker-1"), anyLong());
        verify(finalizer, never()).publishAudioVideoMuxResult(any());
    }

    @Test
    void lostFollowUpEnqueueReturnsWhenFenceIsNoLongerOwned() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-1"))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), eq("provider-1")))
                .thenReturn(true);
        doThrow(new IllegalStateException("MQ 不可用")).when(producer).enqueue("70", 5_000L);

        assertThatCode(() -> new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70"))
                .doesNotThrowAnyException();
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
    }
}
