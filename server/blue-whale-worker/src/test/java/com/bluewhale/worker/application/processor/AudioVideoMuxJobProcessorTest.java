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
        processor.handle("70");
        verify(gateway, times(2)).submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-1");

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
                    TosVideoMediaRelay.TransferAbortHandle handle = invocation.getArgument(3);
                    handle.abort("结果转存期租约未命中（已被接管/终态）");
                    return new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                            "video/mp4", 100L, "md5");
                });

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(finalizer).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
    }

    @Test
    void cancellationAfterSuccessfulTransferCleansUpTheUnpublishedObject() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
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

        verify(finalizer).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
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
        when(finalizer.hasPublishedAsset("70", "generated/9/video/out.mp4")).thenReturn(true);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(relay, never()).deleteUnpublishedObject(anyString());
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
    }


    @Test
    void publishExceptionWaitsForInFlightPublishTransactionThenKeepsObjectWhenAssetAppears() {
        var processor = transferCompletedProcessor();
        when(finalizer.publishAudioVideoMuxResult(any())).thenThrow(new RuntimeException("commit 窗口断连"));
        when(finalizer.hasInFlightJobWriteTransaction("70")).thenReturn(true, false);
        when(finalizer.hasPublishedAsset("70", "generated/9/video/out.mp4")).thenReturn(true);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);

        processor.handle("70");

        verify(finalizer, times(2)).hasInFlightJobWriteTransaction("70");
        verify(finalizer, times(1)).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay, never()).deleteUnpublishedObject(anyString());
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
    }

    @Test
    void publishExceptionDeletesOnlyAfterTransactionSettledWithoutReference() {
        var processor = transferCompletedProcessor();
        when(finalizer.publishAudioVideoMuxResult(any())).thenThrow(new RuntimeException("发布事务结果不明"));
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
        when(finalizer.publishAudioVideoMuxResult(any())).thenReturn(false);
        when(finalizer.hasPublishedAsset("70", "generated/9/video/out.mp4")).thenReturn(false);

        processor.handle("70");

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


    @Test
    void cancelQueryErrorAfterSuccessfulTransferCleansUpAndKeepsFailSemantics() {
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

        new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer, never()).publishAudioVideoMuxResult(any());
        verify(finalizer, never()).hasInFlightJobWriteTransaction(anyString());
        verify(finalizer).hasPublishedAsset("70", "generated/9/video/out.mp4");
        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
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
        doThrow(new RuntimeException("TOS 删除 5xx")).when(relay).deleteUnpublishedObject("generated/9/video/out.mp4");

        List<String> logs = formatted(captureProcessorLogs(() ->
                new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70")));

        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
        assertThat(logs.stream().filter(message -> message.contains("[pending-cleanup]")).toList())
                .anySatisfy(message -> assertThat(message).contains("jobId=70")
                        .contains("storageKey=generated/9/video/out.mp4")
                        .contains("TOS 删除 5xx")
                        .contains("resolution=retain-pending"));
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
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenThrow(new RuntimeException("fail 落库断连"));

        AudioVideoMuxJobProcessor processor = new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        List<String> logs = formatted(captureProcessorLogs(() ->
                assertThatThrownBy(() -> processor.handle("70")).hasMessageContaining("取消状态查询 DB 断连")));

        verify(relay).deleteUnpublishedObject("generated/9/video/out.mp4");
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
        doThrow(new RuntimeException("TOS 删除 5xx")).when(relay).deleteUnpublishedObject("generated/9/video/out.mp4");

        assertThatCode(() -> new AudioVideoMuxJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer)
                .handle("70")).doesNotThrowAnyException();

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
