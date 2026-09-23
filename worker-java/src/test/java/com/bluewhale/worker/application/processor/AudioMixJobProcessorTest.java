package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient.MixAudioTaskObservation;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AudioMixJobProcessorTest {
    @Mock JobStateMachineService stateMachine;
    @Mock GenerationCredentialService credentials;
    @Mock NewApiMediaKitMixAudioClient gateway;
    @Mock TosAudioMediaRelay relay;
    @Mock GenerationMessageProducer producer;

    private Map<String, Object> input() {
        return Map.of(
                "source_node_id", "source-node",
                "output_format", "mp3",
                "provider_credential", "sk-frozen",
                "inputs", List.of(
                        Map.of("asset_id", "11", "node_id", "source-node", "url", "https://tos/a.mp3"),
                        Map.of("asset_id", "12", "url", "https://tos/b.mp3")));
    }

    private ClaimedMediaExtractJobDto claim(String providerTaskId) {
        return new ClaimedMediaExtractJobDto("70", "5", "9", input(), providerTaskId,
                "worker-1", 3L, 0, 0);
    }

    @Test
    void submitPersistsProviderTaskIdAndSchedulesPoll() {
        when(stateMachine.claimAudioMix(eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", List.of("https://tos/a.mp3", "https://tos/b.mp3"), "mp3"))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), eq("provider-1"))).thenReturn(true);

        new AudioMixJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(producer).enqueue("70", 5_000L);
        verify(stateMachine, never()).publishAudioMixResult(any());
    }

    @Test
    void completedTaskPublishesOnlyTheStoredUrlAndProviderDuration() {
        when(stateMachine.claimAudioMix(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("succeeded", "https://temporary/out.mp3", 12.5, null, null));
        when(relay.persist("https://temporary/out.mp3", "9", "mp3"))
                .thenReturn(new TosAudioMediaRelay.StoredAudio("https://our-tos/out.mp3", "generated/9/out.mp3", "audio/mpeg", 100L, "md5"));

        new AudioMixJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        ArgumentCaptor<PublishMediaExtractDto> result = ArgumentCaptor.forClass(PublishMediaExtractDto.class);
        verify(stateMachine).publishAudioMixResult(result.capture());
        assertThat(result.getValue().url()).isEqualTo("https://our-tos/out.mp3");
        assertThat(result.getValue().duration()).isEqualTo(12.5);
    }

    @Test
    void providerFailurePersistsRequestIdAndDoesNotCreateAsset() {
        when(stateMachine.claimAudioMix(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("failed", null, null,
                        "provider_error", "上游处理失败", "request-42"));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        new AudioMixJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        ArgumentCaptor<FailMediaExtractDto> failure = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(failure.capture());
        assertThat(failure.getValue().code()).isEqualTo("audio_mix_failed");
        assertThat(failure.getValue().message()).contains("request-42");
        verify(stateMachine, never()).publishAudioMixResult(any());
        verifyNoInteractions(relay);
    }

    @Test
    void missingProviderResultFailsBeforeStorage() {
        when(stateMachine.claimAudioMix(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("succeeded", null, 12.5,
                        null, null, "request-43"));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        new AudioMixJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        ArgumentCaptor<FailMediaExtractDto> failure = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(failure.capture());
        assertThat(failure.getValue().message()).contains("request-43");
        verifyNoInteractions(relay);
        verify(stateMachine, never()).publishAudioMixResult(any());
    }

    @Test
    void relayFailureMarksJobFailedWithoutPublishingTemporaryUrl() {
        when(stateMachine.claimAudioMix(eq("70"), anyString())).thenReturn(Optional.of(claim("provider-1")));
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.poll("sk-frozen", "provider-1"))
                .thenReturn(new MixAudioTaskObservation("succeeded", "https://temporary/out.mp3",
                        12.5, null, null));
        when(relay.persist("https://temporary/out.mp3", "9", "mp3"))
                .thenThrow(new MediaExtractError("upload_failed", "TOS 转存失败"));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        new AudioMixJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70");

        verify(stateMachine).failMediaExtractJob(argThat(failure ->
                failure.code().equals("audio_mix_failed") && failure.message().contains("TOS 转存失败")));
        verify(stateMachine, never()).publishAudioMixResult(any());
    }

    @Test
    void lostFollowUpEnqueueReturnsWhenFenceIsNoLongerOwned() {
        when(stateMachine.claimAudioMix(eq("70"), anyString())).thenReturn(Optional.of(claim(null)));
        when(credentials.open("sk-frozen")).thenReturn("sk-frozen");
        when(gateway.submit("sk-frozen", List.of("https://tos/a.mp3", "https://tos/b.mp3"), "mp3"))
                .thenReturn("provider-1");
        when(stateMachine.markProviderSubmitted(eq("70"), anyString(), eq(3L), eq("provider-1")))
                .thenReturn(true);
        doThrow(new IllegalStateException("MQ 不可用")).when(producer).enqueue("70", 5_000L);

        assertThatCode(() -> new AudioMixJobProcessor(stateMachine, credentials, gateway, relay, producer).handle("70"))
                .doesNotThrowAnyException();
        verify(stateMachine).failMediaExtractJob(any());
    }
}
