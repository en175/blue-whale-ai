package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.error.AudioProviderError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.audio.NewApiAudioClient;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 音频处理器错误映射测试（generation-worker.ts:367-446 + 686-728 逐字移植）。
 * <p>
 * 验证各错误路径正确映射到 failJob 的 code/message。
 */
@ExtendWith(MockitoExtension.class)
class AudioJobProcessorErrorMappingTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetSourceService assetSource;
    @Mock private UpstreamCredential upstreamCredential;
    @Mock private NewApiAudioClient audioClient;
    @Mock private TosMediaStorage tosService;

    private AudioJobProcessor processor;

    @BeforeEach
    void setUp() {
        processor = new AudioJobProcessor(stateMachine, finalizer, assetSource, upstreamCredential, audioClient, tosService);
    }

    @Test
    @DisplayName("上游凭证未配置 → provider_credential_missing")
    void missingCredential() {
        ClaimedJobDto job = claimWithInput(Map.of(
                "prompt", "hello",
                "model_id", "seed-audio-1.0"
        ));
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        when(upstreamCredential.requireKey())
                .thenThrow(new IllegalStateException(
                        "上游凭证未配置：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key"));
        processor.handle("100");

        verify(finalizer).failJob(eq("100"),
                eq(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING),
                contains("凭证"), any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("缺少 prompt → invalid_input")
    void missingPrompt() {
        ClaimedJobDto job = claimWithInput(Map.of(
                "model_id", "seed-audio-1.0"
        ));
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        processor.handle("100");

        verify(finalizer).failJob(eq("100"),
                eq(GenerationError.ERROR_INVALID_INPUT),
                anyString(), any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("旧 reference_asset_ids → invalid_reference")
    void oldReferenceField() {
        ClaimedJobDto job = claimWithInput(Map.of(
                "prompt", "hello",
                "model_id", "seed-audio-1.0",
                "reference_asset_ids", java.util.List.of("100")
        ));
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        processor.handle("100");

        verify(finalizer).failJob(eq("100"),
                eq(GenerationError.ERROR_INVALID_REFERENCE),
                contains("旧参考字段"), any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("TTS provider 超时 → provider_timeout")
    void providerTimeout() {
        ClaimedJobDto job = claimWithInput(Map.of(
                "prompt", "hello",
                "model_id", "seed-audio-1.0"
        ));
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));
        when(upstreamCredential.requireKey()).thenReturn("sk-token");
        when(audioClient.generate(anyString(), anyString(), anyString(), any()))
                .thenThrow(new AudioProviderError(
                        GenerationError.ERROR_PROVIDER_TIMEOUT, "new-api 音频生成超时"));

        processor.handle("100");

        ArgumentCaptor<String> codeCaptor = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failJob(eq("100"), codeCaptor.capture(),
                anyString(), any(), anyString(), anyLong());
        assertThat(codeCaptor.getValue()).isEqualTo(GenerationError.ERROR_PROVIDER_TIMEOUT);
    }

    @Test
    @DisplayName("TTS 额度耗尽 → quota_exhausted")
    void quotaExhausted() {
        ClaimedJobDto job = claimWithInput(Map.of(
                "prompt", "hello",
                "model_id", "seed-audio-1.0"
        ));
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));
        when(upstreamCredential.requireKey()).thenReturn("sk-token");
        when(audioClient.generate(anyString(), anyString(), anyString(), any()))
                .thenThrow(new AudioProviderError(
                        GenerationError.ERROR_QUOTA_EXHAUSTED, "余额不足"));

        processor.handle("100");

        ArgumentCaptor<String> codeCaptor = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failJob(eq("100"), codeCaptor.capture(),
                anyString(), any(), anyString(), anyLong());
        assertThat(codeCaptor.getValue()).isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("claim 返回空 → 静默退出")
    void claimEmpty() {
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.empty());

        processor.handle("100");

        verify(finalizer, never()).failJob(anyString(), anyString(),
                anyString(), any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("cancelRequested → failJob")
    void cancelRequested() {
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "42", "9", "audio",
                Map.of("prompt", "hello", "model_id", "m"),
                0,
                true, // cancelRequested = true
                5L
        );
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        processor.handle("100");

        verify(finalizer).failJob(eq("100"),
                eq(GenerationError.ERROR_PROVIDER_FAILED),
                anyString(), any(), anyString(), anyLong());
    }

    private ClaimedJobDto claimWithInput(Map<String, Object> input) {
        return new ClaimedJobDto(
                "100", "42", "9", "audio", input, 0, false, 5L);
    }
}
