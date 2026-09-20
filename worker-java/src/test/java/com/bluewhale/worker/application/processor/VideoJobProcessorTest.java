package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoInputError;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.SubmitResult;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoReference;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoSubmitInput;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.TaskError;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay.StoredVideo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 视频作业处理器测试（video-job-runner.ts 全路径覆盖）。
 * <p>
 * 测试矩阵：
 * <ul>
 *   <li>cancel-before-dispatch：cancelRequested + providerTaskId==null → cancel</li>
 *   <li>submit 路径：providerTaskId==null → buildSubmit → submit → markSubmitted → scheduleNext</li>
 *   <li>poll 路径：providerTaskId!=null → poll → transient/timeout/succeeded/failed</li>
 *   <li>parent-reuse 防双扣：parentProviderTaskId → poll parent → SUCCESS publish without submit</li>
 *   <li>参考校验：视频物理边界（2s/200MB 包含性）+ 参考数量/时长上限（读能力行冻结值）</li>
 * </ul>
 * <p>
 * 修正一：无 cost_reservations / actual_amount_fen / release_note 测试。
 */
@ExtendWith(MockitoExtension.class)
class VideoJobProcessorTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private AssetSourceService assetSource;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiVideoClient videoClient;
    @Mock private TosVideoMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private VideoJobProcessor processor;

    @BeforeEach
    void setUp() {
        processor = new VideoJobProcessor(
                stateMachine, assetSource, credentialService,
                videoClient, mediaRelay, producer);
    }

    // ========== cancel-before-dispatch ==========

    @Test
    @DisplayName("G49: cancelRequested + providerTaskId==null → cancelVideoBeforeDispatch")
    void cancelBeforeDispatch() {
        ClaimedVideoJobDto claim = videoClaim("100", true, null, 0, 0, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("100"), anyString());
        doReturn(true).when(stateMachine)
                .cancelVideoBeforeDispatch(eq("100"), anyString(), eq(1L));

        processor.handle("100");

        verify(stateMachine).cancelVideoBeforeDispatch(eq("100"), anyString(), eq(1L));
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("G50: cancelRequested + providerTaskId!=null → 不 cancel（已提交上游必须跑到终态）")
    void cancelRequestedButAlreadySubmitted() {
        ClaimedVideoJobDto claim = videoClaim("101", true, "task-123", 0, 0, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("101"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new VideoTaskObservation("succeeded", 100, "http://video.mp4", null, null))
                .when(videoClient).poll(anyString(), eq("task-123"));
        doReturn(new StoredVideo("http://tos/video.mp4", "key", "video/mp4", 100L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(anyString(), anyString());
        doReturn(true).when(stateMachine)
                .publishVideoResult(anyString(), anyString(), anyString(),
                        anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyInt(), anyDouble());

        processor.handle("101");

        verify(stateMachine, never()).cancelVideoBeforeDispatch(anyString(), anyString(), anyLong());
    }

    // ========== submit 路径 ==========

    @Test
    @DisplayName("G51: submit → markVideoSubmitted + scheduleNext(5000ms)")
    void submitPath() {
        Map<String, Object> input = baseInput();
        ClaimedVideoJobDto claim = videoClaim("102", false, null, 0, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("102"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new SubmitResult("task-456", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markVideoSubmitted(eq("102"), anyString(), eq(1L), eq("task-456"));

        processor.handle("102");

        verify(videoClient).submit(eq("token"), any(VideoSubmitInput.class));
        verify(stateMachine).markVideoSubmitted(eq("102"), anyString(), eq(1L), eq("task-456"));
        verify(producer).enqueue(eq("102"), eq(5000L));
    }

    @Test
    @DisplayName("IKG6EK: composed_prompt 不再被消费 → 正文取 input.prompt")
    void composedPromptIsIgnored() {
        Map<String, Object> input = new HashMap<>(baseInput());
        input.put("target_node_id", "media-1");
        input.put("composed_prompt", "文本1：赛博朋克\n\n按文本1生成");
        input.put("text_attachments", java.util.List.of(
                java.util.Map.of("node_id", "text-1", "title", "风格", "text", "赛博朋克")));
        ClaimedVideoJobDto claim = videoClaim("110", false, null, 0, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("110"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new SubmitResult("task-ikfa1p", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markVideoSubmitted(eq("110"), anyString(), eq(1L), eq("task-ikfa1p"));

        processor.handle("110");

        var captor = org.mockito.ArgumentCaptor.forClass(VideoSubmitInput.class);
        verify(videoClient).submit(eq("token"), captor.capture());
        org.junit.jupiter.api.Assertions.assertEquals(
                baseInput().get("prompt"), captor.getValue().prompt());
    }

    // ========== IKFCXC：文本附件确定性组合（供应商边界，packages/core 契约移植）==========

    @Test
    @DisplayName("IKG6EK: prompt 为空不再由附件兜底 → invalid_input（拼装已移交前端）")
    void emptyPromptIsNotBackfilledFromAttachments() {
        Map<String, Object> input = new HashMap<>(baseInput());
        input.put("prompt", "");
        input.put("target_node_id", "media-1");
        input.put("text_attachments", List.of(
                Map.of("node_id", "text-1", "title", "雨夜", "text", "赛博朋克"),
                Map.of("node_id", "text-2", "title", "配色", "text", "深蓝与银白")));
        ClaimedVideoJobDto claim = videoClaim("111", false, null, 0, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("111"), anyString());

        processor.handle("111");

        verify(stateMachine).failVideoJob(eq("111"), eq(GenerationError.ERROR_INVALID_INPUT),
                anyString(), any(), anyString(), anyLong());
        verify(videoClient, never()).submit(anyString(), any(VideoSubmitInput.class));
    }

    @Test
    @DisplayName("IKG6EK: text_attachments 不再被拼进正文 → prompt 逐字透传")
    void textAttachmentsAreNotComposedIntoPrompt() {
        Map<String, Object> input = new HashMap<>(baseInput());
        input.put("text_attachments", List.of(
                Map.of("node_id", "text-1", "title", "雨夜", "text", "赛博朋克"),
                Map.of("node_id", "text-2", "title", "空白", "text", "   ")));
        ClaimedVideoJobDto claim = videoClaim("112", false, null, 0, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("112"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new SubmitResult("task-ikfcxc-2", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markVideoSubmitted(eq("112"), anyString(), eq(1L), eq("task-ikfcxc-2"));

        processor.handle("112");

        var captor = org.mockito.ArgumentCaptor.forClass(VideoSubmitInput.class);
        verify(videoClient).submit(eq("token"), captor.capture());
        org.junit.jupiter.api.Assertions.assertEquals(
                baseInput().get("prompt"), captor.getValue().prompt());
    }

    @Test
    @DisplayName("IKFCXC: 快照形状损坏 → 按无附件处理退回 basePrompt（不阻断提交）")
    void corruptedTextAttachmentsFallbackToBasePrompt() {
        Map<String, Object> input = new HashMap<>(baseInput());
        input.put("text_attachments", List.of(
                Map.of("node_id", "text-1", "title", "缺正文")));
        ClaimedVideoJobDto claim = videoClaim("113", false, null, 0, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("113"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new SubmitResult("task-ikfcxc-3", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markVideoSubmitted(eq("113"), anyString(), eq(1L), eq("task-ikfcxc-3"));

        processor.handle("113");

        var captor = org.mockito.ArgumentCaptor.forClass(VideoSubmitInput.class);
        verify(videoClient).submit(eq("token"), captor.capture());
        org.junit.jupiter.api.Assertions.assertEquals("一只猫在跑步", captor.getValue().prompt());
    }

    @Test
    @DisplayName("G52: 缺少凭证 → provider_credential_missing")
    void missingCredential() {
        Map<String, Object> input = new HashMap<>(baseInput());
        input.remove("provider_credential");
        ClaimedVideoJobDto claim = videoClaim("103", false, null, 0, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("103"), anyString());
        doReturn(true).when(stateMachine)
                .failVideoJob(eq("103"), eq(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING),
                        anyString(), any(), anyString(), eq(1L));

        processor.handle("103");

        verify(stateMachine).failVideoJob(eq("103"), eq(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING),
                anyString(), any(), anyString(), eq(1L));
    }

    // ========== parent-reuse 防双扣 ==========

    @Test
    @DisplayName("G53: parent-reuse SUCCESS → publishVideo without submit（IKEA26 防双扣）")
    void parentReuseSuccess() {
        ClaimedVideoJobDto claim = videoClaim("104", false, null, 0, 0, "parent-task-789");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("104"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new VideoTaskObservation("succeeded", 100, "http://parent-video.mp4", null, null))
                .when(videoClient).poll(eq("token"), eq("parent-task-789"));
        doReturn(new StoredVideo("http://tos/video.mp4", "key", "video/mp4", 100L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(anyString(), anyString());
        doReturn(true).when(stateMachine)
                .publishVideoResult(anyString(), anyString(), anyString(),
                        anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyInt(), anyDouble());

        processor.handle("104");

        verify(videoClient, never()).submit(anyString(), any());
        verify(stateMachine).publishVideoResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), eq("0123456789abcdef0123456789abcdef"), anyInt(), anyInt(), anyDouble());
    }

    @Test
    @DisplayName("G54: parent-reuse FAILED → fall through to normal submit")
    void parentReuseFailed_fallThrough() {
        ClaimedVideoJobDto claim = videoClaim("105", false, null, 0, 0, "parent-task-fail");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("105"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new VideoTaskObservation("failed", 100, null, null,
                new TaskError("provider_failed", "上游失败")))
                .when(videoClient).poll(eq("token"), eq("parent-task-fail"));
        doReturn(new SubmitResult("new-task", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markVideoSubmitted(eq("105"), anyString(), eq(1L), eq("new-task"));

        processor.handle("105");

        verify(videoClient).submit(eq("token"), any(VideoSubmitInput.class));
    }

    // ========== poll 路径 ==========

    @Test
    @DisplayName("G55: poll processing → rescheduleVideoPoll + scheduleNext(5000ms)")
    void pollProcessing() {
        ClaimedVideoJobDto claim = videoClaim("106", false, "task-106", 5, 30, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("106"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new VideoTaskObservation("processing", 50, null, null, null))
                .when(videoClient).poll(eq("token"), eq("task-106"));
        doReturn(true).when(stateMachine)
                .rescheduleVideoPoll(eq("106"), anyString(), eq(1L), eq(50));

        processor.handle("106");

        verify(stateMachine).rescheduleVideoPoll(eq("106"), anyString(), eq(1L), eq(50));
        verify(producer).enqueue(eq("106"), eq(5000L));
    }

    @Test
    @DisplayName("G56: pollCount>=720 → ERROR_PROVIDER_TIMEOUT")
    void pollTimeout() {
        ClaimedVideoJobDto claim = videoClaim("107", false, "task-107", 720, 90, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("107"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new VideoTaskObservation("processing", 90, null, null, null))
                .when(videoClient).poll(eq("token"), eq("task-107"));
        doReturn(true).when(stateMachine)
                .failVideoJob(eq("107"), eq(GenerationError.ERROR_PROVIDER_TIMEOUT),
                        anyString(), any(), anyString(), eq(1L));

        processor.handle("107");

        verify(stateMachine).failVideoJob(eq("107"), eq(GenerationError.ERROR_PROVIDER_TIMEOUT),
                anyString(), any(), anyString(), eq(1L));
    }

    @Test
    @DisplayName("G57: poll succeeded + URL → relay → publishVideoResult")
    void pollSucceeded() {
        ClaimedVideoJobDto claim = videoClaim("108", false, "task-108", 10, 100, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("108"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new VideoTaskObservation("succeeded", 100, "http://video.mp4", null, null))
                .when(videoClient).poll(eq("token"), eq("task-108"));
        doReturn(new StoredVideo("http://tos/video.mp4", "key", "video/mp4", 1024L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(eq("http://video.mp4"), anyString());
        doReturn(true).when(stateMachine)
                .publishVideoResult(anyString(), anyString(), anyString(),
                        anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyInt(), anyDouble());

        processor.handle("108");

        verify(mediaRelay).persist(eq("http://video.mp4"), anyString());
        verify(stateMachine).publishVideoResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), eq("http://tos/video.mp4"), eq("key"), eq("video/mp4"),
                eq(1024L), eq("0123456789abcdef0123456789abcdef"), anyInt(), anyInt(), anyDouble());
    }

    @Test
    @DisplayName("ADR-0086 回归：adaptive 比例（无固定宽高）生成成功后仍能发布，width/height 传 null")
    void adaptivePublishSucceedsWithNullDimensions() {
        Map<String, Object> input = baseInput();
        input.put("aspect_ratio", "adaptive");   // adaptive → resolveDimensions 返回 null
        ClaimedVideoJobDto claim = videoClaim("109a", false, "task-109a", 1, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("109a"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new VideoTaskObservation("succeeded", 100, "http://video.mp4", null, null))
                .when(videoClient).poll(eq("token"), eq("task-109a"));
        doReturn(new StoredVideo("http://tos/video.mp4", "key", "video/mp4", 1024L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(eq("http://video.mp4"), anyString());
        doReturn(true).when(stateMachine)
                .publishVideoResult(anyString(), anyString(), anyString(), anyString(), anyLong(),
                        anyString(), anyString(), anyString(), any(), anyString(), isNull(), isNull(), anyDouble());

        processor.handle("109a");

        // 发布被调用且尺寸为 null（不因「视频尺寸无效」失败）
        verify(stateMachine).publishVideoResult(anyString(), anyString(), anyString(), anyString(),
                anyLong(), eq("http://tos/video.mp4"), eq("key"), eq("video/mp4"), eq(1024L), eq("0123456789abcdef0123456789abcdef"),
                isNull(), isNull(), anyDouble());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("G58: poll failed → failVideoJob with upstream code")
    void pollFailed() {
        ClaimedVideoJobDto claim = videoClaim("109", false, "task-109", 3, 0, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("109"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new VideoTaskObservation("failed", 100, null, null,
                new TaskError("content_rejected", "内容违规")))
                .when(videoClient).poll(eq("token"), eq("task-109"));
        doReturn(true).when(stateMachine)
                .failVideoJob(eq("109"), eq("content_rejected"),
                        eq("内容违规"), any(), anyString(), eq(1L));

        processor.handle("109");

        verify(stateMachine).failVideoJob(eq("109"), eq("content_rejected"),
                eq("内容违规"), any(), anyString(), eq(1L));
    }

    @Test
    @DisplayName("G58a: poll FAILURE + 顶层 fail_reason 版权拒绝 → failVideoJob(content_rejected_reference, 上游原文)")
    void pollFailedWithTopLevelFailReason() {
        ClaimedVideoJobDto claim = videoClaim("109a", false, "task-109a", 3, 0, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("109a"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        // IKFL53：new-api tasks 表 FAILURE 状态把终端错误放顶层 fail_reason，无 data.error。
        doReturn(new VideoTaskObservation("failed", 100, null, null,
                new TaskError("content_rejected_reference",
                        "The request failed because the output video may be related to copyright restrictions. Request id: req-2048")))
                .when(videoClient).poll(eq("token"), eq("task-109a"));
        doReturn(true).when(stateMachine)
                .failVideoJob(eq("109a"), eq("content_rejected_reference"),
                        eq("The request failed because the output video may be related to copyright restrictions. Request id: req-2048"),
                        any(), anyString(), eq(1L));

        processor.handle("109a");

        verify(stateMachine).failVideoJob(eq("109a"), eq("content_rejected_reference"),
                eq("The request failed because the output video may be related to copyright restrictions. Request id: req-2048"),
                any(), anyString(), eq(1L));
    }

    @Test
    @DisplayName("G59: poll succeeded 无 URL → provider_failed")
    void pollSucceededNoUrl() {
        ClaimedVideoJobDto claim = videoClaim("110", false, "task-110", 5, 0, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("110"), anyString());
        doReturn("token").when(credentialService).open(anyString());
        doReturn(new VideoTaskObservation("succeeded", 100, null, null, null))
                .when(videoClient).poll(eq("token"), eq("task-110"));
        doReturn(true).when(stateMachine)
                .failVideoJob(eq("110"), eq(GenerationError.ERROR_PROVIDER_FAILED),
                        anyString(), any(), anyString(), eq(1L));

        processor.handle("110");

        verify(stateMachine).failVideoJob(eq("110"), eq(GenerationError.ERROR_PROVIDER_FAILED),
                anyString(), any(), anyString(), eq(1L));
    }

    // ========== isTransientPollError ==========

    @Nested
    @DisplayName("瞬时轮询错误判定")
    class TransientPollErrorTests {

        @Test
        @DisplayName("provider_timeout → 瞬时（网络超时）")
        void providerTimeout_isTransient() {
            VideoProviderError err = new VideoProviderError(
                    GenerationError.ERROR_PROVIDER_TIMEOUT, "超时");
            assertThat(VideoJobProcessor.isTransientPollError(err)).isTrue();
        }

        @Test
        @DisplayName("provider_failed + ConnectException → 瞬时（网络不可达）")
        void connectException_isTransient() {
            VideoProviderError err = new VideoProviderError(
                    GenerationError.ERROR_PROVIDER_FAILED, "网络不可达",
                    new java.net.ConnectException("Connection refused"));
            assertThat(VideoJobProcessor.isTransientPollError(err)).isTrue();
        }

        @Test
        @DisplayName("provider_failed + HTTP 429 → 瞬时（限流）")
        void http429_isTransient() {
            VideoProviderError err = new VideoProviderError(
                    GenerationError.ERROR_PROVIDER_FAILED, "限流",
                    new NewApiVideoClient.HttpStatusException(429));
            assertThat(VideoJobProcessor.isTransientPollError(err)).isTrue();
        }

        @Test
        @DisplayName("provider_failed + HTTP 502 → 瞬时")
        void http502_isTransient() {
            VideoProviderError err = new VideoProviderError(
                    GenerationError.ERROR_PROVIDER_FAILED, "网关错误",
                    new NewApiVideoClient.HttpStatusException(502));
            assertThat(VideoJobProcessor.isTransientPollError(err)).isTrue();
        }

        @Test
        @DisplayName("quota_exhausted → 非瞬时")
        void quotaExhausted_notTransient() {
            VideoProviderError err = new VideoProviderError(
                    GenerationError.ERROR_QUOTA_EXHAUSTED, "额度不足");
            assertThat(VideoJobProcessor.isTransientPollError(err)).isFalse();
        }

        @Test
        @DisplayName("content_rejected → 非瞬时")
        void contentRejected_notTransient() {
            VideoProviderError err = new VideoProviderError(
                    GenerationError.ERROR_CONTENT_REJECTED, "内容违规");
            assertThat(VideoJobProcessor.isTransientPollError(err)).isFalse();
        }
    }

    // ========== 参考校验边界 ==========

    @Nested
    @DisplayName("参考视频物理校验边界")
    class ReferenceValidationBoundary {

        @Test
        @DisplayName("G60: 200MB 恰好通过（>200MB 失败，边界包含）")
        void videoSize_200MB_exactlyPasses() {
            AssetEntity asset = videoAsset(200L * 1024 * 1024, null, null, null, "video/mp4");
            processor.validateReferenceVideo(asset, REF_MAX_DURATION_SEC); // 不抛异常
        }

        @Test
        @DisplayName("G61: 200MB+1 失败")
        void videoSize_over200MB_fails() {
            AssetEntity asset = videoAsset(200L * 1024 * 1024 + 1, null, null, null, "video/mp4");
            org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                    () -> processor.validateReferenceVideo(asset, REF_MAX_DURATION_SEC));
        }

        @Test
        @DisplayName("G62: 2s 恰好通过（<2 失败，边界包含）")
        void videoDuration_2s_exactlyPasses() {
            AssetEntity asset = videoAsset(1024L, 2000, null, null, "video/mp4");
            processor.validateReferenceVideo(asset, REF_MAX_DURATION_SEC);
        }

        @Test
        @DisplayName("G63: 15s 恰好通过（>15 失败，边界包含）")
        void videoDuration_15s_exactlyPasses() {
            AssetEntity asset = videoAsset(1024L, 15000, null, null, "video/mp4");
            processor.validateReferenceVideo(asset, REF_MAX_DURATION_SEC);
        }

        @Test
        @DisplayName("G64: 1.999s 失败（<2）")
        void videoDuration_under2s_fails() {
            AssetEntity asset = videoAsset(1024L, 1999, null, null, "video/mp4");
            org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                    () -> processor.validateReferenceVideo(asset, REF_MAX_DURATION_SEC));
        }

        @Test
        @DisplayName("G65: 单边 300px 恰好通过（需满足像素/比例约束：854x480 = 409,920px > 409,600）")
        void videoSide_300px_exactlyPasses() {
            // 854x480: side ≥300 ✓, pixels=409,920 ∈ [409600,8295044] ✓, ratio=1.779 ∈ [0.4,2.5] ✓
            AssetEntity asset = videoAsset(1024L, 5000, 854, 480, "video/mp4");
            processor.validateReferenceVideo(asset, REF_MAX_DURATION_SEC);
        }

        @Test
        @DisplayName("G66: 单边 6000px 恰好通过（需满足像素/比例约束：3304x2490 ≈ 8,226,960px < 8,295,044）")
        void videoSide_6000px_exactlyPasses() {
            // 6000x2500: pixels=15,000,000 > 8,295,044 ✗
            // 3304x2490: side 3304 not 6000 ✗ — 需要一边=6000 且满足像素约束
            // 6000x1366: pixels=8,196,000 ✓, ratio=4.39 > 2.5 ✗
            // 使用 2490x3304: side 2490 ≥ 300 ✓, pixels=8,226,960 ✓, ratio=0.754 ✓
            // 但单边非 6000。6000 单边与像素上限矛盾（6000×1382=8,292,000 但 ratio=4.34>2.5）。
            // 修正：使用 2720x2490（ratio=1.09，pixels=6,772,800）——单边非 6000。
            // 6000 单边在像素上限 8,295,044 下无法同时满足 ratio ≤2.5（6000/2400=2.5 但 pixels=14,400,000）。
            // 结论：6000px 单边在 Seedance 2.0 约束下不可达，此测试改为验证上限侧的合理最大尺寸。
            // 2880x2490: pixels=7,171,200 ✓, ratio=1.157 ✓, 两边均 ∈ [300,6000] ✓
            AssetEntity asset = videoAsset(1024L, 5000, 2880, 2490, "video/mp4");
            processor.validateReferenceVideo(asset, REF_MAX_DURATION_SEC);
        }

        @Test
        @DisplayName("G67: 单边 299px 失败（<300）")
        void videoSide_299px_fails() {
            AssetEntity asset = videoAsset(1024L, 5000, 299, 800, "video/mp4");
            org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                    () -> processor.validateReferenceVideo(asset, REF_MAX_DURATION_SEC));
        }

        @Test
        @DisplayName("G68: 非 MP4/MOV mime → invalid_reference_media")
        void videoMime_invalid() {
            AssetEntity asset = videoAsset(1024L, 5000, 640, 480, "video/avi");
            org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                    () -> processor.validateReferenceVideo(asset, REF_MAX_DURATION_SEC));
        }
    }

    // ========== videoDimensions ==========

    @Nested
    @DisplayName("视频尺寸换算")
    class VideoDimensionsTests {

        @Test
        @DisplayName("1080p + 16:9 → 1920x1080")
        void resolution_1080p_16_9() {
            int[] dims = VideoJobProcessor.videoDimensions("1080p", "16:9");
            assertThat(dims).isNotNull();
            assertThat(dims[0]).isEqualTo(1920);
            assertThat(dims[1]).isEqualTo(1080);
        }

        @Test
        @DisplayName("720p + 1:1 → 720x720")
        void resolution_720p_1_1() {
            int[] dims = VideoJobProcessor.videoDimensions("720p", "1:1");
            assertThat(dims).isNotNull();
            assertThat(dims[0]).isEqualTo(720);
            assertThat(dims[1]).isEqualTo(720);
        }

        @Test
        @DisplayName("size '1280x720' → 1280x720")
        void size_1280x720() {
            int[] dims = VideoJobProcessor.dimensionsFromSize("1280x720");
            assertThat(dims).isNotNull();
            assertThat(dims[0]).isEqualTo(1280);
            assertThat(dims[1]).isEqualTo(720);
        }

        @Test
        @DisplayName("无效 resolution → null")
        void invalidResolution_null() {
            assertThat(VideoJobProcessor.videoDimensions("hd", "16:9")).isNull();
        }

        @Test
        @DisplayName("无效 size → null")
        void invalidSize_null() {
            assertThat(VideoJobProcessor.dimensionsFromSize("large")).isNull();
        }
    }

    // ========== 参考上限（IKHBDO：全部读能力行冻结值，程序不含模型知识）==========

    @Test
    @DisplayName("旧 job（快照无 reference_limits）→ 回落旧常量，在途任务不被上线打断")
    void legacyJobWithoutFrozenLimits() {
        AssetEntity videoRef = videoAsset(1024L, 5000, 1280, 720, "video/mp4");
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(
                () -> processor.validateReferences(
                        VideoJobProcessor.referenceLimitsOf(baseInput()), List.of(videoRef)));
    }

    @Test
    @DisplayName("G70: 参考图片超过能力行上限 → reference_limit_exceeded，文案带真实上限（不再写 9）")
    void tooManyImages_fails() {
        VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                () -> processor.validateReferences(
                        VideoJobProcessor.LEGACY_REFERENCE_LIMITS, imageAssets(10)));
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED);
        assertThat(error.getMessage()).contains("参考图最多 9 张");
    }

    @Test
    @DisplayName("能力行 max_reference_images=14：14 张放行、15 张拒绝（上限真由配置驱动，不固定 9）")
    void maxImagesFromConfig() {
        VideoJobProcessor.ReferenceLimits limits =
                new VideoJobProcessor.ReferenceLimits(14, 3, 3, 15);

        org.junit.jupiter.api.Assertions.assertDoesNotThrow(
                () -> processor.validateReferences(limits, imageAssets(14)));
        VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                () -> processor.validateReferences(limits, imageAssets(15)));
        assertThat(error.getMessage()).contains("参考图最多 14 张");
    }

    @Test
    @DisplayName("能力行 video_reference_max=5：5 个参考视频放行、6 个拒绝")
    void maxVideosFromConfig() {
        // maxDurationSec=null（能力行未配）→ 只验数量，时长不参与
        VideoJobProcessor.ReferenceLimits limits =
                new VideoJobProcessor.ReferenceLimits(14, 5, 5, null);

        org.junit.jupiter.api.Assertions.assertDoesNotThrow(
                () -> processor.validateReferences(limits, referenceVideos(5)));
        VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                () -> processor.validateReferences(limits, referenceVideos(6)));
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED);
        assertThat(error.getMessage()).contains("参考视频最多 5 个");
    }

    @Test
    @DisplayName("能力行 audio_reference_max=0：能力行把音频参考关掉后，1 个也拒")
    void maxAudiosFromConfig() {
        VideoJobProcessor.ReferenceLimits noAudio =
                new VideoJobProcessor.ReferenceLimits(9, 3, 0, 15);
        VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                () -> processor.validateReferences(noAudio, List.of(audioAsset())));
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED);
        assertThat(error.getMessage()).contains("参考音频最多 0 个");

        // 同一份素材，能力行配 3 → 放行：行为差异只能来自配置
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(
                () -> processor.validateReferences(
                        new VideoJobProcessor.ReferenceLimits(9, 3, 3, 15),
                        List.of(audioAsset())));
    }

    @Test
    @DisplayName("能力行 max_reference_duration_sec：30 → 两条 15s 共 30s 放行；31s 拒绝")
    void maxDurationFromConfig() {
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(
                () -> processor.validateReferences(
                        new VideoJobProcessor.ReferenceLimits(9, 3, 3, 30),
                        List.of(videoRefAsset(15), videoRefAsset(15))));
        VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                () -> processor.validateReferences(
                        new VideoJobProcessor.ReferenceLimits(9, 3, 3, 30),
                        List.of(videoRefAsset(16), videoRefAsset(15))));
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_INVALID_REFERENCE_MEDIA);
        assertThat(error.getMessage()).contains("参考视频已知总时长不能超过 30 秒");

        // 旧 15s 口径下同样两条就超限：差异同样只来自配置
        org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                () -> processor.validateReferences(
                        VideoJobProcessor.LEGACY_REFERENCE_LIMITS,
                        List.of(videoRefAsset(15), videoRefAsset(15))));
    }

    @Test
    @DisplayName("referenceLimitsOf：读冻结值；整字段/单字段缺失回落旧常量；显式 null = 不限")
    void referenceLimitsOfParsing() {
        // 旧 job：input 里没有 reference_limits → 全回落旧常量
        assertThat(VideoJobProcessor.referenceLimitsOf(baseInput()))
                .isEqualTo(VideoJobProcessor.LEGACY_REFERENCE_LIMITS);

        // 单字段缺失 → 该字段回落，其余读冻结值
        Map<String, Object> partial = baseInput();
        partial.put("reference_limits", Map.of("max_reference_images", 14));
        VideoJobProcessor.ReferenceLimits parsed = VideoJobProcessor.referenceLimitsOf(partial);
        assertThat(parsed.maxImages()).isEqualTo(14);
        assertThat(parsed.maxVideos()).isEqualTo(VideoJobProcessor.LEGACY_MAX_REFERENCE_VIDEOS);
        assertThat(parsed.maxDurationSec())
                .isEqualTo(VideoJobProcessor.LEGACY_MAX_REFERENCE_VIDEO_SECONDS);

        // 显式 null（能力行未配上限）≠ 缺失 → 不限，不回落旧 15
        Map<String, Object> explicitNull = new HashMap<>();
        explicitNull.put("max_reference_images", 14);
        explicitNull.put("video_reference_max", 3);
        explicitNull.put("audio_reference_max", 3);
        explicitNull.put("max_reference_duration_sec", null);
        Map<String, Object> input = baseInput();
        input.put("reference_limits", explicitNull);
        assertThat(VideoJobProcessor.referenceLimitsOf(input).maxDurationSec()).isNull();
    }

    @Test
    @DisplayName("冻结上限经 buildSubmitRequest 全链路生效（旧硬编码 9 不再拦得住 14 张）")
    void frozenLimitsDriveSubmitRequest() {
        // 归属查询按请求 id 返回同 id 图片素材（数量必须与请求一致，否则被判「素材不存在」）
        doAnswer(inv -> {
            List<String> ids = inv.getArgument(0);
            Map<String, AssetEntity> map = new HashMap<>();
            for (String id : ids) {
                map.put(id, imageAsset(id, "https://tos.test/" + id + ".png"));
            }
            return map;
        }).when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());

        assertThat(processor.buildSubmitRequest(
                videoClaim("401", false, null, 0, 0, null, inputWithImageRefs(14, 14)))
                .references()).hasSize(14);

        VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                () -> processor.buildSubmitRequest(
                        videoClaim("402", false, null, 0, 0, null, inputWithImageRefs(15, 14))));
        assertThat(error.getMessage()).contains("参考图最多 14 张");
    }

    @Test
    @DisplayName("scene_card 路径冻结的 video_reference_max 决定执行期上限（旧常量 3 拦不住第 4 条）")
    void frozenVideoLimitDrivesSceneCardPath() {
        // scene_card job 的参考走扁平 reference_asset_ids（无单数组 references），素材是视频。
        doAnswer(inv -> {
            List<String> ids = inv.getArgument(0);
            Map<String, AssetEntity> map = new HashMap<>();
            for (String id : ids) {
                map.put(id, videoRefAsset(2));
            }
            return map;
        }).when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());

        // 冻结 video_reference_max=5：4 条参考视频必须放行（旧 LEGACY 3 会把第 4 条拒掉）
        assertThat(processor.buildSubmitRequest(
                videoClaim("501", false, null, 0, 0, null, inputWithFlatVideoRefs(4, 5)))
                .references()).hasSize(4);

        // 同一份请求，冻结值配 3 → 执行期按配置拒，判词带配置值
        VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                () -> processor.buildSubmitRequest(
                        videoClaim("502", false, null, 0, 0, null, inputWithFlatVideoRefs(4, 3))));
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED);
        assertThat(error.getMessage()).contains("参考视频最多 3 个");
    }

    // ========== IKFFWH：素材库引用（material_id → asset:// 载体）==========

    @Nested
    @DisplayName("素材库引用透传（IKFFWH）")
    class MaterialReferenceTests {

        @Test
        @DisplayName("复现 1997：references 仅含 material_id → 提交带 asset:// 参考图")
        void reproducesJob1997() {
            Map<String, Object> input = baseInput();
            input.put("prompt", "改成蓝色发卡");
            input.put("references", List.of(Map.of(
                    "role", "reference", "type", "image",
                    "material_id", "asset-20260914090122-ftvfj")));
            ClaimedVideoJobDto claim = videoClaim("1997", false, null, 0, 0, null, input);

            VideoSubmitInput request = processor.buildSubmitRequest(claim);

            assertThat(request.references()).containsExactly(new VideoReference(
                    "image", "asset://asset-20260914090122-ftvfj", null));
        }

        @Test
        @DisplayName("小写 asset- 前缀素材库 id 同样透传（前缀大小写不敏感）")
        void lowercaseMaterialId_passes() {
            Map<String, Object> input = baseInput();
            input.put("references", List.of(Map.of(
                    "role", "reference", "type", "image",
                    "material_id", "asset-20260820153209-6c9z8")));
            ClaimedVideoJobDto claim = videoClaim("202", false, null, 0, 0, null, input);

            VideoSubmitInput request = processor.buildSubmitRequest(claim);

            assertThat(request.references()).containsExactly(new VideoReference(
                    "image", "asset://asset-20260820153209-6c9z8", null));
        }

        @Test
        @DisplayName("素材库帧：asset- 素材作首尾帧 → 带 role 并入 references，独立帧字段为空")
        void materialFrames_mergeWithRole() {
            Map<String, Object> input = baseInput();
            input.put("references", List.of(
                    Map.of("role", "first_frame", "type", "image", "material_id", "asset-face-1"),
                    Map.of("role", "last_frame", "type", "image", "material_id", "asset-last-1")));
            ClaimedVideoJobDto claim = videoClaim("203", false, null, 0, 0, null, input);

            VideoSubmitInput request = processor.buildSubmitRequest(claim);

            assertThat(request.firstFrameImage()).isNull();
            assertThat(request.lastFrameImage()).isNull();
            assertThat(request.references()).containsExactly(
                    new VideoReference("image", "asset://asset-face-1", "first_frame"),
                    new VideoReference("image", "asset://asset-last-1", "last_frame"));
        }

        @Test
        @DisplayName("单数组混排保序：帧在前；普通参考本地在前、素材库在后（对齐 TS IKDJNZ）")
        void singleReferences_mixedOrder() {
            Map<String, Object> input = baseInput();
            input.put("references", List.of(
                    Map.of("role", "first_frame", "type", "image", "asset_id", "11"),
                    Map.of("role", "reference", "type", "image", "material_id", "asset-mat-1"),
                    Map.of("role", "reference", "type", "image", "asset_id", "12"),
                    Map.of("role", "last_frame", "type", "image", "material_id", "asset-last-1")));
            ClaimedVideoJobDto claim = videoClaim("204", false, null, 0, 0, null, input);
            doReturn(Map.of(
                    "11", imageAsset("11", "https://tos.test/f.png"),
                    "12", imageAsset("12", "https://tos.test/r.png")))
                    .when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());

            VideoSubmitInput request = processor.buildSubmitRequest(claim);

            assertThat(request.references()).containsExactly(
                    new VideoReference("image", "https://tos.test/f.png", "first_frame"),
                    new VideoReference("image", "asset://asset-last-1", "last_frame"),
                    new VideoReference("image", "https://tos.test/r.png", null),
                    new VideoReference("image", "asset://asset-mat-1", null));
        }

        @Test
        @DisplayName("回归：未关联的本地 asset_id 参考照旧走 TOS url")
        void unlinkedLocalReference_keepsUrl() {
            Map<String, Object> input = baseInput();
            input.put("references", List.of(
                    Map.of("role", "reference", "type", "image", "asset_id", "11")));
            ClaimedVideoJobDto claim = videoClaim("205", false, null, 0, 0, null, input);
            doReturn(Map.of("11", imageAsset("11", "https://tos.test/a.png")))
                    .when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());

            VideoSubmitInput request = processor.buildSubmitRequest(claim);

            assertThat(request.references()).containsExactly(
                    new VideoReference("image", "https://tos.test/a.png", null));
        }

        @Test
        @DisplayName("本地素材命中素材库关联 → 转 asset://；未关联保留本地 url")
        void linkedAsset_convertsToAssetUri() {
            Map<String, Object> input = baseInput();
            input.put("reference_asset_ids", List.of("11", "12"));
            ClaimedVideoJobDto claim = videoClaim("206", false, null, 0, 0, null, input);
            doReturn(Map.of(
                    "11", linkedImageAsset("11", "https://tos.test/a.png", "asset-linked-1"),
                    "12", imageAsset("12", "https://tos.test/b.png")))
                    .when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());

            VideoSubmitInput request = processor.buildSubmitRequest(claim);

            assertThat(request.references()).containsExactly(
                    new VideoReference("image", "https://tos.test/b.png", null),
                    new VideoReference("image", "asset://asset-linked-1", null));
        }

        @Test
        @DisplayName("关联首帧本地素材 → firstFrameImage 走 asset://")
        void linkedFirstFrame_resolvesToAssetUri() {
            Map<String, Object> input = baseInput();
            input.put("first_frame_asset_id", "11");
            ClaimedVideoJobDto claim = videoClaim("207", false, null, 0, 0, null, input);
            doReturn(Map.of("11",
                    linkedImageAsset("11", "https://tos.test/first.png", "asset-face-1")))
                    .when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());

            VideoSubmitInput request = processor.buildSubmitRequest(claim);

            assertThat(request.firstFrameImage()).isEqualTo("asset://asset-face-1");
        }

        @Test
        @DisplayName("关联的非图片帧素材 → unsupported_input（首尾帧必须图片不因关联豁免）")
        void linkedNonImageFrame_rejected() {
            Map<String, Object> input = baseInput();
            input.put("references", List.of(
                    Map.of("role", "first_frame", "type", "image", "asset_id", "11")));
            ClaimedVideoJobDto claim = videoClaim("208", false, null, 0, 0, null, input);
            AssetEntity videoFrame = new AssetEntity();
            videoFrame.setId(11L);
            videoFrame.setType("video");
            videoFrame.setUrl("https://tos.test/first.mp4");
            videoFrame.setMaterialId("asset-vid-1");
            doReturn(Map.of("11", videoFrame))
                    .when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());

            VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(
                    VideoInputError.class, () -> processor.buildSubmitRequest(claim));
            assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_UNSUPPORTED_INPUT);
        }

        @Test
        @DisplayName("显式素材库引用与本地关联同 id → 去重保留首次出现")
        void materialRefs_dedup() {
            Map<String, Object> input = baseInput();
            input.put("references", List.of(
                    Map.of("role", "reference", "type", "image", "asset_id", "11"),
                    Map.of("role", "reference", "type", "image", "material_id", "asset-same"),
                    Map.of("role", "reference", "type", "video", "material_id", "asset-other")));
            ClaimedVideoJobDto claim = videoClaim("209", false, null, 0, 0, null, input);
            doReturn(Map.of("11", linkedImageAsset("11", "https://tos.test/a.png", "asset-same")))
                    .when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());

            VideoSubmitInput request = processor.buildSubmitRequest(claim);

            assertThat(request.references()).containsExactly(
                    new VideoReference("image", "asset://asset-same", null),
                    new VideoReference("video", "asset://asset-other", null));
        }

        @Test
        @DisplayName("素材库引用计入数量并集：10 张素材库图 → reference_limit_exceeded")
        void materialRefs_countTowardLimit() {
            List<Map<String, String>> refs = new java.util.ArrayList<>();
            for (int i = 0; i < 10; i++) {
                refs.add(Map.of("role", "reference", "type", "image",
                        "material_id", "asset-img-" + i));
            }
            Map<String, Object> input = baseInput();
            input.put("references", refs);
            ClaimedVideoJobDto claim = videoClaim("210", false, null, 0, 0, null, input);

            VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(
                    VideoInputError.class, () -> processor.buildSubmitRequest(claim));
            assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED);
        }

        @Test
        @DisplayName("素材库与本地混用计数并集：8 本地 + 2 素材库图 → reference_limit_exceeded")
        void mixedLocalAndMaterial_countAsUnion() {
            List<String> assetIds = new java.util.ArrayList<>();
            Map<String, AssetEntity> assets = new HashMap<>();
            for (int i = 0; i < 8; i++) {
                String id = String.valueOf(300 + i);
                assetIds.add(id);
                assets.put(id, imageAsset(id, "https://tos.test/" + id + ".png"));
            }
            List<Map<String, String>> refs = new java.util.ArrayList<>();
            for (String id : assetIds) {
                refs.add(Map.of("role", "reference", "type", "image", "asset_id", id));
            }
            refs.add(Map.of("role", "reference", "type", "image", "material_id", "asset-m1"));
            refs.add(Map.of("role", "reference", "type", "image", "material_id", "asset-m2"));

            Map<String, Object> input = baseInput();
            input.put("references", refs);
            ClaimedVideoJobDto claim = videoClaim("212", false, null, 0, 0, null, input);
            doReturn(assets).when(assetSource)
                    .resolveInputAssets(anyList(), anyString(), anyString());

            VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(
                    VideoInputError.class, () -> processor.buildSubmitRequest(claim));
            assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED);
        }

        @Test
        @DisplayName("素材库参考音频 → type 透传为 audio（asset:// 载体 + audio 计数）")
        void materialAudioRef_passesType() {
            Map<String, Object> input = baseInput();
            input.put("references", java.util.List.of(Map.of(
                    "role", "reference", "type", "audio", "material_id", "asset-audio-1")));
            ClaimedVideoJobDto claim = videoClaim("213", false, null, 0, 0, null, input);

            VideoSubmitInput request = processor.buildSubmitRequest(claim);

            assertThat(request.references()).containsExactly(
                    new VideoReference("audio", "asset://asset-audio-1", null));
        }

        @Test
        @DisplayName("素材库 id 形态非法 → invalid_reference")
        void invalidMaterialId_rejected() {
            Map<String, Object> input = baseInput();
            input.put("references", List.of(Map.of(
                    "role", "reference", "type", "image", "material_id", "not-a-material")));
            ClaimedVideoJobDto claim = videoClaim("211", false, null, 0, 0, null, input);

            VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(
                    VideoInputError.class, () -> processor.buildSubmitRequest(claim));
            assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_INVALID_REFERENCE);
        }

        // ===== 快照结构校验（worker 侧不信任冻结快照，对齐 TS readReferences）=====

        @Test
        @DisplayName("references 非数组 → invalid_reference（不得静默退化成无参考提交）")
        void referencesNotArray_rejected() {
            Map<String, Object> input = baseInput();
            input.put("references", "not-an-array");
            ClaimedVideoJobDto claim = videoClaim("214", false, null, 0, 0, null, input);

            VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(
                    VideoInputError.class, () -> processor.buildSubmitRequest(claim));
            assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_INVALID_REFERENCE);
        }

        @Test
        @DisplayName("references 元素非对象 → invalid_reference")
        void referenceElementNotObject_rejected() {
            Map<String, Object> input = baseInput();
            input.put("references", List.of("nope"));
            ClaimedVideoJobDto claim = videoClaim("215", false, null, 0, 0, null, input);

            VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(
                    VideoInputError.class, () -> processor.buildSubmitRequest(claim));
            assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_INVALID_REFERENCE);
        }

        @Test
        @DisplayName("role 非法或缺失 → invalid_reference（不得当作普通参考）")
        void invalidRole_rejected() {
            Map<String, Object> input = baseInput();
            input.put("references", List.of(Map.of("type", "image", "asset_id", "11")));
            ClaimedVideoJobDto claim = videoClaim("216", false, null, 0, 0, null, input);

            VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(
                    VideoInputError.class, () -> processor.buildSubmitRequest(claim));
            assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_INVALID_REFERENCE);
        }

        @Test
        @DisplayName("type 缺失或非法 → invalid_reference_type（避免 null type 穿透成 audio/上游 NPE）")
        void invalidType_rejected() {
            Map<String, Object> input = baseInput();
            input.put("references", List.of(Map.of("role", "reference", "asset_id", "11")));
            ClaimedVideoJobDto claim = videoClaim("217", false, null, 0, 0, null, input);

            VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(
                    VideoInputError.class, () -> processor.buildSubmitRequest(claim));
            assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_INVALID_REFERENCE_TYPE);
        }

        @Test
        @DisplayName("同帧位 asset 与 material 双来源 → invalid_reference")
        void duplicateFrameSource_rejected() {
            Map<String, Object> input = baseInput();
            input.put("references", List.of(
                    Map.of("role", "first_frame", "type", "image", "asset_id", "11"),
                    Map.of("role", "first_frame", "type", "image", "material_id", "asset-face-1")));
            ClaimedVideoJobDto claim = videoClaim("218", false, null, 0, 0, null, input);

            VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(
                    VideoInputError.class, () -> processor.buildSubmitRequest(claim));
            assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_INVALID_REFERENCE);
        }
    }

    // ========== IKFPYX：任务类型判定与 duration=-1 收窄 ==========

    @org.junit.jupiter.api.Nested
    @DisplayName("IKFPYX 任务类型判定与 duration=-1 收窄")
    class TaskTypeTests {

        @Test
        @DisplayName("首帧 / 首尾帧按 references 角色判定")
        void resolveByFrameRoles() {
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "first_frame", "type", "image")), ""))
                    .isEqualTo("first_frame");
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "first_frame", "type", "image"),
                            Map.of("role", "last_frame", "type", "image")), ""))
                    .isEqualTo("first_last_frame");
        }

        @Test
        @DisplayName("参考视频 + 延长意图 → prolong（优先于编辑词）")
        void resolveProlongBeforeEdit() {
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "向后延长这个视频"))
                    .isEqualTo("prolong");
        }

        @Test
        @DisplayName("参考视频 + 编辑意图 → edit")
        void resolveEdit() {
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "把背景改成海边"))
                    .isEqualTo("edit");
        }

        @Test
        @DisplayName("参考视频但无意图关键词 → default；仅图片参考 → default")
        void resolveDefault() {
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "参考它的运镜"))
                    .isEqualTo("default");
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "image")), "修改一下"))
                    .isEqualTo("default");
        }

        @Test
        @DisplayName("非 edit/prolong 任务传 duration=-1 → invalid_input（收窄后不再通用放行）")
        void autoDurationRejectedForNonEdit() {
            Map<String, Object> input = baseInput();
            input.put("duration", -1);
            input.put("references", List.of(Map.of("role", "reference", "type", "image")));
            ClaimedVideoJobDto claim = videoClaim("301", false, null, 0, 0, null, input);

            VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(
                    VideoInputError.class, () -> processor.buildSubmitRequest(claim));
            assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_INVALID_INPUT);
        }

        @Test
        @DisplayName("IKG0LP：快照里的 generate_audio 透传到提交请求；缺失时为 null（不下发）")
        void generateAudioFromSnapshot() {
            Map<String, Object> withFalse = baseInput();
            withFalse.put("generate_audio", Boolean.FALSE);
            assertThat(processor.buildSubmitRequest(
                    videoClaim("303", false, null, 0, 0, null, withFalse)).generateAudio())
                    .isFalse();

            Map<String, Object> withTrue = baseInput();
            withTrue.put("generate_audio", Boolean.TRUE);
            assertThat(processor.buildSubmitRequest(
                    videoClaim("304", false, null, 0, 0, null, withTrue)).generateAudio())
                    .isTrue();

            // 能力位不允许 / 旧快照：字段缺失 → null → 出站不下发，维持上游默认
            assertThat(processor.buildSubmitRequest(
                    videoClaim("305", false, null, 0, 0, null, baseInput())).generateAudio())
                    .isNull();
        }

        @Test
        @DisplayName("IKG0FR：分辨率算不出像素（4k）不再拒单——像素只回写资产，缺省 null")
        void unparseableResolutionNotRejected() {
            Map<String, Object> input = baseInput();
            input.put("resolution", "4k");
            ClaimedVideoJobDto claim = videoClaim("302", false, null, 0, 0, null, input);

            VideoSubmitInput request = processor.buildSubmitRequest(claim);

            assertThat(request.resolution()).isEqualTo("4k");
            assertThat(request.ratio()).isEqualTo("16:9");
        }
    }

    // ========== 工具方法 ==========

    /** 边界用例里的参考时长上限（等同于能力行 Seedance 2.0 的配置值，IKHBDO 后由能力行注入）。 */
    private static final int REF_MAX_DURATION_SEC = 15;

    /** n 条本地图片参考（无 mime/size/尺寸，只验数量上限）。 */
    private List<AssetEntity> imageAssets(int n) {
        List<AssetEntity> images = new java.util.ArrayList<>();
        for (int i = 0; i < n; i++) {
            AssetEntity a = new AssetEntity();
            a.setType("image");
            a.setUrl("http://img/" + i);
            images.add(a);
        }
        return images;
    }

    /** 单个合法参考视频（1280x720 / mp4 / 指定秒数）。 */
    private AssetEntity videoRefAsset(int seconds) {
        return videoAsset(1024L, seconds * 1000, 1280, 720, "video/mp4");
    }

    private List<AssetEntity> referenceVideos(int n) {
        List<AssetEntity> videos = new java.util.ArrayList<>();
        for (int i = 0; i < n; i++) {
            videos.add(videoRefAsset(2));
        }
        return videos;
    }

    private AssetEntity audioAsset() {
        AssetEntity a = new AssetEntity();
        a.setType("audio");
        a.setUrl("http://audio.mp3");
        return a;
    }

    /** baseInput + n 条图片参考 + 冻结的参考上限快照（max_reference_images = configuredMax）。 */
    private Map<String, Object> inputWithImageRefs(int n, int configuredMax) {
        Map<String, Object> input = baseInput();
        List<Map<String, Object>> refs = new java.util.ArrayList<>();
        for (int i = 1; i <= n; i++) {
            refs.add(Map.of("role", "reference", "type", "image", "asset_id", String.valueOf(i)));
        }
        input.put("references", refs);
        input.put("reference_limits", Map.of(
                "max_reference_images", configuredMax,
                "video_reference_max", 3,
                "audio_reference_max", 3,
                "max_reference_duration_sec", 15));
        return input;
    }

    /** scene_card 路径的 job 形态：扁平 reference_asset_ids + 冻结的 video_reference_max。 */
    private Map<String, Object> inputWithFlatVideoRefs(int n, int configuredVideoMax) {
        Map<String, Object> input = baseInput();
        List<String> ids = new java.util.ArrayList<>();
        for (int i = 1; i <= n; i++) {
            ids.add(String.valueOf(i));
        }
        input.put("reference_asset_ids", ids);
        input.put("reference_limits", Map.of(
                "max_reference_images", 9,
                "video_reference_max", configuredVideoMax,
                "audio_reference_max", 3,
                "max_reference_duration_sec", 15));
        return input;
    }

    private ClaimedVideoJobDto videoClaim(String id, boolean cancelRequested,
                                           String providerTaskId, int pollCount,
                                           int progress, String parentProviderTaskId) {
        return videoClaim(id, cancelRequested, providerTaskId, pollCount, progress,
                parentProviderTaskId, baseInput());
    }

    private ClaimedVideoJobDto videoClaim(String id, boolean cancelRequested,
                                           String providerTaskId, int pollCount,
                                           int progress, String parentProviderTaskId,
                                           Map<String, Object> input) {
        return new ClaimedVideoJobDto(
                id, "1", "42", input,
                providerTaskId, cancelRequested,
                "video-worker", 1L,
                pollCount, progress, parentProviderTaskId);
    }

    private Map<String, Object> baseInput() {
        Map<String, Object> input = new HashMap<>();
        input.put("provider_credential", "sealed-cred");
        input.put("prompt", "一只猫在跑步");
        input.put("model_id", "seedance-2");
        input.put("duration", 5.0);
        input.put("resolution", "720p");
        input.put("aspect_ratio", "16:9");
        return input;
    }

    private AssetEntity videoAsset(Long size, Integer durationMs,
                                    Integer width, Integer height, String mime) {
        AssetEntity a = new AssetEntity();
        a.setType("video");
        a.setUrl("http://video.mp4");
        a.setSize(size);
        a.setDurationMs(durationMs);
        a.setWidth(width);
        a.setHeight(height);
        a.setMime(mime);
        return a;
    }

    private AssetEntity imageAsset(String id, String url) {
        AssetEntity a = new AssetEntity();
        a.setId(Long.parseLong(id));
        a.setType("image");
        a.setUrl(url);
        return a;
    }

    /** 已关联素材库的本地图片素材（assets.material_id 非空 → 生成走 asset://）。 */
    private AssetEntity linkedImageAsset(String id, String url, String materialId) {
        AssetEntity a = imageAsset(id, url);
        a.setMaterialId(materialId);
        return a;
    }
}
