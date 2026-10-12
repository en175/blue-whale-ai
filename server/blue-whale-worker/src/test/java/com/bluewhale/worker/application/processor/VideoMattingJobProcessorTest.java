package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishVideoMattingDto;
import com.bluewhale.worker.domain.dto.UpdateVideoMattingProgressDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoMattingError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient.MatteVideoTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class VideoMattingJobProcessorTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobClaimService claimService;
    @Mock private GenerationJobMapper jobMapper;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetMapper assetMapper;
    @Mock private UpstreamCredential upstreamCredential;
    @Mock private NewApiMediaKitMatteVideoClient matteVideoClient;
    @Mock private TosVideoMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private VideoMattingJobProcessor processor;

    private static Map<String, Object> webmInput(String mode) {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("mode", mode);
        input.put("format", "WEBM");
        return input;
    }

    private static Map<String, Object> mp4Input(String mode, String backgroundColor) {
        Map<String, Object> input = webmInput(mode);
        input.put("format", "MP4");
        if (backgroundColor != null) {
            input.put("background_color", backgroundColor);
        }
        return input;
    }

    @BeforeEach
    void setUp() {
        processor = new VideoMattingJobProcessor(
                stateMachine, claimService, jobMapper, finalizer, new AssetSourceService(assetMapper),
                upstreamCredential, matteVideoClient, mediaRelay, producer);
        when(finalizer.failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong())).thenReturn(true);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen-token");
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenReturn(true);
        when(stateMachine.reserveParentReuseSubmit(anyString(), anyString(), anyLong()))
                .thenReturn(true);
    }

    private void stubSourceAsset(Integer width, Integer height) {
        AssetEntity source = new AssetEntity();
        source.setType("video");
        source.setUrl("https://example.com/src.mp4");
        source.setStorageKey("uploads/9/video/src.mp4");
        source.setWidth(width);
        source.setHeight(height);
        source.setDurationMs(65_000);
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(source);
    }

    private ClaimedJob makeClaim(Map<String, Object> input, String providerTaskId,
                                                int pollCount) {
        return makeClaim(input, providerTaskId, pollCount, null);
    }

    private ClaimedJob makeClaim(Map<String, Object> input, String providerTaskId,
                                                int pollCount, String parentProviderTaskId) {
        return new ClaimedJob(
                "100", "42", "9", input, "video_matting", providerTaskId, false, "worker-1",
                5L, pollCount, 0, null, null, parentProviderTaskId);
    }

    private void stubSubmitClaim(Map<String, Object> input) {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, null, 0)));
    }

    private void stubPollClaim(Map<String, Object> input, int pollCount) {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, "amk-task-1", pollCount)));
    }

    private void assertFailCode(String expectedCode) {
        verify(finalizer).failVideoJob(eq("100"), eq(expectedCode), anyString(),
                any(), eq("worker-1"), eq(5L));
    }


    @Test
    @DisplayName("claim 抛 DB 异常 → 上抛（不 fail job，不 ack → 重投）")
    void claimThrowsDbError_propagates() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.empty());

        processor.handle("100");

        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(finalizer, never()).publishVideoMattingResult(any());
    }


    @Test
    @DisplayName("缺 source_asset_id → invalid_input")
    void missingSourceAssetId_invalidInput() {
        Map<String, Object> input = webmInput("portrait");
        input.remove("source_asset_id");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("mode 枚举外 → invalid_input")
    void invalidMode_invalidInput() {
        stubSubmitClaim(webmInput("cutout"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("format 枚举外（含未暴露的 MOV 档）→ invalid_input")
    void invalidFormat_invalidInput() {
        Map<String, Object> input = webmInput("portrait");
        input.put("format", "MOV");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("MP4 缺 background_color → invalid_input（创建侧补缺省后冻结，缺失即脏形态）")
    void mp4MissingBackgroundColor_invalidInput() {
        stubSubmitClaim(mp4Input("greenscreen", null));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("WEBM 带 background_color → invalid_input（透明输出不接受背景色，契约 refine 同款）")
    void webmWithBackgroundColor_invalidInput() {
        Map<String, Object> input = webmInput("portrait");
        input.put("background_color", "white");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }


    @Test
    @DisplayName("源素材不可用（非 video）→ 1050 兜底 + 可读原因，不提交上游")
    void sourceAssetNotVideo_mattingFailed() {
        stubSubmitClaim(webmInput("portrait"));
        AssetEntity image = new AssetEntity();
        image.setType("image");
        image.setUrl("https://example.com/src.png");
        image.setStorageKey("uploads/9/image/src.png");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(image);

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
        verify(matteVideoClient, never()).submit(anyString(), anyString(), anyString(),
                anyString(), any());
    }

    @Test
    @DisplayName("上游凭证未配置 → provider_credential_missing")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = webmInput("portrait");
        stubSubmitClaim(input);

        when(upstreamCredential.requireKey())
                .thenThrow(new IllegalStateException(
                        "上游凭证未配置：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key"));
        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }


    @Test
    @DisplayName("submit WEBM/portrait：client 收 null 背景色（出站不带）→ markProviderSubmitted + scheduleNext(5s)")
    void submitWebmPortrait_transportsNullBackgroundColor() {
        stubSubmitClaim(webmInput("portrait"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit("sk-frozen-token", "https://example.com/src.mp4",
                "portrait", "WEBM", null))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(matteVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                "portrait", "WEBM", null);
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", VideoMattingJobProcessor.VIDEO_MATTING_POLL_INTERVAL_MS);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("submit MP4/greenscreen：client 收冻结背景色（出站显式携带）→ 分流参数齐")
    void submitMp4Greenscreen_transportsBackgroundColor() {
        stubSubmitClaim(mp4Input("greenscreen", "white"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit("sk-frozen-token", "https://example.com/src.mp4",
                "greenscreen", "MP4", "white"))
                .thenReturn("amk-task-2");
        when(stateMachine.markProviderSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(true);

        processor.handle("100");

        verify(matteVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                "greenscreen", "MP4", "white");
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-2");
        verify(producer).enqueue("100", VideoMattingJobProcessor.VIDEO_MATTING_POLL_INTERVAL_MS);
    }

    @Test
    @DisplayName("markProviderSubmitted 守卫未命中（stale worker）→ 不自投下一步")
    void submitGuardMissed_noScheduleNext() {
        stubSubmitClaim(webmInput("portrait"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
    }


    @Test
    @DisplayName("submit content_rejected → 保留既有码投影（§5 信号）")
    void submitContentRejected_preserved() {
        stubSubmitClaim(webmInput("portrait"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit(anyString(), anyString(), anyString(), anyString(), any()))
                .thenThrow(new VideoMattingError(GenerationError.ERROR_CONTENT_REJECTED,
                        "智能抠像任务提交失败: HTTP 400 sensitive content"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("submit provider_failed → 归并 1050 兜底（无自动重试）")
    void submitProviderFailed_normalized() {
        stubSubmitClaim(webmInput("portrait"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit(anyString(), anyString(), anyString(), anyString(), any()))
                .thenThrow(new VideoMattingError(GenerationError.ERROR_PROVIDER_FAILED,
                        "智能抠像任务提交失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
    }

    @Test
    @DisplayName("submit 超时（provider_timeout）→ 归并 1050（宁可不重试也不双跑，家族口径）")
    void submitTimeout_normalized() {
        stubSubmitClaim(webmInput("portrait"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit(anyString(), anyString(), anyString(), anyString(), any()))
                .thenThrow(new VideoMattingError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 智能抠像提交超时"));

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
        verify(producer, never()).enqueue(anyString(), anyLong());
    }


    @Test
    @DisplayName("parent-reuse 命中：父任务成功且 videoUrl+resolution 齐全 → 不提交，直接转存发布（payload 与正常完成同型，含转存前续租）")
    void parentReuseSuccess_publishesWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-1")));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/old-out.webm?auth_key=...", "1080p", 65.5, null, null));
        when(mediaRelay.persistStreaming(eq("https://volc/old-out.webm?auth_key=..."), eq("9"),
                eq(VideoMattingContract.MAX_RESULT_BYTES), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.webm", "generated/9/video/abc.webm",
                        "video/webm", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishVideoMattingResult(any())).thenReturn(true);

        processor.handle("100");

        verify(matteVideoClient, never()).submit(anyString(), anyString(), anyString(),
                anyString(), any());
        verify(stateMachine).updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class));
        verify(mediaRelay).persistStreaming(eq("https://volc/old-out.webm?auth_key=..."), eq("9"),
                eq(VideoMattingContract.MAX_RESULT_BYTES), any());
        ArgumentCaptor<PublishVideoMattingDto> captor =
                ArgumentCaptor.forClass(PublishVideoMattingDto.class);
        verify(finalizer).publishVideoMattingResult(captor.capture());
        PublishVideoMattingDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.webm");
        assertThat(published.storageKey()).isEqualTo("generated/9/video/abc.webm");
        assertThat(published.mime()).isEqualTo("video/webm");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(published.width()).isEqualTo(1920);
        assertThat(published.height()).isEqualTo(1080);
        assertThat(published.durationSec()).isEqualTo(65.5);
        assertThat(published.resolution()).isEqualTo("1080p");
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 父任务 failed → 回退正常重新提交")
    void parentReuseFailed_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-fail")));
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-fail"))
                .thenReturn(new MatteVideoTaskObservation("failed", null, null, null,
                        "VideoQualityTooLow", "视频画质过低无法识别人像"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(matteVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                "portrait", "WEBM", null);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查父任务异常（不存在/网络错）→ 按不存在处理，回退正常重新提交")
    void parentReusePollError_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-gone")));
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-gone"))
                .thenThrow(new VideoMattingError(GenerationError.ERROR_PROVIDER_FAILED,
                        "MediaKit 智能抠像任务查询失败: HTTP 404"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(matteVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                "portrait", "WEBM", null);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("非重试 job（parentProviderTaskId=null）→ 不查父任务，执行路径与现状完全一致")
    void nonRetryJob_skipsParentQuery() {
        stubSubmitClaim(webmInput("portrait"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(matteVideoClient, never()).poll(anyString(), anyString());
        verify(matteVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                "portrait", "WEBM", null);
    }

    @Test
    @DisplayName("parent-reuse 父任务成功但结果 URL 为空（结果不齐全）→ 回退正常重新提交")
    void parentReuseIncompleteUrl_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-empty")));
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-empty"))
                .thenReturn(new MatteVideoTaskObservation("succeeded", null, "1080p", 65.5,
                        null, null));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(matteVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                "portrait", "WEBM", null);
        verify(mediaRelay, never()).persistStreaming(anyString(), anyString(), anyLong(), any());
    }

    @Test
    @DisplayName("parent-reuse 父任务成功但缺分辨率档位（本家族齐全口径双条件，对齐轮询相）→ 回退正常重新提交")
    void parentReuseMissingResolution_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-nores")));
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-nores"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/old-out.webm", null, 65.5, null, null));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(matteVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                "portrait", "WEBM", null);
        verify(mediaRelay, never()).persistStreaming(anyString(), anyString(), anyLong(), any());
    }

    @Test
    @DisplayName("parent-reuse 收割发布失败（转存下载 404，URL 超 24h 失效）→ 回退正常重新提交，不落失败终态")
    void parentReusePublishFails_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-stale")));
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-stale"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/expired-out.webm", "1080p", 65.5, null, null));
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenThrow(new RuntimeException("生成视频下载失败: HTTP 404"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(matteVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                "portrait", "WEBM", null);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 收割发布守卫未命中（publish 返回 false）→ 停止本次执行：不提交、不自投、不落失败终态（IKICD0，与心跳失租同一停止语义）")
    void parentReusePublishGuardMissed_stopWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-guard")));
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-guard"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/old-out.webm", "1080p", 65.5, null, null));
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.webm", "generated/9/video/abc.webm",
                        "video/webm", 1L, null));
        when(finalizer.publishVideoMattingResult(any())).thenReturn(false);
        stubSourceAsset(1920, 1080);

        processor.handle("100");

        verify(matteVideoClient, never()).submit(anyString(), anyString(), anyString(),
                anyString(), any());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
        verify(finalizer).hasPublishedAsset("100", "generated/9/video/abc.webm");
        verify(mediaRelay).deleteUnpublishedObject("generated/9/video/abc.webm");
    }

    @Test
    @DisplayName("parent-reuse 收割转存前续租未命中（已被接管/终态）→ 静默退出：不提交、不转存、不落失败（租约丢失≠回退）")
    void parentReuseRenewMissed_silentExitWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-taken")));
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-taken"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/old-out.webm", "1080p", 65.5, null, null));
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenReturn(false);

        processor.handle("100");

        verify(mediaRelay, never()).persistStreaming(anyString(), anyString(), anyLong(), any());
        verify(matteVideoClient, never()).submit(anyString(), anyString(), anyString(),
                anyString(), any());
        verify(finalizer, never()).publishVideoMattingResult(any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @Timeout(30)
    @DisplayName("parent-reuse 收割转存中被接管（心跳未命中中止传输）→ 静默退出：不提交、不发布、不落失败（防双跑烧上游费）")
    void parentReuseLeaseLostDuringTransfer_silentExitWithoutSubmit() throws Exception {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-lost")));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-lost"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/old-out.webm", "1080p", 65.5, null, null));
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenReturn(true, false, false, false, false);
        TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay.StoredVideo(
                "https://tos/out.webm", "generated/9/video/abc.webm",
                "video/webm", 1L, null);
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenAnswer(inv -> simulateLongTransfer(inv, stored));
        processor.leaseRenewIntervalMs = 40;

        processor.handle("100");

        verify(matteVideoClient, never()).submit(anyString(), anyString(), anyString(),
                anyString(), any());
        verify(finalizer, never()).publishVideoMattingResult(any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @Timeout(10)
    @DisplayName("parent-reuse 转存抛普通异常时心跳已失租，旧 worker 停止而不重新提交")
    void parentReuseTransferFailureAfterHeartbeatLost_stopsWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-race")));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-race"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/old-out.webm", "1080p", 65.5, null, null));
        CountDownLatch leaseLost = new CountDownLatch(1);
        AtomicInteger renewals = new AtomicInteger();
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenAnswer(invocation -> {
                    if (renewals.incrementAndGet() == 1) return true;
                    leaseLost.countDown();
                    return false;
                });
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenAnswer(invocation -> {
                    assertThat(leaseLost.await(3, TimeUnit.SECONDS)).isTrue();
                    throw new RuntimeException("生成视频下载失败: HTTP 404");
                });
        processor.leaseRenewIntervalMs = 20;

        processor.handle("100");

        verify(matteVideoClient, never()).submit(anyString(), anyString(), anyString(),
                anyString(), any());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).publishVideoMattingResult(any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 转存异常后续租状态无法确认，旧 worker 停止而不重新提交")
    void parentReuseTransferFailureThenLeaseUnknown_stopsWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-unknown")));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-unknown"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/old-out.webm", "1080p", 65.5, null, null));
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenReturn(true)
                .thenThrow(new IllegalStateException("DB unavailable"));
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenThrow(new RuntimeException("生成视频下载失败: HTTP 404"));

        processor.handle("100");

        verify(matteVideoClient, never()).submit(anyString(), anyString(), anyString(),
                anyString(), any());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).publishVideoMattingResult(any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 发布异常后提交前失租，旧 worker 不创建无人轮询的上游任务")
    void parentReuseLeaseLostBeforeFallbackSubmit_stopsWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(webmInput("portrait"), null, 0, "amk-parent-before-submit")));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-parent-before-submit"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/old-out.webm", "1080p", 65.5, null, null));
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenThrow(new RuntimeException("生成视频下载失败: HTTP 404"));
        when(stateMachine.reserveParentReuseSubmit("100", "worker-1", 5L)).thenReturn(false);

        processor.handle("100");

        verify(matteVideoClient, never()).submit(anyString(), anyString(), anyString(),
                anyString(), any());
        verify(stateMachine, never()).markProviderSubmitted(anyString(), anyString(),
                anyLong(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }


    @Test
    @DisplayName("poll processing → rescheduleProviderPoll + scheduleNext(5s)")
    void pollProcessing_reschedules() {
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("processing", null, null, null,
                        null, null));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoMattingJobProcessor.VIDEO_MATTING_POLL_INTERVAL_MS);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 超限（pollCount>=720）→ 1050 轮询超时，不再续排")
    void pollExceedsLimit_fails() {
        stubPollClaim(webmInput("portrait"), VideoMattingJobProcessor.MAX_VIDEO_MATTING_POLLS);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("processing", null, null, null,
                        null, null));

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）→ reschedule 续排，不落终态")
    void pollTransientError_reschedules() {
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoMattingError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 智能抠像任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoMattingJobProcessor.VIDEO_MATTING_POLL_INTERVAL_MS);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）+ 第 720 次 → 1050 轮询超时，文案不变不写 http_status（无 cause 不推断，IKIN6X）")
    void pollTransientErrorAtLimit_fails() {
        stubPollClaim(webmInput("portrait"), VideoMattingJobProcessor.MAX_VIDEO_MATTING_POLLS);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoMattingError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 智能抠像任务查询超时"));

        processor.handle("100");

        ArgumentCaptor<Map<String, Object>> detailsCaptor = ArgumentCaptor.captor();
        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED),
                eq("智能抠像轮询超时（超过 " + VideoMattingJobProcessor.MAX_VIDEO_MATTING_POLLS + " 次）"),
                detailsCaptor.capture(), eq("worker-1"), eq(5L));
        assertThat(detailsCaptor.getValue()).doesNotContainKey("http_status");
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（HTTP 429）+ 第 720 次 → 1050 + details.http_status=429，文案与原文案完全一致（IKIN6X）")
    void pollTransientServerErrorAtLimit_fails() {
        stubPollClaim(webmInput("portrait"), VideoMattingJobProcessor.MAX_VIDEO_MATTING_POLLS);
        VideoMattingError rateLimited = new VideoMattingError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 智能抠像任务查询失败: HTTP 429");
        rateLimited.initCause(new NewApiVideoClient.HttpStatusException(429));
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(rateLimited);

        processor.handle("100");

        ArgumentCaptor<String> messageCaptor = ArgumentCaptor.captor();
        ArgumentCaptor<Map<String, Object>> detailsCaptor = ArgumentCaptor.captor();
        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED),
                messageCaptor.capture(), detailsCaptor.capture(), eq("worker-1"), eq(5L));
        assertThat(messageCaptor.getValue())
                .isEqualTo("智能抠像轮询超时（超过 " + VideoMattingJobProcessor.MAX_VIDEO_MATTING_POLLS + " 次）")
                .doesNotContain("429");
        assertThat(detailsCaptor.getValue())
                .containsEntry("raw", messageCaptor.getValue())
                .containsEntry("http_status", 429);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）+ 未到上限（719）→ 仍续排，不落终态")
    void pollTransientErrorBelowLimit_reschedules() {
        stubPollClaim(webmInput("portrait"), VideoMattingJobProcessor.MAX_VIDEO_MATTING_POLLS - 1);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoMattingError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 智能抠像任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoMattingJobProcessor.VIDEO_MATTING_POLL_INTERVAL_MS);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 硬错误（HTTP 404 任务不存在）→ 1050 兜底")
    void pollHardError_fails() {
        stubPollClaim(webmInput("portrait"), 3);
        VideoMattingError notFound = new VideoMattingError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 智能抠像任务查询失败: HTTP 404");
        notFound.initCause(new NewApiVideoClient.HttpStatusException(404));
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(notFound);

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
    }

    @Test
    @DisplayName("poll failed → 1050 + 上游可读原因透传（前端投影）")
    void pollFailed_transportsUpstreamReason() {
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("failed", null, null, null,
                        "VideoQualityTooLow", "视频画质过低无法识别人像"));

        processor.handle("100");

        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED),
                eq("视频画质过低无法识别人像"),
                any(), eq("worker-1"), eq(5L));
    }

    @Test
    @DisplayName("poll failed + 额度信号 → platform_quota_exhausted（§5 保留）")
    void pollFailedQuotaSignal_preserved() {
        stubPollClaim(webmInput("greenscreen"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("failed", null, null, null,
                        null, "剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED);
    }


    @Test
    @DisplayName("poll 上游 401（cause 携带状态）→ details.http_status=401，message 剥离状态码字样")
    void pollUnauthorized_persistsHttpStatusDetail() {
        stubPollClaim(webmInput("portrait"), 3);
        VideoMattingError unauthorized = new VideoMattingError(
                GenerationError.ERROR_PROVIDER_FAILED,
                "MediaKit 智能抠像任务查询失败: HTTP 401"
                        + " body={\"error\":{\"message\":\"Incorrect API key\"}} request_id=req-poll-3");
        unauthorized.initCause(new NewApiVideoClient.HttpStatusException(401));
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(unauthorized);

        processor.handle("100");

        ArgumentCaptor<String> messageCaptor = ArgumentCaptor.captor();
        ArgumentCaptor<Map<String, Object>> detailsCaptor = ArgumentCaptor.captor();
        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED),
                messageCaptor.capture(), detailsCaptor.capture(), eq("worker-1"), eq(5L));
        assertThat(messageCaptor.getValue()).doesNotContain("401").contains("Incorrect API key");
        assertThat(detailsCaptor.getValue())
                .containsEntry("raw", "MediaKit 智能抠像任务查询失败:"
                        + " body={\"error\":{\"message\":\"Incorrect API key\"}} request_id=req-poll-3")
                .containsEntry("http_status", 401);
    }


    @Test
    @DisplayName("poll completed → 转存前续租一次（进度沿用快照）→ persist → 发布 payload：转存地址 + 源宽高近似 + 官方 duration/resolution + md5 穿透")
    void pollCompleted_publishesWithLeaseRenewal() {
        stubPollClaim(webmInput("portrait"), 3);
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm?auth_key=...", "1080p", 65.5, null, null));
        when(mediaRelay.persistStreaming(eq("https://volc/out.webm?auth_key=..."), eq("9"),
                eq(VideoMattingContract.MAX_RESULT_BYTES), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.webm", "generated/9/video/abc.webm",
                        "video/webm", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishVideoMattingResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<UpdateVideoMattingProgressDto> renewCaptor =
                ArgumentCaptor.forClass(UpdateVideoMattingProgressDto.class);
        verify(stateMachine).updateVideoMattingProgress(renewCaptor.capture());
        assertThat(renewCaptor.getValue().jobId()).isEqualTo("100");
        assertThat(renewCaptor.getValue().workerId()).isEqualTo("worker-1");
        assertThat(renewCaptor.getValue().fencingToken()).isEqualTo(5L);
        assertThat(renewCaptor.getValue().progress()).isEqualTo(0);
        verify(mediaRelay).persistStreaming(eq("https://volc/out.webm?auth_key=..."), eq("9"),
                eq(VideoMattingContract.MAX_RESULT_BYTES), any());
        ArgumentCaptor<PublishVideoMattingDto> captor =
                ArgumentCaptor.forClass(PublishVideoMattingDto.class);
        verify(finalizer).publishVideoMattingResult(captor.capture());
        PublishVideoMattingDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.webm");
        assertThat(published.storageKey()).isEqualTo("generated/9/video/abc.webm");
        assertThat(published.mime()).isEqualTo("video/webm");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(published.width()).isEqualTo(1920);
        assertThat(published.height()).isEqualTo(1080);
        assertThat(published.durationSec()).isEqualTo(65.5);
        assertThat(published.resolution()).isEqualTo("1080p");
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("completed 无官方 duration → 回落源 duration_ms 换算秒")
    void pollCompleted_fallsBackToSourceDuration() {
        stubPollClaim(mp4Input("greenscreen", "white"), 3);
        stubSourceAsset(1080, 1920);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.mp4", "1080p", null, null, null));
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 1L, null));
        when(finalizer.publishVideoMattingResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<PublishVideoMattingDto> captor =
                ArgumentCaptor.forClass(PublishVideoMattingDto.class);
        verify(finalizer).publishVideoMattingResult(captor.capture());
        assertThat(captor.getValue().durationSec()).isEqualTo(65.0);
        assertThat(captor.getValue().width()).isEqualTo(1080);
        assertThat(captor.getValue().height()).isEqualTo(1920);
    }

    @Test
    @DisplayName("转存续租未命中（已被接管/终态）→ 中止转存，不 persist 不发布不落失败（stale worker 静默退出）")
    void renewMissed_abortsTransfer() {
        stubPollClaim(webmInput("portrait"), 3);
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenReturn(false);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", "1080p", 65.5, null, null));

        processor.handle("100");

        verify(mediaRelay, never()).persistStreaming(anyString(), anyString(), anyLong(), any());
        verify(finalizer, never()).publishVideoMattingResult(any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }


    private static TosVideoMediaRelay.StoredVideo simulateLongTransfer(
            org.mockito.invocation.InvocationOnMock invocation,
            TosVideoMediaRelay.StoredVideo success) throws InterruptedException {
        TosVideoMediaRelay.TransferAbortHandle handle =
                invocation.getArgument(3);
        long deadline = System.currentTimeMillis() + 5_000;
        while (!handle.aborted() && System.currentTimeMillis() < deadline) {
            Thread.sleep(10);
        }
        if (handle.aborted()) {
            throw new TosVideoMediaRelay.TransferAbortedException(handle.reason());
        }
        return success;
    }

    @Test
    @Timeout(30)
    @DisplayName("长转存期间持续续租（IKHSFD）：心跳跨传输全程保持命中 → 正常发布一次，不落失败")
    void longTransfer_keepsRenewingLease() {
        stubPollClaim(webmInput("portrait"), 3);
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", "1080p", 65.5, null, null));
        TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay.StoredVideo(
                "https://tos/out.webm", "generated/9/video/abc.webm",
                "video/webm", 123_456L, "0123456789abcdef0123456789abcdef");
        var renewals = new java.util.concurrent.CountDownLatch(3);
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenAnswer(inv -> { renewals.countDown(); return true; });
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenAnswer(inv -> {
                    assertThat(renewals.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                    return stored;
                });
        when(finalizer.publishVideoMattingResult(any())).thenReturn(true);
        processor.leaseRenewIntervalMs = 40;

        processor.handle("100");

        verify(stateMachine, atLeast(3)).updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class));
        verify(finalizer).publishVideoMattingResult(any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @Timeout(30)
    @DisplayName("转存期间租约被接管（心跳未命中，IKHSFD）→ 中止传输，本 worker 静默退出：不发布、不落失败、不覆盖新 worker 状态")
    void leaseLostDuringTransfer_abortsAndSilentlyExits() throws Exception {
        stubPollClaim(webmInput("portrait"), 3);
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", "1080p", 65.5, null, null));
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenReturn(true, false, false, false, false);
        TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay.StoredVideo(
                "https://tos/out.webm", "generated/9/video/abc.webm",
                "video/webm", 1L, null);
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenAnswer(inv -> simulateLongTransfer(inv, stored));
        processor.leaseRenewIntervalMs = 40;

        processor.handle("100");

        verify(finalizer, never()).publishVideoMattingResult(any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("传输返回成功前已失租：不再尝试发布或落失败终态")
    void abortedTransferReturningResult_doesNotPublish() {
        stubPollClaim(webmInput("portrait"), 3);
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", "1080p", 65.5, null, null));
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenAnswer(inv -> {
                    TosVideoMediaRelay.TransferAbortHandle handle = inv.getArgument(3);
                    handle.abort("lease lost before return");
                    return new TosVideoMediaRelay.StoredVideo("https://tos/out.webm",
                            "generated/9/video/a.webm", "video/webm", 1L, null);
                });
        processor.handle("100");
        verify(finalizer, never()).publishVideoMattingResult(any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(finalizer).hasPublishedAsset("100", "generated/9/video/a.webm");
        verify(mediaRelay).deleteUnpublishedObject("generated/9/video/a.webm");
    }

    @Test
    @DisplayName("任务已取消（cancelled 终态 → 续租守卫 status='processing' 未命中）→ 经心跳 abort 同路到达清理入口：不发布、不落失败、核实后删除对象（IKIN7Z 取消路径）")
    void cancelledJobReachesCleanupViaLeaseRenewalMiss() {
        stubPollClaim(webmInput("portrait"), 3);
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", "1080p", 65.5, null, null));
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenAnswer(inv -> {
                    TosVideoMediaRelay.TransferAbortHandle handle = inv.getArgument(3);
                    handle.abort("job cancelled: renewal guard miss (status left processing)");
                    return new TosVideoMediaRelay.StoredVideo("https://tos/out.webm",
                            "generated/9/video/a.webm", "video/webm", 1L, null);
                });
        processor.handle("100");
        verify(finalizer, never()).publishVideoMattingResult(any());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(finalizer).hasPublishedAsset("100", "generated/9/video/a.webm");
        verify(mediaRelay).deleteUnpublishedObject("generated/9/video/a.webm");
    }

    @Test
    @DisplayName("completed 未返回结果视频 URL → 1050 兜底（转存前判定，无 TOS 孤儿）")
    void pollCompletedWithoutUrl_fails() {
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded", null, "1080p", 65.5,
                        null, null));

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
        verify(mediaRelay, never()).persistStreaming(anyString(), anyString(), anyLong(), any());
    }

    @Test
    @DisplayName("completed 未返回分辨率档位 → 1050 兜底（契约 result.resolution 必填）")
    void pollCompletedWithoutResolution_fails() {
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", null, 65.5, null, null));

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
        verify(mediaRelay, never()).persistStreaming(anyString(), anyString(), anyLong(), any());
    }

    @Test
    @DisplayName("TOS 未配置 → 1050（结果 URL 24h 失效，强依赖不降级直存）")
    void tosMissing_failsWithoutPassthrough() {
        VideoMattingJobProcessor noRelayProcessor = new VideoMattingJobProcessor(
                stateMachine, claimService, jobMapper, finalizer, new AssetSourceService(assetMapper),
                upstreamCredential, matteVideoClient, null, producer);
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", "1080p", 65.5, null, null));

        noRelayProcessor.handle("100");

        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED),
                eq("智能抠像转存存储未配置"), any(), eq("worker-1"), eq(5L));
        verify(finalizer, never()).publishVideoMattingResult(any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubPollClaim(webmInput("portrait"), 3);
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", "1080p", 65.5, null, null));
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.webm", "generated/9/video/abc.webm",
                        "video/webm", 1L, null));
        when(finalizer.publishVideoMattingResult(any())).thenReturn(false);

        processor.handle("100");

        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(finalizer).hasPublishedAsset("100", "generated/9/video/abc.webm");
        verify(mediaRelay).deleteUnpublishedObject("generated/9/video/abc.webm");
    }

    @Test
    @DisplayName("清理调用自身抛异常（删除链路异常直达 processor 的形态）→ 保守保留 + 结构化待处理记录，不转成任务失败（IKIN7Z，IKIN8Z 同型）")
    void cleanupErrorLeavesPendingRecordWithoutFailing() {
        stubPollClaim(webmInput("portrait"), 3);
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", "1080p", 65.5, null, null));
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.webm", "generated/9/video/abc.webm",
                        "video/webm", 1L, null));
        when(finalizer.publishVideoMattingResult(any())).thenReturn(false);
        when(finalizer.hasPublishedAsset("100", "generated/9/video/abc.webm")).thenReturn(false);
        doThrow(new RuntimeException("TOS 删除 5xx")).when(mediaRelay)
                .deleteUnpublishedObject("generated/9/video/abc.webm");

        ch.qos.logback.classic.Logger logger =
                (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory
                        .getLogger(VideoMattingJobProcessor.class);
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender =
                new ch.qos.logback.core.read.ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            processor.handle("100");
        } finally {
            logger.detachAppender(appender);
        }

        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        assertThat(appender.list.stream()
                .map(ch.qos.logback.classic.spi.ILoggingEvent::getFormattedMessage)
                .filter(message -> message.contains("[pending-cleanup]")).toList())
                .anySatisfy(message -> assertThat(message)
                        .contains("jobId=100")
                        .contains("storageKey=generated/9/video/abc.webm")
                        .contains("TOS 删除 5xx")
                        .contains("resolution=retain-pending"));
    }

    @Test
    @DisplayName("转存失败（下载 404）→ 1050 整体失败，不发布（无半成品资产悬挂）")
    void relayFails_fails() {
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", "1080p", 65.5, null, null));
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenThrow(new RuntimeException("生成视频下载失败: HTTP 404"));

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
        verify(finalizer, never()).publishVideoMattingResult(any());
    }


    @Test
    @DisplayName("瞬时判定：provider_timeout / 网络不可达 / HTTP 429/5xx → 瞬时；4xx / 业务失败 → 非瞬时")
    void transientPollErrorClassification() {
        assertThat(VideoMattingJobProcessor.isTransientPollError(
                new VideoMattingError(GenerationError.ERROR_PROVIDER_TIMEOUT, "timeout")))
                .isTrue();

        VideoMattingError unreachable = new VideoMattingError(
                GenerationError.ERROR_PROVIDER_FAILED, "unreachable");
        unreachable.initCause(new java.net.ConnectException("refused"));
        assertThat(VideoMattingJobProcessor.isTransientPollError(unreachable)).isTrue();

        for (int status : new int[]{429, 500, 502, 503, 504}) {
            VideoMattingError serverError = new VideoMattingError(
                    GenerationError.ERROR_PROVIDER_FAILED, "HTTP " + status);
            serverError.initCause(new NewApiVideoClient.HttpStatusException(status));
            assertThat(VideoMattingJobProcessor.isTransientPollError(serverError))
                    .as("HTTP %d 应判定瞬时", status).isTrue();
        }

        VideoMattingError badRequest = new VideoMattingError(
                GenerationError.ERROR_PROVIDER_FAILED, "HTTP 400");
        badRequest.initCause(new NewApiVideoClient.HttpStatusException(400));
        assertThat(VideoMattingJobProcessor.isTransientPollError(badRequest)).isFalse();

        assertThat(VideoMattingJobProcessor.isTransientPollError(
                new VideoMattingError(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                        "task failed")))
                .isFalse();
    }
}
