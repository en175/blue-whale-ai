package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.application.service.WorkerClock;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient.MixAudioTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
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
class AudioMixJobProcessorTest {
    @Mock JobStateMachineService stateMachine;
    @Mock JobClaimService claimService;
    @Mock GenerationJobMapper jobMapper;
    @Mock JobFinalizer finalizer;
    @Mock UpstreamCredential upstreamCredential;
    @Mock NewApiMediaKitMixAudioClient gateway;
    @Mock TosAudioMediaRelay relay;
    @Mock GenerationMessageProducer producer;

    private Map<String, Object> input() {
        return Map.of(
                "source_node_id", "source-node",
                "output_format", "mp3",
                "inputs", List.of(
                        Map.of("asset_id", "11", "node_id", "source-node", "url", "https://tos/a.mp3"),
                        Map.of("asset_id", "12", "url", "https://tos/b.mp3")));
    }

    private ClaimedJob claim(String providerTaskId) {
        return new ClaimedJob(
                "70", "5", "9", input(), "audio_mix", providerTaskId, false, "worker-1", 3L, 0, 0, null,
                null, null);
    }

    @Test
    void cancellationBeforeSubmitStopsUpstreamWork() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioMixIfRequested(eq("70"), anyString(), eq(3L))).thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verifyNoInteractions(gateway, relay, producer);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
    }

    @Test
    void cancellationAfterSubmitStopsPolling() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(stateMachine.cancelAudioMixIfRequested(eq("70"), anyString(), eq(3L)))
                .thenReturn(false, true);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", List.of("https://tos/a.mp3", "https://tos/b.mp3"), "mp3"))
                .thenReturn("provider-1");

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(), anyLong(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    void keepsPollingA20HourMixAfter25HoursButBacksOffQueries() {
        Map<String, Object> frozen = new java.util.HashMap<>(input());
        frozen.put("estimated_duration_ms", 20L * 60 * 60 * 1000);
        ClaimedJob longJob = new ClaimedJob(
                "70", "5", "9", frozen, "audio_mix", "provider-1", false, "worker-1", 3L, 18000, 0,
                WorkerClock.now().minusHours(25), null, null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(longJob));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("processing", null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("70"), anyString(), eq(3L), eq(0), eq(60_000L))).thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(producer).enqueue("70", 60_000L);
        verify(stateMachine).rescheduleProviderPoll(eq("70"), anyString(), eq(3L), eq(0), eq(60_000L));
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
    }

    @Test
    void eventuallyFailsAStalledOneHourMixByWallClockAfterRestart() {
        Map<String, Object> frozen = new java.util.HashMap<>(input());
        frozen.put("estimated_duration_ms", 60L * 60 * 1000);
        ClaimedJob stale = new ClaimedJob(
                "70", "5", "9", frozen, "audio_mix", "provider-1", false, "worker-1", 3L, 300, 0,
                WorkerClock.now().minusHours(25), null, null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(stale));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("processing", null, null, null, null));
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong()))
                .thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer).failMediaExtractJob(anyString(), anyString(),
                argThat(message -> message.contains("查询超时")), any(), anyString(), anyLong());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    void retryGetsANewDeadlineWithoutChangingOriginalCreationTime() {
        Map<String, Object> frozen = new java.util.HashMap<>(input());
        frozen.put("estimated_duration_ms", 60L * 60 * 1000);
        ClaimedJob retry = new ClaimedJob(
                "70", "5", "9", frozen, "audio_mix", "provider-2", false, "worker-1", 9L, 1, 0,
                WorkerClock.now().minusDays(3), WorkerClock.now().plusHours(23), null);
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(retry));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-2"))
                .thenReturn(new MixAudioTaskObservation("processing", null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("70"), anyString(), eq(9L), eq(0), eq(5_000L))).thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(producer).enqueue("70", 5_000L);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
    }

    @Test
    void relayFailureIncludesPollRequestId() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("succeeded", "https://temporary/out.mp3",
                        12.5, null, null, "request-relay-1"));
        when(relay.persist("https://temporary/out.mp3", "9", "mp3"))
                .thenThrow(new MediaExtractError("upload_failed", "TOS 转存失败"));
        when(stateMachine.renewAudioMixLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong()))
                .thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer).failMediaExtractJob(anyString(), anyString(), argThat(message ->
                message.contains("TOS 转存失败") && message.contains("request-relay-1")),
                any(), anyString(), anyLong());
    }

    @Test
    void longResultTransferKeepsItsLeaseAndStopsHeartbeatsAfterPublishing() throws Exception {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("succeeded", "https://temporary/out.mp3", 12.5, null, null));
        CountDownLatch heartbeat = new CountDownLatch(1);
        AtomicInteger renewals = new AtomicInteger();
        when(stateMachine.renewAudioMixLease(eq("70"), anyString(), eq(3L))).thenAnswer(invocation -> {
            if (renewals.incrementAndGet() == 2) heartbeat.countDown();
            return true;
        });
        when(relay.persist("https://temporary/out.mp3", "9", "mp3")).thenAnswer(invocation -> {
            assertThat(heartbeat.await(2, TimeUnit.SECONDS)).isTrue();
            return new TosAudioMediaRelay.StoredAudio("https://our-tos/out.mp3", "generated/9/out.mp3", "audio/mpeg", 100L, "md5");
        });
        var processor = new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 20;

        processor.handle("70");

        verify(finalizer).publishAudioMixResult(any());
        int calls = renewals.get();
        assertThat(calls).isGreaterThanOrEqualTo(3);
        Thread.sleep(70);
        assertThat(renewals.get()).isEqualTo(calls);
    }

    @Test
    void lostLeaseDuringTransferCannotPublishAnAsset() throws Exception {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("succeeded", "https://temporary/out.mp3", 12.5, null, null));
        CountDownLatch lost = new CountDownLatch(1);
        AtomicInteger renewals = new AtomicInteger();
        when(stateMachine.renewAudioMixLease(eq("70"), anyString(), eq(3L))).thenAnswer(invocation -> {
            if (renewals.incrementAndGet() == 1) return true;
            lost.countDown();
            return false;
        });
        when(relay.persist("https://temporary/out.mp3", "9", "mp3")).thenAnswer(invocation -> {
            assertThat(lost.await(2, TimeUnit.SECONDS)).isTrue();
            return new TosAudioMediaRelay.StoredAudio("https://our-tos/out.mp3", "generated/9/out.mp3", "audio/mpeg", 100L, "md5");
        });
        var processor = new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 20;

        processor.handle("70");

        verify(finalizer, never()).publishAudioMixResult(any());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
    }

    @Test
    void cancellationDuringLongTransferReachesCancelledBeforeTransferReturns() throws Exception {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("succeeded", "https://temporary/out.mp3", 12.5, null, null));
        when(stateMachine.renewAudioMixLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        CountDownLatch cancelled = new CountDownLatch(1);
        AtomicInteger checks = new AtomicInteger();
        when(stateMachine.cancelAudioMixIfRequested(eq("70"), anyString(), eq(3L))).thenAnswer(invocation -> {
            if (checks.incrementAndGet() == 4) {
                cancelled.countDown();
                return true;
            }
            return false;
        });
        when(relay.persist("https://temporary/out.mp3", "9", "mp3")).thenAnswer(invocation -> {
            assertThat(cancelled.await(2, TimeUnit.SECONDS)).isTrue();
            return new TosAudioMediaRelay.StoredAudio("https://our-tos/out.mp3", "generated/9/out.mp3", "audio/mpeg", 100L, "md5");
        });
        var processor = new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer);
        processor.leaseRenewIntervalMs = 20;

        processor.handle("70");

        verify(finalizer, never()).publishAudioMixResult(any());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    void submitPersistsProviderTaskIdAndSchedulesPoll() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", List.of("https://tos/a.mp3", "https://tos/b.mp3"), "mp3"))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), eq("provider-1"))).thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(producer).enqueue("70", 5_000L);
        verify(finalizer, never()).publishAudioMixResult(any());
    }

    @Test
    void completedTaskPublishesOnlyTheStoredUrlAndProviderDuration() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("succeeded", "https://temporary/out.mp3", 12.5, null, null));
        when(relay.persist("https://temporary/out.mp3", "9", "mp3"))
                .thenReturn(new TosAudioMediaRelay.StoredAudio("https://our-tos/out.mp3", "generated/9/out.mp3", "audio/mpeg", 100L, "md5"));
        when(stateMachine.renewAudioMixLease(eq("70"), anyString(), eq(3L))).thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        ArgumentCaptor<PublishMediaExtractDto> result = ArgumentCaptor.forClass(PublishMediaExtractDto.class);
        verify(finalizer).publishAudioMixResult(result.capture());
        assertThat(result.getValue().url()).isEqualTo("https://our-tos/out.mp3");
        assertThat(result.getValue().duration()).isEqualTo(12.5);
    }

    @Test
    void providerFailurePersistsRequestIdAndDoesNotCreateAsset() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("failed", null, null,
                        "provider_error", "上游处理失败", "request-42"));
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong()))
                .thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(anyString(), code.capture(), message.capture(), any(),
                anyString(), anyLong());
        assertThat(code.getValue()).isEqualTo("audio_mix_failed");
        assertThat(message.getValue()).contains("request-42");
        verify(finalizer, never()).publishAudioMixResult(any());
        verifyNoInteractions(relay);
    }

    @Test
    void missingProviderResultFailsBeforeStorage() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("succeeded", null, 12.5,
                        null, null, "request-43"));
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong()))
                .thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), message.capture(), any(),
                anyString(), anyLong());
        assertThat(message.getValue()).contains("request-43");
        verifyNoInteractions(relay);
        verify(finalizer, never()).publishAudioMixResult(any());
    }

    @Test
    void relayFailureMarksJobFailedWithoutPublishingTemporaryUrl() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("succeeded", "https://temporary/out.mp3",
                        12.5, null, null));
        when(relay.persist("https://temporary/out.mp3", "9", "mp3"))
                .thenThrow(new MediaExtractError("upload_failed", "TOS 转存失败"));
        when(stateMachine.renewAudioMixLease(eq("70"), anyString(), eq(3L))).thenReturn(true);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong()))
                .thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        verify(finalizer).failMediaExtractJob(anyString(), argThat(code -> code.equals("audio_mix_failed")),
                argThat(message -> message.contains("TOS 转存失败")),
                argThat(details -> !details.containsKey("http_status")), anyString(), anyLong());
        verify(finalizer, never()).publishAudioMixResult(any());
    }

    @Test
    void upstreamUnauthorizedSubmitPersistsHttpStatusDetail() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        MediaExtractError unauthorized = new MediaExtractError("provider_failed",
                "音频混合任务提交失败: HTTP 401 上游凭证被拒绝 request_id=req-sub-7");
        unauthorized.initCause(new NewApiVideoClient.HttpStatusException(401));
        when(gateway.submit("sk-frozen", List.of("https://tos/a.mp3", "https://tos/b.mp3"), "mp3"))
                .thenThrow(unauthorized);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong()))
                .thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.captor();
        verify(finalizer).failMediaExtractJob(anyString(), code.capture(), message.capture(),
                details.capture(), anyString(), anyLong());
        assertThat(code.getValue()).isEqualTo("audio_mix_failed");
        assertThat(message.getValue()).doesNotContain("401").contains("上游凭证被拒绝");
        assertThat(details.getValue())
                .containsEntry("raw", "音频混合任务提交失败: 上游凭证被拒绝 request_id=req-sub-7")
                .containsEntry("http_status", 401);
    }

    @Test
    void upstreamUnauthorizedPollPersistsHttpStatusDetailWithoutRelyingOnMessageWording() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        MediaExtractError unauthorized = new MediaExtractError("provider_failed",
                "MediaKit 音频混合任务查询失败: HTTP 401 body={\"error\":{\"message\":\"Incorrect API key\"}}"
                        + " request_id=req-poll-3");
        unauthorized.initCause(new NewApiVideoClient.HttpStatusException(401));
        when(gateway.poll("sk-frozen", "provider-1")).thenThrow(unauthorized);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong()))
                .thenReturn(true);

        new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70");

        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.captor();
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), message.capture(),
                details.capture(), anyString(), anyLong());
        assertThat(message.getValue()).doesNotContain("401").contains("Incorrect API key");
        assertThat(details.getValue())
                .containsEntry("raw", "MediaKit 音频混合任务查询失败:"
                        + " body={\"error\":{\"message\":\"Incorrect API key\"}} request_id=req-poll-3")
                .containsEntry("http_status", 401);
    }

    @Test
    void lostFollowUpEnqueueReturnsWhenFenceIsNoLongerOwned() {
        when(claimService.claim(any(ClaimSpec.class), eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", List.of("https://tos/a.mp3", "https://tos/b.mp3"), "mp3"))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), eq("provider-1")))
                .thenReturn(true);
        doThrow(new IllegalStateException("MQ 不可用")).when(producer).enqueue("70", 5_000L);

        assertThatCode(() -> new AudioMixJobProcessor(stateMachine, claimService, jobMapper, finalizer, upstreamCredential, gateway, relay, producer).handle("70"))
                .doesNotThrowAnyException();
        verify(finalizer).failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong());
    }
}
