package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishVideoSubtitleEraseDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSubtitleEraseError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSubtitleEraseClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSubtitleEraseClient.SubtitleEraseTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class VideoSubtitleEraseJobProcessorTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobClaimService claimService;
    @Mock private GenerationJobMapper jobMapper;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetMapper assetMapper;
    @Mock private UpstreamCredential upstreamCredential;
    @Mock private NewApiMediaKitSubtitleEraseClient subtitleEraseClient;
    @Mock private TosVideoMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private VideoSubtitleEraseJobProcessor processor;

    private static Map<String, Object> box(double x1, double y1, double x2, double y2) {
        Map<String, Object> map = new HashMap<>();
        map.put(VideoSubtitleEraseContract.BOX_KEY_TOP_LEFT_X, x1);
        map.put(VideoSubtitleEraseContract.BOX_KEY_TOP_LEFT_Y, y1);
        map.put(VideoSubtitleEraseContract.BOX_KEY_BOTTOM_RIGHT_X, x2);
        map.put(VideoSubtitleEraseContract.BOX_KEY_BOTTOM_RIGHT_Y, y2);
        return map;
    }

    private static Map<String, Object> input(String detectMode, List<Map<String, Object>> boxes) {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("detect_mode", detectMode);
        input.put("erase_boxes", boxes);
        return input;
    }

    @BeforeEach
    void setUp() {
        processor = new VideoSubtitleEraseJobProcessor(
                stateMachine, claimService, jobMapper, finalizer, new AssetSourceService(assetMapper),
                upstreamCredential, subtitleEraseClient, mediaRelay, producer);
        when(finalizer.failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong())).thenReturn(true);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen-token");
        when(stateMachine.reserveParentReuseSubmit(anyString(), anyString(), anyLong())).thenReturn(true);
    }

    private void stubSourceAsset() {
        AssetEntity source = new AssetEntity();
        source.setType("video");
        source.setUrl("https://example.com/src.mp4");
        source.setStorageKey("uploads/9/video/src.mp4");
        source.setWidth(1920);
        source.setHeight(1080);
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
                "100", "42", "9", input, "video_subtitle_erase", providerTaskId, false, "worker-1", 5L,
                pollCount, 0, null, null, parentProviderTaskId);
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
        verify(finalizer, never()).publishVideoSubtitleEraseResult(any());
    }


    @Test
    @DisplayName("缺 source_asset_id → invalid_input")
    void missingSourceAssetId_invalidInput() {
        Map<String, Object> input = input("subtitle_smart", List.of());
        input.remove("source_asset_id");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("detect_mode 枚举外 → invalid_input")
    void invalidDetectMode_invalidInput() {
        stubSubmitClaim(input("subtitle_pro", List.of()));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("erase_boxes 非数组 → invalid_input")
    void eraseBoxesNotList_invalidInput() {
        Map<String, Object> input = input("subtitle_smart", List.of());
        input.put("erase_boxes", "not-a-list");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }


    @Test
    @DisplayName("源素材不可用（非 video）→ 1043 兜底 + 可读原因，不提交上游")
    void sourceAssetNotVideo_eraseFailed() {
        stubSubmitClaim(input("subtitle_smart", List.of()));
        AssetEntity image = new AssetEntity();
        image.setType("image");
        image.setUrl("https://example.com/src.png");
        image.setStorageKey("uploads/9/image/src.png");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(image);

        processor.handle("100");

        assertFailCode(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED);
        verify(subtitleEraseClient, never()).submit(anyString(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("上游凭证未配置 → provider_credential_missing")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = input("subtitle_smart", List.of());
        stubSubmitClaim(input);

        when(upstreamCredential.requireKey())
                .thenThrow(new IllegalStateException(
                        "上游凭证未配置：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key"));
        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }


    @Test
    @DisplayName("无框 subtitle_smart：submit 传空框列表 → markProviderSubmitted 存 task_id + scheduleNext(5s)")
    void submitNoBoxesSubtitleSmart() {
        stubSubmitClaim(input("subtitle_smart", List.of()));
        stubSourceAsset();
        when(subtitleEraseClient.submit(eq("sk-frozen-token"), eq("https://example.com/src.mp4"),
                eq("subtitle_smart"), anyList())).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(subtitleEraseClient).submit(eq("sk-frozen-token"), eq("https://example.com/src.mp4"),
                eq("subtitle_smart"), eq(List.of()));
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", VideoSubtitleEraseJobProcessor.SUBTITLE_ERASE_POLL_INTERVAL_MS);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("有框 subtitle_smart：框列表原样透传（官方 Location 键名同构）")
    void submitWithBoxesSubtitleSmart() {
        List<Map<String, Object>> boxes = List.of(box(0.1, 0.8, 0.9, 0.95));
        stubSubmitClaim(input("subtitle_smart", boxes));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<List<Map<String, Object>>> captor = ArgumentCaptor.captor();
        verify(subtitleEraseClient).submit(eq("sk-frozen-token"), eq("https://example.com/src.mp4"),
                eq("subtitle_smart"), captor.capture());
        assertThat(captor.getValue()).isEqualTo(boxes);
    }

    @Test
    @DisplayName("无框 text_full：检测模式原样透传（全画面文字，出站映射官方 Text 在客户端）")
    void submitNoBoxesTextFull() {
        stubSubmitClaim(input("text_full", List.of()));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), eq("text_full"), anyList()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(true);

        processor.handle("100");

        verify(subtitleEraseClient).submit(eq("sk-frozen-token"), eq("https://example.com/src.mp4"),
                eq("text_full"), eq(List.of()));
        verify(producer).enqueue("100", VideoSubtitleEraseJobProcessor.SUBTITLE_ERASE_POLL_INTERVAL_MS);
    }

    @Test
    @DisplayName("有框 text_full：框 + 检测模式双透传")
    void submitWithBoxesTextFull() {
        List<Map<String, Object>> boxes = List.of(box(0.0, 0.0, 1.0, 0.2), box(0.2, 0.7, 0.8, 0.9));
        stubSubmitClaim(input("text_full", boxes));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(true);

        processor.handle("100");

        verify(subtitleEraseClient).submit(eq("sk-frozen-token"), eq("https://example.com/src.mp4"),
                eq("text_full"), eq(boxes));
    }

    @Test
    @DisplayName("markProviderSubmitted 守卫未命中（stale worker）→ 不自投下一步")
    void submitGuardMissed_noScheduleNext() {
        stubSubmitClaim(input("subtitle_smart", List.of()));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
    }


    @Test
    @DisplayName("submit content_rejected → 保留既有码投影（§5 信号）")
    void submitContentRejected_preserved() {
        stubSubmitClaim(input("subtitle_smart", List.of()));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenThrow(new VideoSubtitleEraseError(GenerationError.ERROR_CONTENT_REJECTED,
                        "去字幕任务提交失败: HTTP 400 sensitive content"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("submit platform_quota_exhausted → 保留既有码投影（§5 信号）")
    void submitQuotaExhausted_preserved() {
        stubSubmitClaim(input("subtitle_smart", List.of()));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenThrow(new VideoSubtitleEraseError(GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED,
                        "去字幕任务提交失败: HTTP 402 剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("submit provider_failed → 归并 1043 兜底（无自动重试）")
    void submitProviderFailed_normalized() {
        stubSubmitClaim(input("subtitle_smart", List.of()));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenThrow(new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_FAILED,
                        "去字幕任务提交失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED);
    }

    @Test
    @DisplayName("submit 超时（provider_timeout）→ 归并 1043（宁可不重试也不双跑，同步家族口径）")
    void submitTimeout_normalized() {
        stubSubmitClaim(input("subtitle_smart", List.of()));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenThrow(new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 去字幕提交超时"));

        processor.handle("100");

        assertFailCode(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED);
        verify(producer, never()).enqueue(anyString(), anyLong());
    }


    @Test
    @DisplayName("parent-reuse 命中：父任务已成功且结果 URL 齐全 → 不提交，直接转存发布（payload 与正常完成同型）")
    void parentReuseSuccess_publishesWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("subtitle_smart", List.of()), null, 0, "amk-parent-1")));
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-parent-1"))
                .thenReturn(new SubtitleEraseTaskObservation("succeeded",
                        "https://volc/old-out.mp4?auth_key=...", 65.5, null, null));
        stubSourceAsset();
        when(mediaRelay.persist("https://volc/old-out.mp4?auth_key=...", "9"))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishVideoSubtitleEraseResult(any())).thenReturn(true);

        processor.handle("100");

        verify(subtitleEraseClient, never()).submit(anyString(), anyString(), anyString(), any());
        verify(mediaRelay).persist("https://volc/old-out.mp4?auth_key=...", "9");
        ArgumentCaptor<PublishVideoSubtitleEraseDto> captor =
                ArgumentCaptor.forClass(PublishVideoSubtitleEraseDto.class);
        verify(finalizer).publishVideoSubtitleEraseResult(captor.capture());
        PublishVideoSubtitleEraseDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.mp4");
        assertThat(published.storageKey()).isEqualTo("generated/9/video/abc.mp4");
        assertThat(published.mime()).isEqualTo("video/mp4");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(published.width()).isEqualTo(1920);
        assertThat(published.height()).isEqualTo(1080);
        assertThat(published.durationSec()).isEqualTo(65.5);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 父任务 failed → 回退正常重新提交")
    void parentReuseFailed_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("subtitle_smart", List.of()), null, 0, "amk-parent-fail")));
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-parent-fail"))
                .thenReturn(new SubtitleEraseTaskObservation("failed", null, null,
                        "VideoParseFailed", "输入视频解析失败，请更换素材后重试"));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(subtitleEraseClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("subtitle_smart"), anyList());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查询失败后提交前失租，停止执行")
    void parentReuseLeaseLostBeforeSubmit_stops() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("subtitle_smart", List.of()), null, 0, "amk-parent-race")));
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-parent-race"))
                .thenThrow(new RuntimeException("HTTP 503"));
        stubSourceAsset();
        when(stateMachine.reserveParentReuseSubmit("100", "worker-1", 5L)).thenReturn(false);

        processor.handle("100");

        verify(subtitleEraseClient, never()).submit(anyString(), anyString(), anyString(), anyList());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查父任务异常（不存在/网络错）→ 按不存在处理，回退正常重新提交")
    void parentReusePollError_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("subtitle_smart", List.of()), null, 0, "amk-parent-gone")));
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-parent-gone"))
                .thenThrow(new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_FAILED,
                        "MediaKit 去字幕任务查询失败: HTTP 404"));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(subtitleEraseClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("subtitle_smart"), anyList());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("非重试 job（parentProviderTaskId=null）→ 不查父任务，执行路径与现状完全一致")
    void nonRetryJob_skipsParentQuery() {
        stubSubmitClaim(input("subtitle_smart", List.of()));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(subtitleEraseClient, never()).poll(anyString(), anyString());
        verify(subtitleEraseClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("subtitle_smart"), anyList());
    }

    @Test
    @DisplayName("parent-reuse 父任务成功但结果 URL 为空（结果不齐全）→ 回退正常重新提交")
    void parentReuseIncompleteResult_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("subtitle_smart", List.of()), null, 0, "amk-parent-empty")));
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-parent-empty"))
                .thenReturn(new SubtitleEraseTaskObservation("succeeded", null, null, null, null));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(subtitleEraseClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("subtitle_smart"), anyList());
        verify(mediaRelay, never()).persist(anyString(), anyString());
    }

    @Test
    @DisplayName("parent-reuse 收割发布失败（转存下载 404，URL 超 24h 失效）→ 回退正常重新提交，不落失败终态")
    void parentReusePublishFails_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("subtitle_smart", List.of()), null, 0, "amk-parent-stale")));
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-parent-stale"))
                .thenReturn(new SubtitleEraseTaskObservation("succeeded",
                        "https://volc/expired-out.mp4", 65.5, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenThrow(new RuntimeException("生成视频下载失败: HTTP 404"));
        stubSourceAsset();
        when(subtitleEraseClient.submit(anyString(), anyString(), anyString(), anyList()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(subtitleEraseClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("subtitle_smart"), anyList());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 收割发布守卫未命中（publish 返回 false）→ 停止本次执行：不提交、不自投、不落失败终态（IKICD0）")
    void parentReusePublishGuardMissed_stopWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("subtitle_smart", List.of()), null, 0, "amk-parent-guard")));
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-parent-guard"))
                .thenReturn(new SubtitleEraseTaskObservation("succeeded",
                        "https://volc/old-out.mp4", 65.5, null, null));
        stubSourceAsset();
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishVideoSubtitleEraseResult(any())).thenReturn(false);

        processor.handle("100");

        verify(subtitleEraseClient, never()).submit(anyString(), anyString(), anyString(), anyList());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }


    @Test
    @DisplayName("poll processing → rescheduleProviderPoll + scheduleNext(5s)")
    void pollProcessing_reschedules() {
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SubtitleEraseTaskObservation("processing", null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoSubtitleEraseJobProcessor.SUBTITLE_ERASE_POLL_INTERVAL_MS);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 超限（pollCount>=720）→ 1043 轮询超时，不再续排")
    void pollExceedsLimit_fails() {
        stubPollClaim(input("subtitle_smart", List.of()),
                VideoSubtitleEraseJobProcessor.MAX_SUBTITLE_ERASE_POLLS);
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SubtitleEraseTaskObservation("processing", null, null, null, null));

        processor.handle("100");

        assertFailCode(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）→ reschedule 续排，不落终态")
    void pollTransientError_reschedules() {
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 去字幕任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoSubtitleEraseJobProcessor.SUBTITLE_ERASE_POLL_INTERVAL_MS);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限（pollCount=719）→ 仍按 5s 续排（次数由 SQL +1，IKI61M）")
    void pollTransientErrorBelowLimit_reschedules() {
        stubPollClaim(input("subtitle_smart", List.of()),
                VideoSubtitleEraseJobProcessor.MAX_SUBTITLE_ERASE_POLLS - 1);
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 去字幕任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoSubtitleEraseJobProcessor.SUBTITLE_ERASE_POLL_INTERVAL_MS);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（pollCount=720）→ 1043 轮询超时文案不变 + 不写 http_status（无 cause 不推断，IKIN6X）")
    void pollTransientErrorAtLimit_fails() {
        stubPollClaim(input("subtitle_smart", List.of()),
                VideoSubtitleEraseJobProcessor.MAX_SUBTITLE_ERASE_POLLS);
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 去字幕任务查询超时"));

        processor.handle("100");

        ArgumentCaptor<Map<String, Object>> detailsCaptor = ArgumentCaptor.captor();
        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED),
                eq("去字幕轮询超时（超过 " + VideoSubtitleEraseJobProcessor.MAX_SUBTITLE_ERASE_POLLS
                        + " 次），上游持续错误: MediaKit 去字幕任务查询超时"),
                detailsCaptor.capture(), eq("worker-1"), eq(5L));
        assertThat(detailsCaptor.getValue()).doesNotContainKey("http_status");
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（HTTP 503 + pollCount=720）→ 1043 + details.http_status=503，message 剥状态码字样（IKIN6X）")
    void pollTransientHttp503AtLimit_fails() {
        stubPollClaim(input("subtitle_smart", List.of()),
                VideoSubtitleEraseJobProcessor.MAX_SUBTITLE_ERASE_POLLS);
        VideoSubtitleEraseError gatewayBusy = new VideoSubtitleEraseError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 去字幕任务查询失败: HTTP 503");
        gatewayBusy.initCause(new NewApiVideoClient.HttpStatusException(503));
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(gatewayBusy);

        processor.handle("100");

        ArgumentCaptor<String> messageCaptor = ArgumentCaptor.captor();
        ArgumentCaptor<Map<String, Object>> detailsCaptor = ArgumentCaptor.captor();
        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED),
                messageCaptor.capture(), detailsCaptor.capture(), eq("worker-1"), eq(5L));
        assertThat(messageCaptor.getValue()).doesNotContain("503")
                .isEqualTo("去字幕轮询超时（超过 " + VideoSubtitleEraseJobProcessor.MAX_SUBTITLE_ERASE_POLLS
                        + " 次），上游持续错误: MediaKit 去字幕任务查询失败:");
        assertThat(detailsCaptor.getValue())
                .containsEntry("raw", messageCaptor.getValue())
                .containsEntry("http_status", 503);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限但 reschedule 守卫未命中（stale worker / fencing 失配）→ 不自投下一步、不落终态")
    void pollTransientErrorGuardMissed_noScheduleNext() {
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 去字幕任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 硬错误（HTTP 400 任务不存在）→ 1043 兜底")
    void pollHardError_fails() {
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        VideoSubtitleEraseError notFound = new VideoSubtitleEraseError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 去字幕任务查询失败: HTTP 404");
        notFound.initCause(new NewApiVideoClient.HttpStatusException(404));
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(notFound);

        processor.handle("100");

        assertFailCode(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED);
    }

    @Test
    @DisplayName("poll failed → 1043 + 上游可读原因透传（前端投影）")
    void pollFailed_transportsUpstreamReason() {
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SubtitleEraseTaskObservation("failed", null, null,
                        "VideoParseFailed", "输入视频解析失败，请更换素材后重试"));

        processor.handle("100");

        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED),
                eq("输入视频解析失败，请更换素材后重试"),
                any(), eq("worker-1"), eq(5L));
    }

    @Test
    @DisplayName("poll failed + 额度信号 → platform_quota_exhausted（§5 保留）")
    void pollFailedQuotaSignal_preserved() {
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SubtitleEraseTaskObservation("failed", null, null,
                        null, "剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED);
    }


    @Test
    @DisplayName("poll 上游 401（cause 携带状态）→ details.http_status=401，message 剥离状态码字样")
    void pollUnauthorized_persistsHttpStatusDetail() {
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        VideoSubtitleEraseError unauthorized = new VideoSubtitleEraseError(
                GenerationError.ERROR_PROVIDER_FAILED,
                "MediaKit 去字幕任务查询失败: HTTP 401"
                        + " body={\"error\":{\"message\":\"Incorrect API key\"}} request_id=req-poll-3");
        unauthorized.initCause(new NewApiVideoClient.HttpStatusException(401));
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(unauthorized);

        processor.handle("100");

        ArgumentCaptor<String> messageCaptor = ArgumentCaptor.captor();
        ArgumentCaptor<Map<String, Object>> detailsCaptor = ArgumentCaptor.captor();
        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED),
                messageCaptor.capture(), detailsCaptor.capture(), eq("worker-1"), eq(5L));
        assertThat(messageCaptor.getValue()).doesNotContain("401").contains("Incorrect API key");
        assertThat(detailsCaptor.getValue())
                .containsEntry("raw", "MediaKit 去字幕任务查询失败:"
                        + " body={\"error\":{\"message\":\"Incorrect API key\"}} request_id=req-poll-3")
                .containsEntry("http_status", 401);
    }


    @Test
    @DisplayName("poll completed → persist 转存 → 发布 payload：官方 duration 秒 + 源宽高近似 + md5 穿透")
    void pollCompleted_publishesWithOfficialDuration() {
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        stubSourceAsset();
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SubtitleEraseTaskObservation("succeeded",
                        "https://volc/out.mp4?auth_key=...", 65.5, null, null));
        when(mediaRelay.persist("https://volc/out.mp4?auth_key=...", "9"))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishVideoSubtitleEraseResult(any())).thenReturn(true);

        processor.handle("100");

        verify(mediaRelay).persist("https://volc/out.mp4?auth_key=...", "9");
        ArgumentCaptor<PublishVideoSubtitleEraseDto> captor =
                ArgumentCaptor.forClass(PublishVideoSubtitleEraseDto.class);
        verify(finalizer).publishVideoSubtitleEraseResult(captor.capture());
        PublishVideoSubtitleEraseDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.mp4");
        assertThat(published.storageKey()).isEqualTo("generated/9/video/abc.mp4");
        assertThat(published.mime()).isEqualTo("video/mp4");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(published.width()).isEqualTo(1920);
        assertThat(published.height()).isEqualTo(1080);
        assertThat(published.durationSec()).isEqualTo(65.5);
        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("completed 无官方 duration → 回落源 duration_ms 换算秒")
    void pollCompleted_fallsBackToSourceDuration() {
        stubPollClaim(input("text_full", List.of()), 3);
        stubSourceAsset();
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SubtitleEraseTaskObservation("succeeded",
                        "https://volc/out.mp4", null, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 1L, null));
        when(finalizer.publishVideoSubtitleEraseResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<PublishVideoSubtitleEraseDto> captor =
                ArgumentCaptor.forClass(PublishVideoSubtitleEraseDto.class);
        verify(finalizer).publishVideoSubtitleEraseResult(captor.capture());
        assertThat(captor.getValue().durationSec()).isEqualTo(65.0);
    }

    @Test
    @DisplayName("completed 未返回结果视频 URL → 1043 兜底")
    void pollCompletedWithoutUrl_fails() {
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SubtitleEraseTaskObservation("succeeded", null, null, null, null));

        processor.handle("100");

        assertFailCode(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED);
        verify(mediaRelay, never()).persist(anyString(), anyString());
    }

    @Test
    @DisplayName("TOS 未配置 → 1043（结果 URL 24h 失效，强依赖不降级直存）")
    void tosMissing_failsWithoutPassthrough() {
        VideoSubtitleEraseJobProcessor noRelayProcessor = new VideoSubtitleEraseJobProcessor(
                stateMachine, claimService, jobMapper, finalizer, new AssetSourceService(assetMapper),
                upstreamCredential, subtitleEraseClient, null, producer);
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SubtitleEraseTaskObservation("succeeded",
                        "https://volc/out.mp4", 65.5, null, null));

        noRelayProcessor.handle("100");

        verify(finalizer).failVideoJob(eq("100"),
                eq(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED),
                eq("去字幕转存存储未配置"), any(), eq("worker-1"), eq(5L));
        verify(finalizer, never()).publishVideoSubtitleEraseResult(any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        stubSourceAsset();
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SubtitleEraseTaskObservation("succeeded",
                        "https://volc/out.mp4", 65.5, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 1L, null));
        when(finalizer.publishVideoSubtitleEraseResult(any())).thenReturn(false);

        processor.handle("100");

        verify(finalizer, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("转存失败（下载 404）→ 1043 兜底，不发布")
    void relayFails_fails() {
        stubPollClaim(input("subtitle_smart", List.of()), 3);
        when(subtitleEraseClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SubtitleEraseTaskObservation("succeeded",
                        "https://volc/out.mp4", 65.5, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenThrow(new RuntimeException("生成视频下载失败: HTTP 404"));

        processor.handle("100");

        assertFailCode(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED);
        verify(finalizer, never()).publishVideoSubtitleEraseResult(any());
    }


    @Test
    @DisplayName("瞬时判定：provider_timeout / 网络不可达 / HTTP 429/5xx → 瞬时；4xx / 业务失败 → 非瞬时")
    void transientPollErrorClassification() {
        assertThat(VideoSubtitleEraseJobProcessor.isTransientPollError(
                new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_TIMEOUT, "timeout")))
                .isTrue();

        VideoSubtitleEraseError unreachable = new VideoSubtitleEraseError(
                GenerationError.ERROR_PROVIDER_FAILED, "unreachable");
        unreachable.initCause(new java.net.ConnectException("refused"));
        assertThat(VideoSubtitleEraseJobProcessor.isTransientPollError(unreachable)).isTrue();

        for (int status : new int[]{429, 500, 502, 503, 504}) {
            VideoSubtitleEraseError serverError = new VideoSubtitleEraseError(
                    GenerationError.ERROR_PROVIDER_FAILED, "HTTP " + status);
            serverError.initCause(new NewApiVideoClient.HttpStatusException(status));
            assertThat(VideoSubtitleEraseJobProcessor.isTransientPollError(serverError))
                    .as("HTTP %d 应判定瞬时", status).isTrue();
        }

        VideoSubtitleEraseError badRequest = new VideoSubtitleEraseError(
                GenerationError.ERROR_PROVIDER_FAILED, "HTTP 400");
        badRequest.initCause(new NewApiVideoClient.HttpStatusException(400));
        assertThat(VideoSubtitleEraseJobProcessor.isTransientPollError(badRequest)).isFalse();

        assertThat(VideoSubtitleEraseJobProcessor.isTransientPollError(
                new VideoSubtitleEraseError(VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
                        "task failed")))
                .isFalse();
    }
}
