package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.application.service.WorkerClock;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient.MuxAudioVideoTaskObservation;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AudioVideoMuxJobProcessorTest {
    @Mock JobStateMachineService stateMachine;
    @Mock GenerationCredentialService credentials;
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
                "submit_attempt", submitAttempt,
                "provider_credential", "sk-frozen");
    }

    private ClaimedMediaExtractJobDto claim(String providerTaskId) {
        return new ClaimedMediaExtractJobDto("70", "5", "9", input(), providerTaskId,
                "worker-1", 3L, 0, 0);
    }

    @Test
    void submitPersistsProviderTaskIdWithDerivedClientTokenAndSchedulesPoll() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-1"))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), eq("provider-1"))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(producer).enqueue("70", 5_000L);
        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
    }

    @Test
    void crashResubmitReusesTheSameClientTokenWhileRetryAttemptChangesIt() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.submit(eq("sk-frozen"), anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), anyString())).thenReturn(true);

        var processor = new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer);
        processor.handle("70");
        // 崩溃重提：provider_task_id 未持久化前重入 submit，同 token 由供应商去重。
        processor.handle("70");
        verify(gateway, times(2)).submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-1");

        // 用户重试递增 submit_attempt → 新 token（input() 快照由重试票递增，此处换快照模拟）。
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(
                new ClaimedMediaExtractJobDto("70", "5", "9", input("none", 2L), null,
                        "worker-1", 3L, 0, 0)));
        processor.handle("70");
        verify(gateway).submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-2");
    }

    @Test
    void delegatesTheFrozenSyncTierToTheGateway() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(
                new ClaimedMediaExtractJobDto("70", "5", "9", input("video", 1L), null,
                        "worker-1", 3L, 0, 0)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "video", "bwmux-70-1"))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), eq("provider-1"))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(gateway).submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "video", "bwmux-70-1");
    }

    @Test
    void dirtyFrozenSnapshotFailsBeforeAnyUpstreamWork() {
        Map<String, Object> dirty = new java.util.HashMap<>(input());
        dirty.remove("submit_attempt");
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(
                new ClaimedMediaExtractJobDto("70", "5", "9", dirty, null,
                        "worker-1", 3L, 0, 0)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(stateMachine).failMediaExtractJob(argThat(failure -> failure.code().equals("invalid_input")));
        verifyNoInteractions(gateway, relay, producer);
    }

    @Test
    void keepsPollingALongVideoPastADayWithoutMistakingItForFailure() {
        Map<String, Object> frozen = new java.util.HashMap<>(input());
        frozen.put("estimated_duration_ms", 20L * 60 * 60 * 1000);
        ClaimedMediaExtractJobDto longJob = new ClaimedMediaExtractJobDto("70", "5", "9", frozen,
                "provider-1", "worker-1", 3L, 18000, 0, WorkerClock.now().minusHours(25));
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(longJob));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("processing", null, null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("70"), anyString(), eq(3L), eq(0), eq(60_000L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(producer).enqueue("70", 60_000L);
        verify(stateMachine).rescheduleProviderPoll(eq("70"), anyString(), eq(3L), eq(0), eq(60_000L));
        verify(stateMachine, never()).failMediaExtractJob(any());
    }

    @Test
    void eventuallyFailsAStalledOneHourVideoByWallClockAfterRestart() {
        Map<String, Object> frozen = new java.util.HashMap<>(input());
        frozen.put("estimated_duration_ms", 60L * 60 * 1000);
        ClaimedMediaExtractJobDto stale = new ClaimedMediaExtractJobDto("70", "5", "9", frozen,
                "provider-1", "worker-1", 3L, 300, 0, WorkerClock.now().minusHours(25));
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(stale));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("processing", null, null, null, null, null));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(stateMachine).failMediaExtractJob(argThat(failure -> failure.message().contains("查询超时")));
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    void capsTheFallbackBudgetAt365Days() {
        Map<String, Object> frozen = new java.util.HashMap<>(input());
        frozen.put("estimated_duration_ms", 400L * 24 * 60 * 60 * 1000);
        ClaimedMediaExtractJobDto ancient = new ClaimedMediaExtractJobDto("70", "5", "9", frozen,
                "provider-1", "worker-1", 3L, 300, 0, WorkerClock.now().minusDays(366));
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(ancient));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("processing", null, null, null, null, null));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(stateMachine).failMediaExtractJob(argThat(failure -> failure.message().contains("查询超时")));
    }

    @Test
    void retryGetsANewDeadlineWithoutChangingOriginalCreationTime() {
        Map<String, Object> frozen = new java.util.HashMap<>(input());
        frozen.put("estimated_duration_ms", 60L * 60 * 1000);
        ClaimedMediaExtractJobDto retry = new ClaimedMediaExtractJobDto("70", "5", "9", frozen,
                "provider-2", "worker-1", 9L, 1, 0,
                WorkerClock.now().minusDays(3), WorkerClock.now().plusHours(23));
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(retry));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(9L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-2"))
                .thenReturn(new MuxAudioVideoTaskObservation("processing", null, null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("70"), anyString(), eq(9L), eq(0), eq(5_000L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(producer).enqueue("70", 5_000L);
        verify(stateMachine, never()).failMediaExtractJob(any());
    }

    @Test
    void relayFailureIncludesPollRequestId() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, "request-relay-1"));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenThrow(new MediaExtractError("upload_failed", "TOS 转存失败"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(stateMachine).failMediaExtractJob(argThat(failure ->
                failure.message().contains("TOS 转存失败") && failure.message().contains("request-relay-1")));
    }

    @Test
    void largeResultWithinCapacityIsTransferredAndPublished() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "3840x2160", null, null, null));
        // 5 GiB 产物超过抠像 1 GiB 旧口径：本家族 10 GiB 上限内照常转存发布，杜绝「供应商成功而用户结果丢失」。
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 5L << 30, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        ArgumentCaptor<PublishAudioVideoMuxDto> result = ArgumentCaptor.forClass(PublishAudioVideoMuxDto.class);
        verify(stateMachine).publishAudioVideoMuxResult(result.capture());
        assertThat(result.getValue().url()).isEqualTo("https://our-tos/out.mp4");
        assertThat(result.getValue().size()).isEqualTo(5L << 30);
        verify(stateMachine, never()).failMediaExtractJob(any());
    }

    @Test
    void completedTaskPublishesStoredUrlProviderDurationAndResolution() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        ArgumentCaptor<PublishAudioVideoMuxDto> result = ArgumentCaptor.forClass(PublishAudioVideoMuxDto.class);
        verify(stateMachine).publishAudioVideoMuxResult(result.capture());
        assertThat(result.getValue().url()).isEqualTo("https://our-tos/out.mp4");
        assertThat(result.getValue().durationSec()).isEqualTo(227.0);
        assertThat(result.getValue().resolution()).isEqualTo("1920x1080");
        assertThat(result.getValue().sourceVideoAssetId()).isEqualTo("12");
    }

    @Test
    void missingDurationOrResolutionStillPublishesForSourceFallback() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        null, null, null, null, "request-min"));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo("https://our-tos/out.mp4", "generated/9/video/out.mp4",
                        "video/mp4", 100L, "md5"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        ArgumentCaptor<PublishAudioVideoMuxDto> result = ArgumentCaptor.forClass(PublishAudioVideoMuxDto.class);
        verify(stateMachine).publishAudioVideoMuxResult(result.capture());
        assertThat(result.getValue().durationSec()).isNull();
        assertThat(result.getValue().resolution()).isNull();
    }

    @Test
    void longResultTransferKeepsItsLeaseAndStopsHeartbeatsAfterPublishing() throws Exception {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
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
        var processor = new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 20;

        processor.handle("70");

        verify(stateMachine).publishAudioVideoMuxResult(any());
        int calls = renewals.get();
        assertThat(calls).isGreaterThanOrEqualTo(3);
        Thread.sleep(70);
        assertThat(renewals.get()).isEqualTo(calls);
    }

    @Test
    void lostLeaseDuringTransferCannotPublishAnAsset() throws Exception {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
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
        var processor = new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 20;

        processor.handle("70");

        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
        verify(stateMachine, never()).failMediaExtractJob(any());
    }

    @Test
    void cancellationDuringTransferAbortsTheStreamingRelay() throws Exception {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        // 转存前三次取消检查（runStep 入口 + poll 观察后 + 续租前）都未命中；心跳里第四次命中取消
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, false, false, true, true);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
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
        var processor = new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 20;

        processor.handle("70");

        // 取消路径：cancelled 终态由 cancelIfRequested 落，本执行者不发布也不写普通失败
        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
        verify(stateMachine, never()).failMediaExtractJob(any());
    }

    @Test
    void abortedTransferReturningAResultDoesNotPublishOrFail() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
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

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
        verify(stateMachine, never()).failMediaExtractJob(any());
    }

    @Test
    void leaseMissedBeforeTransferSkipsTheRelayEntirely() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        // 转存前续租未命中（已被接管/终态）：不进转存，静默退出
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(false);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verifyNoInteractions(relay);
        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
        verify(stateMachine, never()).failMediaExtractJob(any());
    }

    @Test
    void cancellationBeforeSubmitStopsUpstreamWork() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verifyNoInteractions(gateway, relay, producer);
        verify(stateMachine, never()).failMediaExtractJob(any());
    }

    @Test
    void cancellationAfterSubmitStopsPolling() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, true);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-1"))
                .thenReturn("provider-1");

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(), anyLong(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    void providerFailurePersistsRequestIdAndDoesNotCreateAsset() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("failed", null, null, null,
                        "provider_error", "上游合成失败", "request-42"));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        ArgumentCaptor<FailMediaExtractDto> failure = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(failure.capture());
        assertThat(failure.getValue().code()).isEqualTo("audio_video_mux_failed");
        assertThat(failure.getValue().message()).contains("request-42");
        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
        verifyNoInteractions(relay);
    }

    @Test
    void missingProviderResultFailsBeforeStorage() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", null, 227.0,
                        "1920x1080", null, null, "request-43"));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        ArgumentCaptor<FailMediaExtractDto> failure = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(failure.capture());
        assertThat(failure.getValue().message()).contains("request-43");
        verifyNoInteractions(relay);
        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
    }

    @Test
    void relayFailureMarksJobFailedWithoutPublishingTemporaryUrl() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MuxAudioVideoTaskObservation("succeeded", "https://temporary/out.mp4",
                        227.0, "1920x1080", null, null, null));
        when(relay.persistStreaming(eq("https://temporary/out.mp4"), eq("9"),
                eq(AudioVideoMuxContract.MAX_RESULT_BYTES), any(), any()))
                .thenThrow(new MediaExtractError("upload_failed", "TOS 转存失败"));
        when(stateMachine.renewAudioVideoMuxLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(stateMachine).failMediaExtractJob(argThat(failure ->
                failure.code().equals("audio_video_mux_failed") && failure.message().contains("TOS 转存失败")));
        verify(stateMachine, never()).publishAudioVideoMuxResult(any());
    }

    @Test
    void lostFollowUpEnqueueReturnsWhenFenceIsNoLongerOwned() {
        when(stateMachine.claimAudioVideoMux(eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioVideoMuxIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(false);
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-1"))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), eq("provider-1")))
                .thenReturn(true);
        doThrow(new IllegalStateException("MQ 不可用")).when(producer).enqueue("70", 5_000L);

        assertThatCode(() -> new AudioVideoMuxJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70"))
                .doesNotThrowAnyException();
        verify(stateMachine).failMediaExtractJob(any());
    }
}
