package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoInputError;
import com.bluewhale.worker.domain.error.VideoProviderError;
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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class VideoJobProcessorTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetSourceService assetSource;
    @Mock private UpstreamCredential upstreamCredential;
    @Mock private NewApiVideoClient videoClient;
    @Mock private TosVideoMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private VideoJobProcessor processor;

    @BeforeEach
    void setUp() {
        processor = new VideoJobProcessor(
                stateMachine, finalizer, assetSource, upstreamCredential,
                videoClient, mediaRelay, producer);
        lenient().doReturn(true).when(stateMachine)
                .markSubmissionAttempt(anyString(), anyString(), anyLong());
    }


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
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("G50: cancelRequested + providerTaskId!=null → 不 cancel（已提交上游必须跑到终态）")
    void cancelRequestedButAlreadySubmitted() {
        ClaimedVideoJobDto claim = videoClaim("101", true, "task-123", 0, 0, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("101"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://video.mp4", null, null, null))
                .when(videoClient).poll(anyString(), eq("task-123"));
        doReturn(new StoredVideo("http://tos/video.mp4", "key", "video/mp4", 100L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(anyString(), anyString());
        doReturn(true).when(finalizer)
                .publishVideoResult(anyString(), anyString(), anyString(),
                        anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyInt(), anyDouble(), any(), any());

        processor.handle("101");

        verify(stateMachine, never()).cancelVideoBeforeDispatch(anyString(), anyString(), anyLong());
    }


    @Test
    @DisplayName("G51: submit → markProviderSubmitted + scheduleNext(5000ms)")
    void submitPath() {
        Map<String, Object> input = baseInput();
        ClaimedVideoJobDto claim = videoClaim("102", false, null, 0, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("102"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new SubmitResult("task-456", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("102"), anyString(), eq(1L), eq("task-456"));

        processor.handle("102");

        verify(videoClient).submit(eq("token"), any(VideoSubmitInput.class));
        verify(stateMachine).markProviderSubmitted(eq("102"), anyString(), eq(1L), eq("task-456"));
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
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new SubmitResult("task-ikfa1p", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("110"), anyString(), eq(1L), eq("task-ikfa1p"));

        processor.handle("110");

        var captor = org.mockito.ArgumentCaptor.forClass(VideoSubmitInput.class);
        verify(videoClient).submit(eq("token"), captor.capture());
        org.junit.jupiter.api.Assertions.assertEquals(
                baseInput().get("prompt"), captor.getValue().prompt());
    }


    @Test
    @DisplayName("IKJ80P: poll 阶段错误即使带超时 cause 也不打孤儿标记（provider_task_id 已落库）")
    void pollPhaseErrorNeverMarkedOrphan() {
        ClaimedVideoJobDto claim = videoClaim("122", false, "task-789", 0, 0, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("122"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                "new-api 视频轮询失败: 慢", new java.net.SocketTimeoutException()))
                .when(videoClient).poll(anyString(), eq("task-789"));

        processor.handle("122");

        verify(finalizer).failVideoJob(eq("122"), eq(GenerationError.ERROR_PROVIDER_FAILED),
                anyString(),
                argThat(d -> !d.containsKey(VideoJobProcessor.ERROR_DETAIL_SUBMIT_TIMEOUT_ORPHAN)),
                anyString(), anyLong());
    }


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

        verify(finalizer).failVideoJob(eq("111"), eq(GenerationError.ERROR_INVALID_INPUT),
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
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new SubmitResult("task-ikfcxc-2", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("112"), anyString(), eq(1L), eq("task-ikfcxc-2"));

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
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new SubmitResult("task-ikfcxc-3", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("113"), anyString(), eq(1L), eq("task-ikfcxc-3"));

        processor.handle("113");

        var captor = org.mockito.ArgumentCaptor.forClass(VideoSubmitInput.class);
        verify(videoClient).submit(eq("token"), captor.capture());
        org.junit.jupiter.api.Assertions.assertEquals("一只猫在跑步", captor.getValue().prompt());
    }

    @Test
    @DisplayName("G52: 上游凭证未配置 → provider_credential_missing")
    void missingCredential() {
        Map<String, Object> input = new HashMap<>(baseInput());
        ClaimedVideoJobDto claim = videoClaim("103", false, null, 0, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("103"), anyString());
        doReturn(true).when(finalizer)
                .failVideoJob(eq("103"), eq(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING),
                        anyString(), any(), anyString(), eq(1L));

        when(upstreamCredential.requireKey())
                .thenThrow(new IllegalStateException(
                        "上游凭证未配置：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key"));
        processor.handle("103");

        verify(finalizer).failVideoJob(eq("103"), eq(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING),
                anyString(), any(), anyString(), eq(1L));
    }


    @Test
    @DisplayName("G53: parent-reuse SUCCESS → publishVideo without submit（IKEA26 防双扣）")
    void parentReuseSuccess() {
        ClaimedVideoJobDto claim = videoClaim("104", false, null, 0, 0, "parent-task-789");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("104"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://parent-video.mp4", null, null, null))
                .when(videoClient).poll(eq("token"), eq("parent-task-789"));
        doReturn(new StoredVideo("http://tos/video.mp4", "key", "video/mp4", 100L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(anyString(), anyString());
        doReturn(true).when(finalizer)
                .publishVideoResult(anyString(), anyString(), anyString(),
                        anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyInt(), anyDouble(), any(), any());

        processor.handle("104");

        verify(videoClient, never()).submit(anyString(), any());
        verify(finalizer).publishVideoResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), eq("0123456789abcdef0123456789abcdef"), anyInt(), anyInt(), anyDouble(), any(), any());
    }

    @Test
    @DisplayName("G54: parent-reuse FAILED → fall through to normal submit")
    void parentReuseFailed_fallThrough() {
        ClaimedVideoJobDto claim = videoClaim("105", false, null, 0, 0, "parent-task-fail");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("105"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("failed", 100, null, null,
                new TaskError("provider_failed", "上游失败"), null))
                .when(videoClient).poll(eq("token"), eq("parent-task-fail"));
        doReturn(new SubmitResult("new-task", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("105"), anyString(), eq(1L), eq("new-task"));

        processor.handle("105");

        verify(videoClient).submit(eq("token"), any(VideoSubmitInput.class));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", " \t "})
    @DisplayName("IKIDEP: parent-reuse 成功但结果 URL 缺失时重新提交，不转存旧结果")
    void parentReuseBlankUrl_fallThroughToSubmit(String resultUrl) {
        ClaimedVideoJobDto claim = videoClaim("117", false, null, 0, 0, "parent-task-blank");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("117"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, resultUrl, null, null, null))
                .when(videoClient).poll(eq("token"), eq("parent-task-blank"));
        doReturn(new SubmitResult("new-task-blank", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("117"), eq("video-worker"), eq(1L), eq("new-task-blank"));

        processor.handle("117");

        verify(mediaRelay, never()).persist(anyString(), anyString());
        verify(finalizer, never()).publishVideoResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyInt(), anyDouble(), any(), any());
        verify(videoClient, times(1)).submit(eq("token"), any(VideoSubmitInput.class));
        verify(stateMachine).markProviderSubmitted("117", "video-worker", 1L, "new-task-blank");
        verify(producer).enqueue("117", 5000L);
    }

    @Test
    @DisplayName("IKICD3: parent-reuse 查询异常 → 按不存在回退重新提交（D6 保持）")
    void parentReusePollError_fallThroughToSubmit() {
        ClaimedVideoJobDto claim = videoClaim("116", false, null, 0, 0, "parent-task-err");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("116"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError("provider_failed", "查询超时"))
                .when(videoClient).poll(eq("token"), eq("parent-task-err"));
        doReturn(new SubmitResult("new-task-err", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("116"), anyString(), eq(1L), eq("new-task-err"));

        processor.handle("116");

        verify(videoClient).submit(eq("token"), any(VideoSubmitInput.class));
    }

    @Test
    @DisplayName("IKICD3: parent-reuse 转存/发布异常 → 按旧结果不可用回退重新提交（不写终态失败）")
    void parentReusePublishError_fallThroughToSubmit() {
        ClaimedVideoJobDto claim = videoClaim("118", false, null, 0, 0, "parent-task-expired");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("118"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://parent-expired.mp4", null, null, null))
                .when(videoClient).poll(eq("token"), eq("parent-task-expired"));
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成视频下载失败: HTTP 404"))
                .when(mediaRelay).persist(anyString(), anyString());
        doReturn(new SubmitResult("new-task-expired", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("118"), anyString(), eq(1L), eq("new-task-expired"));

        processor.handle("118");

        verify(videoClient, times(1)).submit(eq("token"), any(VideoSubmitInput.class));
        verify(stateMachine).markProviderSubmitted("118", "video-worker", 1L, "new-task-expired");
        verify(producer).enqueue(eq("118"), eq(5000L));
        verify(finalizer, never()).publishVideoResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyInt(), anyDouble(), any(), any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("IKICD3: parent-reuse 发布守卫未命中 → 失去执行权停止：零 submit、零 providerTaskId、零轮询、零迟到 Finalize")
    void parentReusePublishGuardMissed_stopWithoutResubmit() {
        ClaimedVideoJobDto claim = videoClaim("114", false, null, 0, 0, "parent-task-stale");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("114"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://parent-stale.mp4", null, null, null))
                .when(videoClient).poll(eq("token"), eq("parent-task-stale"));
        doReturn(new StoredVideo("http://tos/stale.mp4", "key", "video/mp4", 100L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(anyString(), anyString());
        doReturn(false).when(finalizer).publishVideoResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyInt(), anyDouble(), any(), any());

        processor.handle("114");

        verify(videoClient, never()).submit(anyString(), any(VideoSubmitInput.class));
        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(), anyLong(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("IKICD3: 失租停止后新 Worker 接手 → 同一收割路径完成发布（不重新提交）")
    void parentReuseGuardMissedThenNewWorkerCompletesHarvest() {
        ClaimedVideoJobDto staleWorker = new ClaimedVideoJobDto(
                "115", "1", "42", baseInput(), null, false,
                "video-worker-old", 1L, 0, 0, "parent-task-tko");
        ClaimedVideoJobDto newWorker = new ClaimedVideoJobDto(
                "115", "1", "42", baseInput(), null, false,
                "video-worker-new", 2L, 0, 0, "parent-task-tko");
        VideoJobProcessor staleProcessor = new VideoJobProcessor(
                stateMachine, finalizer, assetSource, upstreamCredential, videoClient, mediaRelay, producer,
                "video-worker-old");
        VideoJobProcessor newProcessor = new VideoJobProcessor(
                stateMachine, finalizer, assetSource, upstreamCredential, videoClient, mediaRelay, producer,
                "video-worker-new");
        doReturn(Optional.of(staleWorker)).when(stateMachine)
                .claimVideoJobById("115", "video-worker-old");
        doReturn(Optional.of(newWorker)).when(stateMachine)
                .claimVideoJobById("115", "video-worker-new");
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://parent-tko.mp4", null, null, null))
                .when(videoClient).poll(eq("token"), eq("parent-task-tko"));
        doReturn(new StoredVideo("http://tos/tko.mp4", "key", "video/mp4", 100L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(anyString(), anyString());
        doReturn(false).doReturn(true).when(finalizer)
                .publishVideoResult(anyString(), anyString(), anyString(),
                        anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyInt(), anyDouble(), any(), any());

        staleProcessor.handle("115");
        newProcessor.handle("115");

        verify(videoClient, never()).submit(anyString(), any(VideoSubmitInput.class));
        var publishOrder = inOrder(stateMachine, finalizer);
        publishOrder.verify(stateMachine).claimVideoJobById("115", "video-worker-old");
        publishOrder.verify(finalizer).publishVideoResult(eq("115"), eq("1"), eq("42"),
                eq("video-worker-old"), eq(1L), anyString(), anyString(), anyString(),
                any(), anyString(), anyInt(), anyInt(), anyDouble(), any(), any());
        publishOrder.verify(stateMachine).claimVideoJobById("115", "video-worker-new");
        publishOrder.verify(finalizer).publishVideoResult(eq("115"), eq("1"), eq("42"),
                eq("video-worker-new"), eq(2L), anyString(), anyString(), anyString(),
                any(), anyString(), anyInt(), anyInt(), anyDouble(), any(), any());
        verify(finalizer, times(2)).publishVideoResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyInt(), anyDouble(), any(), any());
        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(), anyLong(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
    }


    @Test
    @DisplayName("G55: poll processing → rescheduleProviderPoll + scheduleNext(5000ms)")
    void pollProcessing() {
        ClaimedVideoJobDto claim = videoClaim("106", false, "task-106", 5, 30, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("106"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("processing", 50, null, null, null, null))
                .when(videoClient).poll(eq("token"), eq("task-106"));
        doReturn(true).when(stateMachine)
                .rescheduleProviderPoll(eq("106"), anyString(), eq(1L), eq(50));

        processor.handle("106");

        verify(stateMachine).rescheduleProviderPoll(eq("106"), anyString(), eq(1L), eq(50));
        verify(producer).enqueue(eq("106"), eq(5000L));
    }

    @Test
    @DisplayName("G56: pollCount>=720 → ERROR_PROVIDER_TIMEOUT")
    void pollTimeout() {
        ClaimedVideoJobDto claim = videoClaim("107", false, "task-107", 720, 90, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("107"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("processing", 90, null, null, null, null))
                .when(videoClient).poll(eq("token"), eq("task-107"));
        doReturn(true).when(finalizer)
                .failVideoJob(eq("107"), eq(GenerationError.ERROR_PROVIDER_TIMEOUT),
                        anyString(), any(), anyString(), eq(1L));

        processor.handle("107");

        var messageCaptor = org.mockito.ArgumentCaptor.forClass(String.class);
        var detailsCaptor = org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(finalizer).failVideoJob(eq("107"), eq(GenerationError.ERROR_PROVIDER_TIMEOUT),
                messageCaptor.capture(), detailsCaptor.capture(), eq("video-worker"), eq(1L));
        assertThat(messageCaptor.getValue())
                .isEqualTo("视频生成轮询超时（超过 " + VideoJobProcessor.MAX_VIDEO_POLLS + " 次）");
        @SuppressWarnings("unchecked")
        Map<String, Object> details = detailsCaptor.getValue();
        assertThat(details).doesNotContainKey("http_status").containsKey("raw");
    }

    @Test
    @DisplayName("poll 瞬时错误未超限（pollCount=719）→ 仍按 5s 续排（次数由 SQL +1，IKI61M）")
    void pollTransientErrorBelowLimit_reschedules() {
        ClaimedVideoJobDto claim = videoClaim("109", false, "task-109",
                VideoJobProcessor.MAX_VIDEO_POLLS - 1, 30, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("109"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_TIMEOUT, "查询超时"))
                .when(videoClient).poll(eq("token"), eq("task-109"));
        doReturn(true).when(stateMachine)
                .rescheduleProviderPoll(eq("109"), anyString(), eq(1L), eq(30));

        processor.handle("109");

        verify(stateMachine).rescheduleProviderPoll(eq("109"), anyString(), eq(1L), eq(30));
        verify(producer).enqueue(eq("109"), eq(5000L));
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（pollCount=720）→ provider_timeout 轮询超时 + 不再续排（IKI61M：与 processing 共享预算）")
    void pollTransientErrorAtLimit_fails() {
        ClaimedVideoJobDto claim = videoClaim("110", false, "task-110",
                VideoJobProcessor.MAX_VIDEO_POLLS, 30, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("110"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_TIMEOUT, "查询超时"))
                .when(videoClient).poll(eq("token"), eq("task-110"));
        doReturn(true).when(finalizer)
                .failVideoJob(eq("110"), eq(GenerationError.ERROR_PROVIDER_TIMEOUT),
                        anyString(), any(), anyString(), eq(1L));

        processor.handle("110");

        var messageCaptor = org.mockito.ArgumentCaptor.forClass(String.class);
        var detailsCaptor = org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(finalizer).failVideoJob(eq("110"), eq(GenerationError.ERROR_PROVIDER_TIMEOUT),
                messageCaptor.capture(), detailsCaptor.capture(), eq("video-worker"), eq(1L));
        assertThat(messageCaptor.getValue()).isEqualTo("视频生成轮询超时（超过 "
                + VideoJobProcessor.MAX_VIDEO_POLLS + " 次），上游持续错误: 查询超时");
        @SuppressWarnings("unchecked")
        Map<String, Object> details = detailsCaptor.getValue();
        assertThat(details).doesNotContainKey("http_status").containsKey("raw");
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（HTTP 503 瞬时形态）→ provider_timeout 且透传 http_status=503（瞬时错误各形态同受上限约束）")
    void pollTransientHttp503AtLimit_fails() {
        ClaimedVideoJobDto claim = videoClaim("111", false, "task-111",
                VideoJobProcessor.MAX_VIDEO_POLLS, 30, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("111"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "网关繁忙",
                new NewApiVideoClient.HttpStatusException(503)))
                .when(videoClient).poll(eq("token"), eq("task-111"));
        doReturn(true).when(finalizer)
                .failVideoJob(eq("111"), eq(GenerationError.ERROR_PROVIDER_TIMEOUT),
                        anyString(), any(), anyString(), eq(1L));

        processor.handle("111");

        var messageCaptor = org.mockito.ArgumentCaptor.forClass(String.class);
        var detailsCaptor = org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(finalizer).failVideoJob(eq("111"), eq(GenerationError.ERROR_PROVIDER_TIMEOUT),
                messageCaptor.capture(), detailsCaptor.capture(), eq("video-worker"), eq(1L));
        assertThat(messageCaptor.getValue()).isEqualTo("视频生成轮询超时（超过 "
                + VideoJobProcessor.MAX_VIDEO_POLLS + " 次），上游持续错误: 网关繁忙");
        @SuppressWarnings("unchecked")
        Map<String, Object> details = detailsCaptor.getValue();
        assertThat(details).containsEntry("http_status", 503);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("IKIN6Y: poll 瞬时错误达上限（429 cause 携带状态）→ details.http_status=429，message 剥状态码字样、保留排查信息")
    void pollTransientHttp429AtLimit_persistsHttpStatusDetail() {
        ClaimedVideoJobDto claim = videoClaim("121", false, "task-121",
                VideoJobProcessor.MAX_VIDEO_POLLS, 30, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("121"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                "new-api 视频轮询失败: HTTP 429 body={\"error\":{\"message\":\"Requests too fast\"}} request_id=req-882",
                new NewApiVideoClient.HttpStatusException(429)))
                .when(videoClient).poll(eq("token"), eq("task-121"));

        processor.handle("121");

        var messageCaptor = org.mockito.ArgumentCaptor.forClass(String.class);
        var detailsCaptor = org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(finalizer).failVideoJob(eq("121"), eq(GenerationError.ERROR_PROVIDER_TIMEOUT),
                messageCaptor.capture(), detailsCaptor.capture(), eq("video-worker"), eq(1L));
        @SuppressWarnings("unchecked")
        Map<String, Object> details = detailsCaptor.getValue();
        assertThat(messageCaptor.getValue()).doesNotContain("429")
                .contains("Requests too fast").contains("request_id=req-882");
        assertThat(details)
                .containsEntry("raw", "视频生成轮询超时（超过 " + VideoJobProcessor.MAX_VIDEO_POLLS
                        + " 次），上游持续错误: new-api 视频轮询失败: body={\"error\":{\"message\":\"Requests too fast\"}} request_id=req-882")
                .containsEntry("http_status", 429);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限但 reschedule 守卫未命中（stale worker / fencing 失配）→ 不自投下一步、不落终态")
    void pollTransientErrorGuardMissed_noScheduleNext() {
        ClaimedVideoJobDto claim = videoClaim("112", false, "task-112", 3, 30, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("112"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_TIMEOUT, "查询超时"))
                .when(videoClient).poll(eq("token"), eq("task-112"));
        doReturn(false).when(stateMachine)
                .rescheduleProviderPoll(eq("112"), anyString(), eq(1L), eq(30));

        processor.handle("112");

        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("G57: poll succeeded + URL → relay → publishVideoResult")
    void pollSucceeded() {
        ClaimedVideoJobDto claim = videoClaim("108", false, "task-108", 10, 100, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("108"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://video.mp4", null, null, null))
                .when(videoClient).poll(eq("token"), eq("task-108"));
        doReturn(new StoredVideo("http://tos/video.mp4", "key", "video/mp4", 1024L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(eq("http://video.mp4"), anyString());
        doReturn(true).when(finalizer)
                .publishVideoResult(anyString(), anyString(), anyString(),
                        anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyInt(), anyDouble(), any(), any());

        processor.handle("108");

        verify(mediaRelay).persist(eq("http://video.mp4"), anyString());
        verify(finalizer).publishVideoResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), eq("http://tos/video.mp4"), eq("key"), eq("video/mp4"),
                eq(1024L), eq("0123456789abcdef0123456789abcdef"), anyInt(), anyInt(), anyDouble(), any(), any());
    }

    @Test
    @DisplayName("ADR-0086 回归：adaptive 比例（无固定宽高）生成成功后仍能发布，width/height 传 null")
    void adaptivePublishSucceedsWithNullDimensions() {
        Map<String, Object> input = baseInput();
        input.put("aspect_ratio", "adaptive");
        ClaimedVideoJobDto claim = videoClaim("109a", false, "task-109a", 1, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("109a"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://video.mp4", null, null, null))
                .when(videoClient).poll(eq("token"), eq("task-109a"));
        doReturn(new StoredVideo("http://tos/video.mp4", "key", "video/mp4", 1024L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(eq("http://video.mp4"), anyString());
        doReturn(true).when(finalizer)
                .publishVideoResult(anyString(), anyString(), anyString(), anyString(), anyLong(),
                        anyString(), anyString(), anyString(), any(), anyString(), isNull(), isNull(), anyDouble(), any(), any());

        processor.handle("109a");

        verify(finalizer).publishVideoResult(anyString(), anyString(), anyString(), anyString(),
                anyLong(), eq("http://tos/video.mp4"), eq("key"), eq("video/mp4"), eq(1024L), eq("0123456789abcdef0123456789abcdef"),
                isNull(), isNull(), anyDouble(), any(), any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("G58: poll failed → failVideoJob with upstream code")
    void pollFailed() {
        ClaimedVideoJobDto claim = videoClaim("109", false, "task-109", 3, 0, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("109"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("failed", 100, null, null,
                new TaskError("content_rejected", "内容违规"), null))
                .when(videoClient).poll(eq("token"), eq("task-109"));
        doReturn(true).when(finalizer)
                .failVideoJob(eq("109"), eq("content_rejected"),
                        eq("内容违规"), any(), anyString(), eq(1L));

        processor.handle("109");

        verify(finalizer).failVideoJob(eq("109"), eq("content_rejected"),
                eq("内容违规"), any(), anyString(), eq(1L));
    }

    @Test
    @DisplayName("G58a: poll FAILURE + 顶层 fail_reason 版权拒绝 → failVideoJob(content_rejected_reference, 上游原文)")
    void pollFailedWithTopLevelFailReason() {
        ClaimedVideoJobDto claim = videoClaim("109a", false, "task-109a", 3, 0, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("109a"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("failed", 100, null, null,
                new TaskError("content_rejected_reference",
                        "The request failed because the output video may be related to copyright restrictions. Request id: req-2048"), null))
                .when(videoClient).poll(eq("token"), eq("task-109a"));
        doReturn(true).when(finalizer)
                .failVideoJob(eq("109a"), eq("content_rejected_reference"),
                        eq("The request failed because the output video may be related to copyright restrictions. Request id: req-2048"),
                        any(), anyString(), eq(1L));

        processor.handle("109a");

        verify(finalizer).failVideoJob(eq("109a"), eq("content_rejected_reference"),
                eq("The request failed because the output video may be related to copyright restrictions. Request id: req-2048"),
                any(), anyString(), eq(1L));
    }

    @Test
    @DisplayName("G59: poll succeeded 无 URL → provider_failed")
    void pollSucceededNoUrl() {
        ClaimedVideoJobDto claim = videoClaim("110", false, "task-110", 5, 0, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("110"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, null, null, null, null))
                .when(videoClient).poll(eq("token"), eq("task-110"));
        doReturn(true).when(finalizer)
                .failVideoJob(eq("110"), eq(GenerationError.ERROR_PROVIDER_FAILED),
                        anyString(), any(), anyString(), eq(1L));

        processor.handle("110");

        verify(finalizer).failVideoJob(eq("110"), eq(GenerationError.ERROR_PROVIDER_FAILED),
                anyString(), any(), anyString(), eq(1L));
    }


    @Test
    @DisplayName("IKIMS5: poll 上游 401（cause 携带状态）→ details.http_status=401，message 剥离状态码字样")
    void pollUnauthorized_persistsHttpStatusDetail() {
        ClaimedVideoJobDto claim = videoClaim("119", false, "task-119", 3, 0, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("119"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                "new-api 视频轮询失败: HTTP 401 body={\"error\":{\"message\":\"Incorrect API key\"}}",
                new NewApiVideoClient.HttpStatusException(401)))
                .when(videoClient).poll(eq("token"), eq("task-119"));

        processor.handle("119");

        var messageCaptor = org.mockito.ArgumentCaptor.forClass(String.class);
        var detailsCaptor = org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(finalizer).failVideoJob(eq("119"), eq(GenerationError.ERROR_PROVIDER_FAILED),
                messageCaptor.capture(), detailsCaptor.capture(), eq("video-worker"), eq(1L));
        @SuppressWarnings("unchecked")
        Map<String, Object> details = detailsCaptor.getValue();
        assertThat(messageCaptor.getValue()).doesNotContain("401").contains("Incorrect API key");
        assertThat(details)
                .containsEntry("raw", "new-api 视频轮询失败: body={\"error\":{\"message\":\"Incorrect API key\"}}")
                .containsEntry("http_status", 401);
    }

    @Test
    @DisplayName("IKIMS5: 结果下载失败（无状态 cause）→ 文案保留 HTTP 404 字样，details 不写 http_status 键")
    void relayDownloadFailure_keepsHttpStatusTextInMessage() {
        ClaimedVideoJobDto claim = videoClaim("120", false, "task-120", 5, 100, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("120"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://video.mp4", null, null, null))
                .when(videoClient).poll(eq("token"), eq("task-120"));
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                "生成视频下载失败: HTTP 404 body=not found"))
                .when(mediaRelay).persist(eq("http://video.mp4"), anyString());

        processor.handle("120");

        var messageCaptor = org.mockito.ArgumentCaptor.forClass(String.class);
        var detailsCaptor = org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(finalizer).failVideoJob(eq("120"), eq(GenerationError.ERROR_PROVIDER_FAILED),
                messageCaptor.capture(), detailsCaptor.capture(), eq("video-worker"), eq(1L));
        @SuppressWarnings("unchecked")
        Map<String, Object> details = detailsCaptor.getValue();
        assertThat(messageCaptor.getValue()).contains("HTTP 404");
        assertThat(details).doesNotContainKey("http_status").containsKey("raw");
    }


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


    @Nested
    @DisplayName("参考视频物理校验边界")
    class ReferenceValidationBoundary {

        @Test
        @DisplayName("G60: 200MB 恰好通过（>200MB 失败，边界包含）")
        void videoSize_200MB_exactlyPasses() {
            AssetEntity asset = videoAsset(200L * 1024 * 1024, null, null, null, "video/mp4");
            processor.validateReferenceVideo(asset, REF_MAX_DURATION_SEC);
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
            AssetEntity asset = videoAsset(1024L, 5000, 854, 480, "video/mp4");
            processor.validateReferenceVideo(asset, REF_MAX_DURATION_SEC);
        }

        @Test
        @DisplayName("G66: 单边 6000px 恰好通过（需满足像素/比例约束：3304x2490 ≈ 8,226,960px < 8,295,044）")
        void videoSide_6000px_exactlyPasses() {
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
    @DisplayName("能力行 image_reference_max=14：14 张放行、15 张拒绝（上限真由配置驱动，不固定 9）")
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

        org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                () -> processor.validateReferences(
                        VideoJobProcessor.LEGACY_REFERENCE_LIMITS,
                        List.of(videoRefAsset(15), videoRefAsset(15))));
    }

    @Test
    @DisplayName("referenceLimitsOf：读冻结值；整字段/单字段缺失回落旧常量；显式 null = 不限")
    void referenceLimitsOfParsing() {
        assertThat(VideoJobProcessor.referenceLimitsOf(baseInput()))
                .isEqualTo(VideoJobProcessor.LEGACY_REFERENCE_LIMITS);

        Map<String, Object> partial = baseInput();
        partial.put("reference_limits", Map.of("image_reference_max", 14));
        VideoJobProcessor.ReferenceLimits parsed = VideoJobProcessor.referenceLimitsOf(partial);
        assertThat(parsed.maxImages()).isEqualTo(14);
        assertThat(parsed.maxVideos()).isEqualTo(VideoJobProcessor.LEGACY_MAX_REFERENCE_VIDEOS);
        assertThat(parsed.maxDurationSec())
                .isEqualTo(VideoJobProcessor.LEGACY_MAX_REFERENCE_VIDEO_SECONDS);

        Map<String, Object> explicitNull = new HashMap<>();
        explicitNull.put("image_reference_max", 14);
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
        doAnswer(inv -> {
            List<String> ids = inv.getArgument(0);
            Map<String, AssetEntity> map = new HashMap<>();
            for (String id : ids) {
                map.put(id, videoRefAsset(2));
            }
            return map;
        }).when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());

        assertThat(processor.buildSubmitRequest(
                videoClaim("501", false, null, 0, 0, null, inputWithFlatVideoRefs(4, 5)))
                .references()).hasSize(4);

        VideoInputError error = org.junit.jupiter.api.Assertions.assertThrows(VideoInputError.class,
                () -> processor.buildSubmitRequest(
                        videoClaim("502", false, null, 0, 0, null, inputWithFlatVideoRefs(4, 3))));
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED);
        assertThat(error.getMessage()).contains("参考视频最多 3 个");
    }


    @Test
    @DisplayName("IKHBDO 回归：带参考视频的 job 不再按模型名前缀放行——2.5（非 seedance-2 / 非 doubao-seedance-2-0）照常提交")
    void referenceVideoAcceptedForNonSeedance2Model() {
        Map<String, Object> input = baseInput();
        input.put("model_id", "doubao-seedance-2-5-260628");
        input.put("references", List.of(Map.of(
                "role", "reference", "type", "video", "asset_id", "9")));
        doReturn(Map.of("9", videoAsset(1024L, 5000, 1280, 720, "video/mp4")))
                .when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());
        ClaimedVideoJobDto claim = videoClaim("601", false, null, 0, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("601"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new SubmitResult("task-ikhbdo", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("601"), anyString(), eq(1L), eq("task-ikhbdo"));

        processor.handle("601");

        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
        var captor = org.mockito.ArgumentCaptor.forClass(VideoSubmitInput.class);
        verify(videoClient).submit(eq("token"), captor.capture());
        assertThat(captor.getValue().model()).isEqualTo("doubao-seedance-2-5-260628");
        assertThat(captor.getValue().references())
                .containsExactly(new VideoReference("video", "http://video.mp4", null));
    }

    @Test
    @DisplayName("IKHBDO 回归：带参考音频的 job 同样不再按模型名放行——2.5（非 seedance-2 / 非 doubao-seedance-2-0）照常提交")
    void referenceAudioAcceptedForNonSeedance2Model() {
        Map<String, Object> input = baseInput();
        input.put("model_id", "doubao-seedance-2-5-260628");
        input.put("references", List.of(Map.of(
                "role", "reference", "type", "audio", "asset_id", "9")));
        doReturn(Map.of("9", audioAsset()))
                .when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());
        ClaimedVideoJobDto claim = videoClaim("602", false, null, 0, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("602"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new SubmitResult("task-ikhbdo-audio", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("602"), anyString(), eq(1L), eq("task-ikhbdo-audio"));

        processor.handle("602");

        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
        var captor = org.mockito.ArgumentCaptor.forClass(VideoSubmitInput.class);
        verify(videoClient).submit(eq("token"), captor.capture());
        assertThat(captor.getValue().model()).isEqualTo("doubao-seedance-2-5-260628");
        assertThat(captor.getValue().references())
                .containsExactly(new VideoReference("audio", "http://audio.mp3", null));
    }


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
        @DisplayName("裸「编辑」不算编辑意图（官方那条是「编辑视频」）")
        void bareEditIsNotEditIntent() {
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "编辑一下这个镜头"))
                    .isEqualTo("default");
        }

        @Test
        @DisplayName("裸「向前」不算延长意图（用户说的是运镜，不是要延长视频）")
        void bareDirectionIsNotProlongIntent() {
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "镜头向前推进"))
                    .isEqualTo("default");
        }

        @Test
        @DisplayName("官方延长词是完整词组「向前延长 / 向后延长」，「延续 / 续写」保留")
        void officialProlongPhrases() {
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "向前延长 3 秒"))
                    .isEqualTo("prolong");
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "续写这段"))
                    .isEqualTo("prolong");
        }


        @Test
        @DisplayName("IKJ78C 否定约束句不判编辑（六词闭集逐一覆盖）")
        void negatedClausesNotEdit() {
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "禁止修改人物形象"))
                    .isEqualTo("default");
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "不得替换背景"))
                    .isEqualTo("default");
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "不要替换背景"))
                    .isEqualTo("default");
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "不能去掉人物"))
                    .isEqualTo("default");
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "请勿删除水印"))
                    .isEqualTo("default");
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "无需增加字幕"))
                    .isEqualTo("default");
        }

        @Test
        @DisplayName("IKJ78C 混合句按肯定判：否定词与关键词跨子句不剔除（中英标点同权）")
        void mixedClauseResolvesEdit() {
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "禁止修改人物，把背景替换成海边"))
                    .isEqualTo("edit");
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "不要改人物,把背景替换成海边"))
                    .isEqualTo("edit");
        }

        @Test
        @DisplayName("IKJ78C 否定延长词同样剔除")
        void negatedProlongKeyword() {
            assertThat(VideoJobProcessor.resolveVideoTaskType(
                    List.of(Map.of("role", "reference", "type", "video")), "不要延续这个故事"))
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
        @DisplayName("IKK1T9：冻结模式为 edit 时 duration=-1 放行（提示词无编辑关键词也按快照判）")
        void autoDurationAllowedForFrozenEditMode() {
            Map<String, Object> input = baseInput();
            input.put("duration", -1);
            input.put("video_mode", "edit");
            input.put("references", List.of(Map.of("role", "reference", "type", "video",
                    "material_id", "Asset-video-1")));
            ClaimedVideoJobDto claim = videoClaim("302", false, null, 0, 0, null, input);

            assertThat(processor.buildSubmitRequest(claim).videoTaskType()).isEqualTo("edit");
        }

        @Test
        @DisplayName("IKK1T9：冻结模式为 text2video 时 duration=-1 仍拒（不因推断漏网）")
        void autoDurationRejectedForFrozenTextToVideoMode() {
            Map<String, Object> input = baseInput();
            input.put("duration", -1);
            input.put("video_mode", "text2video");
            input.put("references", List.of(Map.of("role", "reference", "type", "video")));
            ClaimedVideoJobDto claim = videoClaim("303", false, null, 0, 0, null, input);

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


    private static final int REF_MAX_DURATION_SEC = 15;

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

    private Map<String, Object> inputWithImageRefs(int n, int configuredMax) {
        Map<String, Object> input = baseInput();
        List<Map<String, Object>> refs = new java.util.ArrayList<>();
        for (int i = 1; i <= n; i++) {
            refs.add(Map.of("role", "reference", "type", "image", "asset_id", String.valueOf(i)));
        }
        input.put("references", refs);
        input.put("reference_limits", Map.of(
                "image_reference_max", configuredMax,
                "video_reference_max", 3,
                "audio_reference_max", 3,
                "max_reference_duration_sec", 15));
        return input;
    }

    private Map<String, Object> inputWithFlatVideoRefs(int n, int configuredVideoMax) {
        Map<String, Object> input = baseInput();
        List<String> ids = new java.util.ArrayList<>();
        for (int i = 1; i <= n; i++) {
            ids.add(String.valueOf(i));
        }
        input.put("reference_asset_ids", ids);
        input.put("reference_limits", Map.of(
                "image_reference_max", 9,
                "video_reference_max", configuredVideoMax,
                "audio_reference_max", 3,
                "max_reference_duration_sec", 15));
        return input;
    }


    private static final long G06_UPSTREAM_CREATED_AT_MS = 1_790_647_200_000L;
    private static final long G06_FINALIZE_DEADLINE_MS = 1_791_248_400_000L;

    private Map<String, Object> sampleInput() {
        Map<String, Object> input = baseInput();
        input.put("sample_mode", true);
        input.put("resolution", "480p");
        return input;
    }

    @Test
    @DisplayName("IKIZQ8: input.sample_mode=true → 提交体带 draft 标记（网关转 480p Draft）")
    void sampleSubmitCarriesDraftFlag() {
        ClaimedVideoJobDto claim = videoClaim("130", false, null, 0, 0, null, sampleInput());
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("130"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new SubmitResult("task-sample-1", "queued")).when(videoClient)
                .submit(anyString(), any(VideoSubmitInput.class));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("130"), anyString(), eq(1L), eq("task-sample-1"));

        processor.handle("130");

        var captor = org.mockito.ArgumentCaptor.forClass(VideoSubmitInput.class);
        verify(videoClient).submit(eq("token"), captor.capture());
        assertThat(captor.getValue().draft()).isTrue();
        assertThat(captor.getValue().resolution()).isEqualTo("480p");
    }

    @Test
    @DisplayName("IKIZQ8: 样片轮询成功且带可信 created_at → 发布附带截止（契约公式，金标 G06 值）")
    void samplePublishesWithFinalizeDeadline() {
        ClaimedVideoJobDto claim = videoClaim("131", false, "task-sample-2", 3, 100, null, sampleInput());
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("131"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://video.mp4", null, null,
                40_594L, G06_UPSTREAM_CREATED_AT_MS))
                .when(videoClient).poll(eq("token"), eq("task-sample-2"));
        doReturn(new StoredVideo("http://tos/video.mp4", "key", "video/mp4", 1024L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(anyString(), anyString());
        doReturn(true).when(finalizer)
                .publishVideoResult(anyString(), anyString(), anyString(),
                        anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(),
                        anyInt(), anyInt(), anyDouble(), any(), any());

        processor.handle("131");

        verify(finalizer).publishVideoResult(eq("131"), eq("1"), eq("42"),
                anyString(), eq(1L), eq("http://tos/video.mp4"), eq("key"), eq("video/mp4"),
                eq(1024L), eq("0123456789abcdef0123456789abcdef"), anyInt(), anyInt(), anyDouble(),
                eq(G06_UPSTREAM_CREATED_AT_MS), eq(G06_FINALIZE_DEADLINE_MS));
    }

    @Test
    @DisplayName("IKIZQ8: 缺可信 created_at → 样片仍交付但截止为 null（禁成片不禁交付）")
    void sampleWithoutTrustedCreatedAtStillDeliversWithNullDeadline() {
        ClaimedVideoJobDto claim = videoClaim("132", false, "task-sample-3", 3, 100, null, sampleInput());
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("132"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://video.mp4", null, null,
                40_594L, null))
                .when(videoClient).poll(eq("token"), eq("task-sample-3"));
        doReturn(new StoredVideo("http://tos/video.mp4", "key", "video/mp4", 1024L, "0123456789abcdef0123456789abcdef"))
                .when(mediaRelay).persist(anyString(), anyString());
        doReturn(true).when(finalizer)
                .publishVideoResult(anyString(), anyString(), anyString(),
                        anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(),
                        anyInt(), anyInt(), anyDouble(), any(), any());

        processor.handle("132");

        verify(finalizer).publishVideoResult(eq("132"), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(),
                anyInt(), anyInt(), anyDouble(), isNull(), isNull());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("IKIZQ8 G14: 样片转存不可用（无 TOS）→ 按本阶段失败，不以供应商 URL 充当成功")
    void sampleRelayUnavailableFailsInsteadOfStoringProviderUrl() {
        VideoJobProcessor noRelayProcessor = new VideoJobProcessor(
                stateMachine, finalizer, assetSource, upstreamCredential, videoClient, null, producer);
        ClaimedVideoJobDto claim = videoClaim("133", false, "task-sample-4", 3, 100, null, sampleInput());
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("133"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://provider-temp.mp4", null, null,
                null, G06_UPSTREAM_CREATED_AT_MS))
                .when(videoClient).poll(eq("token"), eq("task-sample-4"));

        noRelayProcessor.handle("133");

        verify(finalizer, never()).publishVideoResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(),
                anyInt(), anyInt(), anyDouble(), any(), any());
        verify(finalizer).failVideoJob(eq("133"), eq(GenerationError.ERROR_PROVIDER_FAILED),
                anyString(), any(), eq("video-worker"), eq(1L));
    }

    @Test
    @DisplayName("IKIZQ8 G12 回归: 普通视频转存不可用 → 仍走既有 URL 直存降级（旧行为零变化）")
    void normalVideoRelayUnavailableKeepsLegacyUrlFallback() {
        VideoJobProcessor noRelayProcessor = new VideoJobProcessor(
                stateMachine, finalizer, assetSource, upstreamCredential, videoClient, null, producer);
        ClaimedVideoJobDto claim = videoClaim("134", false, "task-normal", 3, 100, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("134"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://provider-temp.mp4", null, null, null))
                .when(videoClient).poll(eq("token"), eq("task-normal"));
        doReturn(true).when(finalizer)
                .publishVideoResult(anyString(), anyString(), anyString(),
                        anyString(), anyLong(), anyString(), any(), any(), any(), any(),
                        anyInt(), anyInt(), anyDouble(), any(), any());

        noRelayProcessor.handle("134");

        verify(finalizer).publishVideoResult(eq("134"), anyString(), anyString(),
                anyString(), anyLong(), eq("http://provider-temp.mp4"), isNull(), isNull(),
                isNull(), isNull(), anyInt(), anyInt(), anyDouble(), isNull(), isNull());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }


    private Map<String, Object> sampleInputWithReferences() {
        Map<String, Object> input = baseInput();
        input.put("sample_mode", true);
        input.put("resolution", "480p");
        input.put("aspect_ratio", "adaptive");
        input.put("references", List.of(
                Map.of("role", "first_frame", "type", "image", "asset_id", "11"),
                Map.of("role", "reference", "type", "image", "asset_id", "21"),
                Map.of("role", "reference", "type", "video", "asset_id", "31"),
                Map.of("role", "reference", "type", "audio", "asset_id", "32")));
        input.put("reference_limits", Map.of(
                "image_reference_max", 30,
                "video_reference_max", 10,
                "audio_reference_max", 10,
                "max_reference_duration_sec", 30));
        return input;
    }

    @Test
    @DisplayName("IKIZQ9: 样片快照带参考素材 → Draft 提交体保住 firstFrame/references 且带 draft 标记")
    void sampleSnapshotWithReferencesKeepsRolesAndDraftFlag() {
        doAnswer(inv -> {
            Map<String, AssetEntity> map = new HashMap<>();
            map.put("11", imageAsset("11", "https://tos.test/first.png"));
            map.put("21", imageAsset("21", "https://tos.test/ref.png"));
            map.put("31", videoAsset(1024L, 4000, 1280, 720, "video/mp4"));
            map.put("32", audioAsset());
            return map;
        }).when(assetSource).resolveInputAssets(anyList(), anyString(), anyString());

        VideoSubmitInput request = processor.buildSubmitRequest(
                videoClaim("135", false, null, 0, 0, null, sampleInputWithReferences()));

        assertThat(request.draft()).isTrue();
        assertThat(request.resolution()).isEqualTo("480p");
        assertThat(request.firstFrameImage()).isNull();
        assertThat(request.lastFrameImage()).isNull();
        assertThat(request.references()).hasSize(4);
        assertThat(request.references().get(0).type()).isEqualTo("image");
        assertThat(request.references().get(0).role()).isEqualTo("first_frame");
        assertThat(request.references().get(0).url()).isEqualTo("https://tos.test/first.png");
        assertThat(request.references().get(1).type()).isEqualTo("image");
        assertThat(request.references().get(2).type()).isEqualTo("video");
        assertThat(request.references().get(3).type()).isEqualTo("audio");
    }


    private ClaimedVideoJobDto finalClaim(String id, String providerTaskId,
                                          String sourceSampleProviderTaskId) {
        Map<String, Object> input = baseInput();
        input.put("resolution", "1080p");
        return new ClaimedVideoJobDto(
                id, "1", "42", input,
                providerTaskId, false,
                "video-worker", 1L,
                0, 0, null, "final", sourceSampleProviderTaskId);
    }

    @Test
    @DisplayName("IKIZQC: final 提交相 → 用样片公开 task ID 调 finalize，不重建 Draft 输入")
    void finalSubmitPhaseCallsGatewayFinalizeWithSampleTaskId() {
        ClaimedVideoJobDto claim = finalClaim("140", null, "task-sample-9");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("140"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new SubmitResult("task-final-77", "queued")).when(videoClient)
                .finalize(eq("token"), eq("task-sample-9"));
        doReturn(true).when(stateMachine)
                .markProviderSubmitted(eq("140"), anyString(), eq(1L), eq("task-final-77"));

        processor.handle("140");

        verify(videoClient, never()).submit(anyString(), any());
        verify(videoClient).finalize(eq("token"), eq("task-sample-9"));
        verify(stateMachine).markProviderSubmitted(eq("140"), anyString(), eq(1L), eq("task-final-77"));
        verify(producer).enqueue(eq("140"), eq(VideoJobProcessor.VIDEO_POLL_INTERVAL_MS));
    }

    @Test
    @DisplayName("IKIZQC: final 缺来源样片上游任务 ID → 按本阶段失败，不凭空提交新上游任务")
    void finalSubmitWithoutSourceTaskIdFailsStage() {
        ClaimedVideoJobDto claim = finalClaim("141", null, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("141"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();

        processor.handle("141");

        verify(videoClient, never()).finalize(anyString(), anyString());
        verify(videoClient, never()).submit(anyString(), any());
        verify(finalizer).failVideoJob(eq("141"), eq(GenerationError.ERROR_INVALID_INPUT),
                anyString(), any(), eq("video-worker"), eq(1L));
        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(), anyLong(), anyString());
    }

    @Test
    @DisplayName("IKIZQC G09/G14: final 轮询成功 → 转存自有 Asset 后发布，结算带成片阶段真实 token；截止列不动")
    void finalPollSuccessRelaysAndPublishesWithStageTokens() {
        ClaimedVideoJobDto claim = finalClaim("142", "task-final-77", "task-sample-9");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("142"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://provider-final.mp4", null, null,
                118_000L, null))
                .when(videoClient).poll(eq("token"), eq("task-final-77"));
        doReturn(new StoredVideo("https://tos/final.mp4", "storage/final.mp4", "video/mp4", 5L, "md5f"))
                .when(mediaRelay).persist(eq("http://provider-final.mp4"), eq("42"));
        doReturn(true).when(finalizer)
                .publishVideoResult(eq("142"), anyString(), anyString(), anyString(), anyLong(),
                        eq("https://tos/final.mp4"), eq("storage/final.mp4"), eq("video/mp4"),
                        eq(5L), eq("md5f"), anyInt(), anyInt(), anyDouble(),
                        isNull(), isNull());

        processor.handle("142");

        verify(finalizer).publishVideoResult(eq("142"), anyString(), anyString(), anyString(),
                anyLong(), eq("https://tos/final.mp4"), eq("storage/final.mp4"), eq("video/mp4"),
                eq(5L), eq("md5f"), anyInt(), anyInt(), anyDouble(),
                isNull(), isNull());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("IKIZQC G14: 成片转存不可用（无 TOS）→ 按本阶段失败，不以供应商 URL 充当成功")
    void finalRelayUnavailableFailsInsteadOfStoringProviderUrl() {
        VideoJobProcessor noRelayProcessor = new VideoJobProcessor(
                stateMachine, finalizer, assetSource, upstreamCredential, videoClient, null, producer);
        ClaimedVideoJobDto claim = finalClaim("143", "task-final-8", "task-sample-9");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("143"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("succeeded", 100, "http://provider-temp.mp4", null, null,
                null, null))
                .when(videoClient).poll(eq("token"), eq("task-final-8"));

        noRelayProcessor.handle("143");

        verify(finalizer, never()).publishVideoResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(),
                anyInt(), anyInt(), anyDouble(), any(), any());
        verify(finalizer).failVideoJob(eq("143"), eq(GenerationError.ERROR_PROVIDER_FAILED),
                anyString(), any(), eq("video-worker"), eq(1L));
    }

    @Test
    @DisplayName("IKIZQC G08/G09: final 轮询失败 → failVideoJob（守卫置 released、返还该阶段预扣，样片不动）")
    void finalPollFailureFailsStageOnly() {
        ClaimedVideoJobDto claim = finalClaim("144", "task-final-9", "task-sample-9");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("144"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new VideoTaskObservation("failed", 100, null, null,
                new TaskError("InternalServiceError", "上游成片失败"), null, null))
                .when(videoClient).poll(eq("token"), eq("task-final-9"));

        processor.handle("144");

        verify(finalizer).failVideoJob(eq("144"), eq("InternalServiceError"),
                anyString(), any(), eq("video-worker"), eq(1L));
        verify(finalizer, never()).publishVideoResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyString(),
                anyInt(), anyInt(), anyDouble(), any(), any());
    }


    @Test
    @DisplayName("IKIZQD: finalize 超时（无可用响应）→ 留 checking：不 failVideo、不落句柄、不重排、记 submission_unknown")
    void finalSubmitTimeoutStaysChecking() {
        ClaimedVideoJobDto claim = finalClaim("145", null, "task-sample-9");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("145"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "new-api 成片提交超时"))
                .when(videoClient).finalize(eq("token"), eq("task-sample-9"));

        processor.handle("145");

        verify(stateMachine).markSubmissionAttempt(eq("145"), anyString(), eq(1L));
        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(), anyLong(), anyString());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
        verifyNoInteractions(producer);
        verify(stateMachine).appendLog(eq("145"), eq("submission_unknown"), eq("checking"),
                anyString(), any());
    }

    @Test
    @DisplayName("IKIZQD: finalize 响应丢失（2xx 但缺 task_id / 非 JSON）→ 同超时：留 checking 锁定")
    void finalSubmitResponseLostStaysChecking() {
        ClaimedVideoJobDto claim = finalClaim("146", null, "task-sample-9");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("146"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "new-api 视频提交响应缺少 task_id"))
                .when(videoClient).finalize(eq("token"), eq("task-sample-9"));

        processor.handle("146");

        verify(videoClient, times(1)).finalize(eq("token"), eq("task-sample-9"));
        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(), anyLong(), anyString());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
        verifyNoInteractions(producer);
    }

    @Test
    @DisplayName("IKIZQD: finalize 已受理但 markProviderSubmitted 落库失败 → 留 checking（绝不 failVideo 退款）")
    void finalSubmitPersistFailureStaysChecking() {
        ClaimedVideoJobDto claim = finalClaim("147", null, "task-sample-9");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("147"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(new SubmitResult("task-final-x", "queued")).when(videoClient)
                .finalize(eq("token"), eq("task-sample-9"));
        doThrow(new RuntimeException("DB down"))
                .when(stateMachine).markProviderSubmitted(eq("147"), anyString(), eq(1L), eq("task-final-x"));

        processor.handle("147");

        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
        verifyNoInteractions(producer);
        verify(stateMachine).appendLog(eq("147"), eq("submission_unknown"), eq("checking"),
                anyString(), any());
    }

    @Test
    @DisplayName("IKIZQD: 失租（markSubmissionAttempt 守卫未命中）→ 停止：零网关调用、零句柄、零重排")
    void submissionMarkerMissStopsBeforeGateway() {
        ClaimedVideoJobDto claim = finalClaim("148", null, "task-sample-9");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("148"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doReturn(false).when(stateMachine)
                .markSubmissionAttempt(eq("148"), anyString(), eq(1L));

        processor.handle("148");

        verify(videoClient, never()).finalize(anyString(), anyString());
        verify(videoClient, never()).submit(anyString(), any());
        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(), anyLong(), anyString());
        verifyNoInteractions(producer);
    }

    @Test
    @DisplayName("IKIZQD: 网关明确拒绝（带 HTTP 状态 cause）→ 明确失败：failVideoJob 释放该阶段预扣")
    void finalSubmitDefiniteRejectionFailsStage() {
        ClaimedVideoJobDto claim = finalClaim("149", null, "task-sample-9");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("149"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_QUOTA_EXHAUSTED,
                "new-api 成片提交失败: HTTP 403 body=quota",
                new NewApiVideoClient.HttpStatusException(403)))
                .when(videoClient).finalize(eq("token"), eq("task-sample-9"));

        processor.handle("149");

        verify(finalizer).failVideoJob(eq("149"), eq(GenerationError.ERROR_QUOTA_EXHAUSTED),
                anyString(), any(), eq("video-worker"), eq(1L));
        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(), anyLong(), anyString());
    }

    @Test
    @DisplayName("IKIZQD: 提交顺序——「提交中」标记先于网关调用（持久化先于副作用）")
    void submissionMarkerPrecedesGatewayCall() {
        ClaimedVideoJobDto claim = finalClaim("150", null, "task-sample-9");
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("150"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "new-api 成片提交超时"))
                .when(videoClient).finalize(eq("token"), eq("task-sample-9"));

        processor.handle("150");

        org.mockito.InOrder order = inOrder(stateMachine, videoClient);
        order.verify(stateMachine).markSubmissionAttempt(eq("150"), anyString(), eq(1L));
        order.verify(videoClient).finalize(eq("token"), eq("task-sample-9"));
    }

    @Test
    @DisplayName("IKIZQD: 普通视频 submit 超时 → 同骨架留 checking（样片 draft 提交共用此路径）")
    void normalSubmitTimeoutStaysChecking() {
        Map<String, Object> input = baseInput();
        ClaimedVideoJobDto claim = videoClaim("151", false, null, 0, 0, null, input);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("151"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();
        doThrow(new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "new-api 视频提交超时"))
                .when(videoClient).submit(eq("token"), any(VideoSubmitInput.class));

        processor.handle("151");

        verify(stateMachine).markSubmissionAttempt(eq("151"), anyString(), eq(1L));
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong());
        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(), anyLong(), anyString());
        verifyNoInteractions(producer);
    }

    @Test
    @DisplayName("IKIZQD: 本地前置校验失败（final 缺样片任务 ID）→ 不落提交标记、不占上游尝试")
    void finalSubmitLocalValidationSkipsMarker() {
        ClaimedVideoJobDto claim = finalClaim("152", null, null);
        doReturn(Optional.of(claim)).when(stateMachine)
                .claimVideoJobById(eq("152"), anyString());
        doReturn("token").when(upstreamCredential).requireKey();

        processor.handle("152");

        verify(stateMachine, never()).markSubmissionAttempt(anyString(), anyString(), anyLong());
        verify(finalizer).failVideoJob(eq("152"), eq(GenerationError.ERROR_INVALID_INPUT),
                anyString(), any(), eq("video-worker"), eq(1L));
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

    private AssetEntity linkedImageAsset(String id, String url, String materialId) {
        AssetEntity a = imageAsset(id, url);
        a.setMaterialId(materialId);
        return a;
    }
}
