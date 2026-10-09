package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.audio.NewApiAudioClient;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.Arguments;
import java.util.stream.Stream;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AudioJobProcessorTextAttachmentTest {

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

    private void stubSuccessPath() {
        when(upstreamCredential.requireKey()).thenReturn("sk-token");
        when(audioClient.generate(anyString(), anyString(), anyString(), any()))
                .thenReturn(new NewApiAudioClient.AudioResult(
                        new byte[]{1, 2, 3}, null, "audio/mpeg", 12.4, "req-1"));
        when(tosService.uploadBytes(any(), eq("audio/mpeg")))
                .thenReturn(new TosMediaStorage.UploadResult("https://pub/a.mp3", "k", "audio/mpeg", 3L, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.createAsset(any())).thenReturn("a1");
        when(finalizer.completeJob(eq("100"), anyList(), anyString(), anyLong(), any()))
                .thenReturn(true);
    }

    static Stream<Arguments> ignoredComposedPrompts() {
        return Stream.of(
                Arguments.of("文本1：雨夜街道，两个人争吵\n\n基于文本1生成环境音"),
                Arguments.of(123),
                Arguments.of("   "));
    }

    @ParameterizedTest
    @MethodSource("ignoredComposedPrompts")
    @DisplayName("IKG6EK: composed_prompt 不再被消费 → 正文取 input.prompt")
    void composedPromptIsIgnored(Object composed) {
        ClaimedJobDto job = claimWithInput(Map.of(
                "prompt", "生成环境音",
                "composed_prompt", composed,
                "model_id", "seed-audio-1.0",
                "text_attachments", List.of(
                        Map.of("node_id", "n1", "title", "场景", "text", "雨夜街道，两个人争吵"),
                        Map.of("node_id", "n2", "title", "空白附件", "text", "   "),
                        Map.of("node_id", "n3", "title", "氛围", "text", "远处有雷声")
                )
        ));
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));
        stubSuccessPath();

        processor.handle("100");

        verify(audioClient).generate(eq("sk-token"), eq("seed-audio-1.0"),
                eq("生成环境音"), any());
        verify(finalizer).completeJob(eq("100"), eq(List.of("a1")), anyString(), eq(5L), eq(12L));
        ArgumentCaptor<JobStateMachineService.CreateAssetInput> assetCaptor =
                ArgumentCaptor.forClass(JobStateMachineService.CreateAssetInput.class);
        verify(stateMachine).createAsset(assetCaptor.capture());
        assertThat(assetCaptor.getValue().md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(assetCaptor.getValue().durationMs()).isEqualTo(12_400);
    }

    @Test
    @DisplayName("无 text_attachments 的旧任务：generate prompt 原样透传（回归）")
    void legacyJobWithoutAttachments() {
        ClaimedJobDto job = claimWithInput(Map.of(
                "prompt", "海浪",
                "model_id", "seed-audio-1.0"
        ));
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));
        stubSuccessPath();

        processor.handle("100");

        verify(audioClient).generate(eq("sk-token"), eq("seed-audio-1.0"),
                eq("海浪"), any());
    }

    @Test
    @DisplayName("text_attachments 形状损坏也不再影响正文 → prompt 原样透传")
    void corruptedSnapshotDoesNotAffectPrompt() {
        ClaimedJobDto job = claimWithInput(Map.of(
                "prompt", "海浪",
                "model_id", "seed-audio-1.0",
                "text_attachments", List.of(
                        Map.of("node_id", "n1", "title", "缺正文字段")
                )
        ));
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));
        stubSuccessPath();

        processor.handle("100");

        verify(audioClient).generate(eq("sk-token"), eq("seed-audio-1.0"),
                eq("海浪"), any());
    }

    @Test
    @DisplayName("prompt 为空且仅有附件 → 保持既有校验拒绝（不引入仅附件生成）")
    void emptyPromptWithAttachmentsStillRejected() {
        ClaimedJobDto job = claimWithInput(Map.of(
                "prompt", "",
                "model_id", "seed-audio-1.0",
                "text_attachments", List.of(
                        Map.of("node_id", "n1", "title", "场景", "text", "雨夜街道，两个人争吵")
                )
        ));
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        processor.handle("100");

        verify(finalizer).failJob(eq("100"),
                eq(GenerationError.ERROR_INVALID_INPUT),
                eq("缺少 prompt 或 model_id"), any(), anyString(), anyLong());
        verify(audioClient, never()).generate(anyString(), anyString(), anyString(), any());
    }

    private ClaimedJobDto claimWithInput(Map<String, Object> input) {
        return new ClaimedJobDto(
                "100", "42", "9", "audio", input, 0, false, 5L);
    }
}
