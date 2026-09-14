package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.audio.NewApiAudioClient;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.Arguments;
import java.util.stream.Stream;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 音频文本附件执行消费测试（IKFCXE：附件作为创作上下文与主提示词共同进入生成）。
 * <p>
 * 验证（对齐 Node generation-worker.test.ts IKFCXE 组与 VideoJobProcessor 组合语义）：
 * - text_attachments 存在 → audioClient.generate 收到组合 prompt（非空白附件正文在前、
 *   主提示词最后追加、"\n\n" 连接，不改写正文、不添加朗读指令）
 * - 无 text_attachments 的旧任务 → prompt 原样透传（回归，逐字节不变）
 * - 快照形状损坏 → 按无附件处理（与视频侧 textAttachments 同源语义）
 * - prompt 为空且仅有附件 → 保持既有校验拒绝（音频不引入"仅附件生成"）
 */
@ExtendWith(MockitoExtension.class)
class AudioJobProcessorTextAttachmentTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private AssetSourceService assetSource;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiAudioClient audioClient;
    @Mock private TosMediaStorage tosService;

    private AudioJobProcessor processor;

    @BeforeEach
    void setUp() {
        processor = new AudioJobProcessor(stateMachine, assetSource, credentialService, audioClient, tosService);
    }

    /** 走通成功路径：generate 返回 data → TOS 转存 → createAsset → completeJob。 */
    private void stubSuccessPath() {
        when(credentialService.open("v1.aaa.bbb.ccc")).thenReturn("sk-token");
        when(audioClient.generate(anyString(), anyString(), anyString(), any()))
                .thenReturn(new NewApiAudioClient.AudioResult(
                        new byte[]{1, 2, 3}, null, "audio/mpeg", null, "req-1"));
        when(tosService.uploadBytes(any(), eq("audio/mpeg")))
                .thenReturn(new TosMediaStorage.UploadResult("https://pub/a.mp3", "k", "audio/mpeg", 3L));
        when(stateMachine.createAsset(any())).thenReturn("a1");
        when(stateMachine.completeJob(eq("100"), anyList(), anyString(), anyLong()))
                .thenReturn(true);
    }

    static Stream<Arguments> audioPromptSnapshots() {
        String fallback = "雨夜街道，两个人争吵\n\n远处有雷声\n\n生成环境音";
        String frozen = "文本1：雨夜街道，两个人争吵\n\n基于文本1生成环境音";
        return Stream.of(Arguments.of(123, fallback), Arguments.of("   ", fallback), Arguments.of(frozen, frozen));
    }

    @ParameterizedTest
    @MethodSource("audioPromptSnapshots")
    @DisplayName("音频优先消费冻结编号正文，损坏或空白快照回退附件组合")
    void composedPromptWithAttachments(Object composed, String expected) {
        ClaimedJobDto job = claimWithInput(Map.of(
                "prompt", "生成环境音",
                "composed_prompt", composed,
                "model_id", "seed-audio-1.0",
                "provider_credential", "v1.aaa.bbb.ccc",
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

        // 完整附件正文与主提示词共同送达供应商（空白附件跳过、"\n\n" 连接、主提示词最后）
        verify(audioClient).generate(eq("sk-token"), eq("seed-audio-1.0"),
                eq(expected), any());
        verify(stateMachine).completeJob(eq("100"), eq(List.of("a1")), anyString(), eq(5L));
    }

    @Test
    @DisplayName("无 text_attachments 的旧任务：generate prompt 原样透传（回归）")
    void legacyJobWithoutAttachments() {
        ClaimedJobDto job = claimWithInput(Map.of(
                "prompt", "海浪",
                "model_id", "seed-audio-1.0",
                "provider_credential", "v1.aaa.bbb.ccc"
        ));
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));
        stubSuccessPath();

        processor.handle("100");

        verify(audioClient).generate(eq("sk-token"), eq("seed-audio-1.0"),
                eq("海浪"), any());
    }

    @Test
    @DisplayName("快照形状损坏（元素缺 text 字段）→ 按无附件处理，prompt 原样透传")
    void corruptedSnapshotTreatedAsNoAttachments() {
        ClaimedJobDto job = claimWithInput(Map.of(
                "prompt", "海浪",
                "model_id", "seed-audio-1.0",
                "provider_credential", "v1.aaa.bbb.ccc",
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
                "provider_credential", "v1.aaa.bbb.ccc",
                "text_attachments", List.of(
                        Map.of("node_id", "n1", "title", "场景", "text", "雨夜街道，两个人争吵")
                )
        ));
        when(stateMachine.claimAudioJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        processor.handle("100");

        verify(stateMachine).failJob(eq("100"),
                eq(GenerationError.ERROR_INVALID_INPUT),
                eq("缺少 prompt 或 model_id"), any(), anyString(), anyLong());
        verify(audioClient, never()).generate(anyString(), anyString(), anyString(), any());
    }

    private ClaimedJobDto claimWithInput(Map<String, Object> input) {
        return new ClaimedJobDto(
                "100", "42", "9", "audio", input, 1, 0, false, 5L);
    }
}
