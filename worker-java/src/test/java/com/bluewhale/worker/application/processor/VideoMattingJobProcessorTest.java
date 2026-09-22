package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedVideoMattingJobDto;
import com.bluewhale.worker.domain.dto.PublishVideoMattingDto;
import com.bluewhale.worker.domain.dto.UpdateVideoMattingProgressDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoMattingError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient.MatteVideoTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * VideoMattingJobProcessor 单测（IKHK99，父规格 IKHJRC，契约 IKHK7F）。
 * <p>
 * 覆盖：异步两段式状态机（submit 按模式分流提交并存 task_id → markVideoSubmitted +
 * scheduleNext / poll processing 续排 / 轮询超限 / completed 转存前心跳续租 → 立即转存
 * 发布——契约 result 三键、源宽高近似、官方 duration 优先 / failed 归 1049 + 上游原因
 * 透传）、双模式出站形状（WEBM 不带 background_color、MP4 显式带）、input 业务键兜底
 * 校验（模式/格式枚举、MP4 缺背景色、WEBM 拒背景色）、凭证缺失分类、§5 信号保留与
 * 兜底归并、瞬时轮询错误判定。不连真实 MQ/DB/TOS/网关。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class VideoMattingJobProcessorTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitMatteVideoClient matteVideoClient;
    @Mock private TosVideoMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private VideoMattingJobProcessor processor;

    /** WEBM 透明形态（默认）：无 background_color 键。 */
    private static Map<String, Object> webmInput(String mode) {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("mode", mode);
        input.put("format", "WEBM");
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    /** MP4 纯色形态：带 background_color（创建侧补缺省 white 后冻结）。 */
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
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, matteVideoClient, mediaRelay, producer);
        when(stateMachine.failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong())).thenReturn(true);
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
        // 结果转存心跳续租默认放行（守卫命中）；中止路径由专项用例覆写
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenReturn(true);
    }

    /** 源视频素材（横屏 1920x1080 / 65s：宽高供结果近似、时长供回落）。 */
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

    private ClaimedVideoMattingJobDto makeClaim(Map<String, Object> input, String providerTaskId,
                                                int pollCount) {
        return new ClaimedVideoMattingJobDto(
                "100", "42", "9", input, providerTaskId, "worker-1", 5L, pollCount, 0);
    }

    private void stubSubmitClaim(Map<String, Object> input) {
        when(stateMachine.claimVideoMatting(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, null, 0)));
    }

    private void stubPollClaim(Map<String, Object> input, int pollCount) {
        when(stateMachine.claimVideoMatting(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, "amk-task-1", pollCount)));
    }

    private void assertFailCode(String expectedCode) {
        verify(stateMachine).failVideoJob(eq("100"), eq(expectedCode), anyString(),
                any(), eq("worker-1"), eq(5L));
    }

    // ========== claim 语义 ==========

    @Test
    @DisplayName("claim 抛 DB 异常 → 上抛（不 fail job，不 ack → 重投）")
    void claimThrowsDbError_propagates() {
        when(stateMachine.claimVideoMatting(eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(stateMachine.claimVideoMatting(eq("100"), anyString()))
                .thenReturn(Optional.empty());

        processor.handle("100");

        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(stateMachine, never()).publishVideoMattingResult(any());
    }

    // ========== input 业务键兜底校验（权威复核在创建入口 IKHK98） ==========

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

    // ========== 源素材 / 凭证 ==========

    @Test
    @DisplayName("源素材不可用（非 video）→ 1049 兜底 + 可读原因，不提交上游")
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
    @DisplayName("缺冻结凭证 → provider_credential_missing")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = webmInput("portrait");
        input.remove("provider_credential");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }

    // ========== submit 相：双模式分流 + 状态机（端点/模型名/出站 JSON 映射在客户端测试钉） ==========

    @Test
    @DisplayName("submit WEBM/portrait：client 收 null 背景色（出站不带）→ markVideoSubmitted + scheduleNext(5s)")
    void submitWebmPortrait_transportsNullBackgroundColor() {
        stubSubmitClaim(webmInput("portrait"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit("sk-frozen-token", "https://example.com/src.mp4",
                "portrait", "WEBM", null))
                .thenReturn("amk-task-1");
        when(stateMachine.markVideoSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(matteVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                "portrait", "WEBM", null);
        verify(stateMachine).markVideoSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", VideoMattingJobProcessor.VIDEO_MATTING_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
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
        when(stateMachine.markVideoSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(true);

        processor.handle("100");

        verify(matteVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                "greenscreen", "MP4", "white");
        verify(stateMachine).markVideoSubmitted("100", "worker-1", 5L, "amk-task-2");
        verify(producer).enqueue("100", VideoMattingJobProcessor.VIDEO_MATTING_POLL_INTERVAL_MS);
    }

    @Test
    @DisplayName("markVideoSubmitted 守卫未命中（stale worker）→ 不自投下一步")
    void submitGuardMissed_noScheduleNext() {
        stubSubmitClaim(webmInput("portrait"));
        stubSourceAsset(1920, 1080);
        when(matteVideoClient.submit(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn("amk-task-1");
        when(stateMachine.markVideoSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    // ========== submit 相：错误归并（§5 信号保留，其余归 1049；无自动重试） ==========

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
    @DisplayName("submit provider_failed → 归并 1049 兜底（无自动重试）")
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
    @DisplayName("submit 超时（provider_timeout）→ 归并 1049（宁可不重试也不双跑，家族口径）")
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

    // ========== poll 相：状态机 ==========

    @Test
    @DisplayName("poll processing → rescheduleVideoPoll + scheduleNext(5s)")
    void pollProcessing_reschedules() {
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("processing", null, null, null,
                        null, null));
        when(stateMachine.rescheduleVideoPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleVideoPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoMattingJobProcessor.VIDEO_MATTING_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 超限（pollCount>=720）→ 1049 轮询超时，不再续排")
    void pollExceedsLimit_fails() {
        stubPollClaim(webmInput("portrait"), VideoMattingJobProcessor.MAX_VIDEO_MATTING_POLLS);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("processing", null, null, null,
                        null, null));

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
        verify(stateMachine, never()).rescheduleVideoPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）→ reschedule 续排，不落终态")
    void pollTransientError_reschedules() {
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoMattingError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 智能抠像任务查询超时"));
        when(stateMachine.rescheduleVideoPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleVideoPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoMattingJobProcessor.VIDEO_MATTING_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）+ 第 720 次 → 1049 轮询超时，不再续排（审查修复 P1）")
    void pollTransientErrorAtLimit_fails() {
        stubPollClaim(webmInput("portrait"), VideoMattingJobProcessor.MAX_VIDEO_MATTING_POLLS);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoMattingError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 智能抠像任务查询超时"));

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（HTTP 429）+ 第 720 次 → 1049 轮询超时，不再续排（审查修复 P1）")
    void pollTransientServerErrorAtLimit_fails() {
        stubPollClaim(webmInput("portrait"), VideoMattingJobProcessor.MAX_VIDEO_MATTING_POLLS);
        VideoMattingError rateLimited = new VideoMattingError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 智能抠像任务查询失败: HTTP 429");
        rateLimited.initCause(new NewApiVideoClient.HttpStatusException(429));
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(rateLimited);

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
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
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 硬错误（HTTP 404 任务不存在）→ 1049 兜底")
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
    @DisplayName("poll failed → 1049 + 上游可读原因透传（前端投影）")
    void pollFailed_transportsUpstreamReason() {
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("failed", null, null, null,
                        "VideoQualityTooLow", "视频画质过低无法识别人像"));

        processor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED),
                eq("视频画质过低无法识别人像"),
                any(), eq("worker-1"), eq(5L));
    }

    @Test
    @DisplayName("poll failed + 额度信号 → quota_exhausted（§5 保留）")
    void pollFailedQuotaSignal_preserved() {
        stubPollClaim(webmInput("greenscreen"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("failed", null, null, null,
                        null, "剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    // ========== poll 相：completed → 心跳续租 + 立即下载转存 + 终态发布（URL 24h 有效） ==========

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
        when(stateMachine.publishVideoMattingResult(any())).thenReturn(true);

        processor.handle("100");

        // 转存前心跳续租一次（单产物形态）：worker/fencing 沿用 claim 快照、进度不倒退
        ArgumentCaptor<UpdateVideoMattingProgressDto> renewCaptor =
                ArgumentCaptor.forClass(UpdateVideoMattingProgressDto.class);
        verify(stateMachine).updateVideoMattingProgress(renewCaptor.capture());
        assertThat(renewCaptor.getValue().jobId()).isEqualTo("100");
        assertThat(renewCaptor.getValue().workerId()).isEqualTo("worker-1");
        assertThat(renewCaptor.getValue().fencingToken()).isEqualTo(5L);
        assertThat(renewCaptor.getValue().progress()).isEqualTo(0);
        // URL 24h 有效：completed 后立即转存（同步链路，无续排）
        verify(mediaRelay).persistStreaming(eq("https://volc/out.webm?auth_key=..."), eq("9"),
                eq(VideoMattingContract.MAX_RESULT_BYTES), any());
        ArgumentCaptor<PublishVideoMattingDto> captor =
                ArgumentCaptor.forClass(PublishVideoMattingDto.class);
        verify(stateMachine).publishVideoMattingResult(captor.capture());
        PublishVideoMattingDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.webm");
        assertThat(published.storageKey()).isEqualTo("generated/9/video/abc.webm");
        assertThat(published.mime()).isEqualTo("video/webm");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        // 抠像不改变分辨率 → 宽高取源近似
        assertThat(published.width()).isEqualTo(1920);
        assertThat(published.height()).isEqualTo(1080);
        assertThat(published.durationSec()).isEqualTo(65.5);
        assertThat(published.resolution()).isEqualTo("1080p");
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
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
        when(stateMachine.publishVideoMattingResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<PublishVideoMattingDto> captor =
                ArgumentCaptor.forClass(PublishVideoMattingDto.class);
        verify(stateMachine).publishVideoMattingResult(captor.capture());
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
        verify(stateMachine, never()).publishVideoMattingResult(any());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    // ========== IKHSFD：转存全程持续续租 + 所有权丢失中止 ==========

    /** mock 长转存：睡到外部中止或时限——模拟「下载/上传进行中」的受控长传输。 */
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
        // 传输只在两个实际心跳完成后返回，不用固定休眠猜测调度次数。
        var renewals = new java.util.concurrent.CountDownLatch(3);
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenAnswer(inv -> { renewals.countDown(); return true; });
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenAnswer(inv -> {
                    assertThat(renewals.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                    return stored;
                });
        when(stateMachine.publishVideoMattingResult(any())).thenReturn(true);
        processor.leaseRenewIntervalMs = 40;

        processor.handle("100");

        // 首次续租 + 传输期心跳 ≥2 次：跨原单次续租窗口的所有权保持是本票要钉的行为
        verify(stateMachine, atLeast(3)).updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class));
        verify(stateMachine).publishVideoMattingResult(any());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
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
        // 首次续租命中（进入传输），此后未命中（recovery 已重新领取，新 fencing token 生效）
        when(stateMachine.updateVideoMattingProgress(any(UpdateVideoMattingProgressDto.class)))
                .thenReturn(true, false, false, false, false);
        TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay.StoredVideo(
                "https://tos/out.webm", "generated/9/video/abc.webm",
                "video/webm", 1L, null);
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenAnswer(inv -> simulateLongTransfer(inv, stored));
        processor.leaseRenewIntervalMs = 40;

        processor.handle("100");

        verify(stateMachine, never()).publishVideoMattingResult(any());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
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
        verify(stateMachine, never()).publishVideoMattingResult(any());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("completed 未返回结果视频 URL → 1049 兜底（转存前判定，无 TOS 孤儿）")
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
    @DisplayName("completed 未返回分辨率档位 → 1049 兜底（契约 result.resolution 必填）")
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
    @DisplayName("TOS 未配置 → 1049（结果 URL 24h 失效，强依赖不降级直存）")
    void tosMissing_failsWithoutPassthrough() {
        VideoMattingJobProcessor noRelayProcessor = new VideoMattingJobProcessor(
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, matteVideoClient, null, producer);
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", "1080p", 65.5, null, null));

        noRelayProcessor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED),
                eq("智能抠像转存存储未配置"), any(), eq("worker-1"), eq(5L));
        verify(stateMachine, never()).publishVideoMattingResult(any());
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
        when(stateMachine.publishVideoMattingResult(any())).thenReturn(false);

        processor.handle("100");

        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("转存失败（下载 404）→ 1049 整体失败，不发布（无半成品资产悬挂）")
    void relayFails_fails() {
        stubPollClaim(webmInput("portrait"), 3);
        when(matteVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new MatteVideoTaskObservation("succeeded",
                        "https://volc/out.webm", "1080p", 65.5, null, null));
        when(mediaRelay.persistStreaming(anyString(), eq("9"), anyLong(), any()))
                .thenThrow(new RuntimeException("生成视频下载失败: HTTP 404"));

        processor.handle("100");

        assertFailCode(VideoMattingContract.ERROR_VIDEO_MATTING_FAILED);
        verify(stateMachine, never()).publishVideoMattingResult(any());
    }

    // ========== 瞬时轮询错误判定（视频骨架同语义） ==========

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
