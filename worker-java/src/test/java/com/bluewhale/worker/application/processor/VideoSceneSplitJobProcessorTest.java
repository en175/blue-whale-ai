package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedVideoSceneSplitJobDto;
import com.bluewhale.worker.domain.dto.PublishVideoSceneSplitDto;
import com.bluewhale.worker.domain.dto.UpdateVideoSceneSplitProgressDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.VideoSceneSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSceneSplitError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient.SceneSplitTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient.SegmentObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
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

/**
 * VideoSceneSplitJobProcessor 单测（IKH8BP，父规格 IKH86V）。
 * <p>
 * 覆盖：异步两段式状态机（submit 存 task_id → markProviderSubmitted + scheduleNext / poll
 * processing 续排 / 轮询超限 / completed 逐段转存发布 / failed 分类终态 + 上游原因透传）、
 * segments 一对多解析与逐段持久化（段序 / 起止秒 / 官方 duration / 源宽高近似 / 1 段不特判）、
 * **部分段转存失败 → 整体失败且不发布（无半成品资产悬挂）**、input 业务键兜底校验、凭证缺失
 * 分类、§5 信号保留与兜底归并（1046）、瞬时轮询错误判定。不连真实 MQ/DB/TOS/网关。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class VideoSceneSplitJobProcessorTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitSegmentScenesClient segmentScenesClient;
    @Mock private TosVideoMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private VideoSceneSplitJobProcessor processor;

    private static Map<String, Object> input(String granularity) {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("granularity", granularity);
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    @BeforeEach
    void setUp() {
        processor = new VideoSceneSplitJobProcessor(
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, segmentScenesClient, mediaRelay, producer);
        when(stateMachine.failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong())).thenReturn(true);
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
        when(stateMachine.reserveParentReuseSubmit(anyString(), anyString(), anyLong())).thenReturn(true);
        // 段转存心跳续租默认放行（守卫命中）；中止路径由专项用例覆写
        when(stateMachine.updateVideoSceneSplitProgress(any(UpdateVideoSceneSplitProgressDto.class)))
                .thenReturn(true);
    }

    /** 源视频素材（宽高/时长供段 Asset 近似回填）。 */
    private void stubSourceAsset() {
        AssetEntity source = new AssetEntity();
        source.setType("video");
        source.setUrl("https://example.com/src.mp4");
        source.setStorageKey("uploads/9/video/src.mp4");
        source.setWidth(1920);
        source.setHeight(1080);
        source.setDurationMs(95_000);
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(source);
    }

    private ClaimedVideoSceneSplitJobDto makeClaim(Map<String, Object> input, String providerTaskId,
                                                   int pollCount) {
        return makeClaim(input, providerTaskId, pollCount, null);
    }

    private ClaimedVideoSceneSplitJobDto makeClaim(Map<String, Object> input, String providerTaskId,
                                                   int pollCount, String parentProviderTaskId) {
        return new ClaimedVideoSceneSplitJobDto(
                "100", "42", "9", input, providerTaskId, "worker-1", 5L, pollCount, 0,
                parentProviderTaskId);
    }

    private void stubSubmitClaim(Map<String, Object> input) {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, null, 0)));
    }

    private void stubPollClaim(Map<String, Object> input, int pollCount) {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, "amk-task-1", pollCount)));
    }

    private void assertFailCode(String expectedCode) {
        verify(stateMachine).failVideoJob(eq("100"), eq(expectedCode), anyString(),
                any(), eq("worker-1"), eq(5L));
    }

    private static TosVideoMediaRelay.StoredVideo stored(int seq) {
        return new TosVideoMediaRelay.StoredVideo(
                "https://tos/seg-" + seq + ".mp4", "generated/9/video/seg-" + seq + ".mp4",
                "video/mp4", 1000L + seq, "md5-seg-" + seq);
    }

    // ========== claim 语义 ==========

    @Test
    @DisplayName("claim 抛 DB 异常 → 上抛（不 fail job，不 ack → 重投）")
    void claimThrowsDbError_propagates() {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenReturn(Optional.empty());

        processor.handle("100");

        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(stateMachine, never()).publishVideoSceneSplitResult(any());
    }

    // ========== input 业务键兜底校验（权威复核在创建入口） ==========

    @Test
    @DisplayName("缺 source_asset_id → invalid_input")
    void missingSourceAssetId_invalidInput() {
        Map<String, Object> input = input("standard");
        input.remove("source_asset_id");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("granularity 枚举外 → invalid_input")
    void invalidGranularity_invalidInput() {
        stubSubmitClaim(input("ultra"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    // ========== 源素材 / 凭证 ==========

    @Test
    @DisplayName("源素材不可用（非 video）→ 1046 兜底 + 可读原因，不提交上游")
    void sourceAssetNotVideo_sceneSplitFailed() {
        stubSubmitClaim(input("standard"));
        AssetEntity image = new AssetEntity();
        image.setType("image");
        image.setUrl("https://example.com/src.png");
        image.setStorageKey("uploads/9/image/src.png");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(image);

        processor.handle("100");

        assertFailCode(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED);
        verify(segmentScenesClient, never()).submit(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("缺冻结凭证 → provider_credential_missing")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = input("standard");
        input.remove("provider_credential");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }

    // ========== submit 相：状态机与错误归并（出站 JSON 映射在客户端测试钉） ==========

    @Test
    @DisplayName("submit：granularity 透传 → markProviderSubmitted 存 task_id + scheduleNext(5s)")
    void submitStoresTaskIdAndSchedulesNext() {
        stubSubmitClaim(input("fine"));
        stubSourceAsset();
        when(segmentScenesClient.submit("sk-frozen-token", "https://example.com/src.mp4", "fine"))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(segmentScenesClient).submit("sk-frozen-token", "https://example.com/src.mp4", "fine");
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", VideoSceneSplitJobProcessor.SCENE_SPLIT_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("markProviderSubmitted 守卫未命中（stale worker）→ 不自投下一步")
    void submitGuardMissed_noScheduleNext() {
        stubSubmitClaim(input("standard"));
        stubSourceAsset();
        when(segmentScenesClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("submit content_rejected → 保留既有码投影（§5 信号）")
    void submitContentRejected_preserved() {
        stubSubmitClaim(input("standard"));
        stubSourceAsset();
        when(segmentScenesClient.submit(anyString(), anyString(), anyString()))
                .thenThrow(new VideoSceneSplitError(GenerationError.ERROR_CONTENT_REJECTED,
                        "场景切分任务提交失败: HTTP 400 sensitive content"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("submit quota_exhausted → 保留既有码投影（§5 信号）")
    void submitQuotaExhausted_preserved() {
        stubSubmitClaim(input("standard"));
        stubSourceAsset();
        when(segmentScenesClient.submit(anyString(), anyString(), anyString()))
                .thenThrow(new VideoSceneSplitError(GenerationError.ERROR_QUOTA_EXHAUSTED,
                        "场景切分任务提交失败: HTTP 402 剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("submit provider_failed → 归并 1046 兜底（无自动重试）")
    void submitProviderFailed_normalized() {
        stubSubmitClaim(input("standard"));
        stubSourceAsset();
        when(segmentScenesClient.submit(anyString(), anyString(), anyString()))
                .thenThrow(new VideoSceneSplitError(GenerationError.ERROR_PROVIDER_FAILED,
                        "场景切分任务提交失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED);
    }

    @Test
    @DisplayName("submit 超时（provider_timeout）→ 归并 1046（宁可不重试也不双跑）")
    void submitTimeout_normalized() {
        stubSubmitClaim(input("standard"));
        stubSourceAsset();
        when(segmentScenesClient.submit(anyString(), anyString(), anyString()))
                .thenThrow(new VideoSceneSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 场景切分提交超时"));

        processor.handle("100");

        assertFailCode(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED);
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    // ========== parent-reuse 重试收割（IKI89T / ADR-0114；平移家族定型票先例）==========

    @Test
    @DisplayName("parent-reuse 命中：父任务已成功且切片数组非空 → 不提交，直接逐段转存发布（payload 与正常完成同型）")
    void parentReuseSuccess_publishesWithoutSubmit() {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("standard"), null, 0, "amk-parent-1")));
        when(segmentScenesClient.poll("sk-frozen-token", "amk-parent-1"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.5, List.of(
                        new SegmentObservation(0.0, 45.0, "https://volc/old-seg1.mp4"),
                        new SegmentObservation(45.0, 95.5, "https://volc/old-seg2.mp4")),
                        null, null));
        stubSourceAsset();
        when(mediaRelay.persist("https://volc/old-seg1.mp4", "9")).thenReturn(stored(1));
        when(mediaRelay.persist("https://volc/old-seg2.mp4", "9")).thenReturn(stored(2));
        when(stateMachine.publishVideoSceneSplitResult(any())).thenReturn(true);

        processor.handle("100");

        verify(segmentScenesClient, never()).submit(anyString(), anyString(), anyString());
        verify(mediaRelay).persist("https://volc/old-seg1.mp4", "9");
        verify(mediaRelay).persist("https://volc/old-seg2.mp4", "9");
        ArgumentCaptor<PublishVideoSceneSplitDto> captor =
                ArgumentCaptor.forClass(PublishVideoSceneSplitDto.class);
        verify(stateMachine).publishVideoSceneSplitResult(captor.capture());
        PublishVideoSceneSplitDto published = captor.getValue();
        assertThat(published.durationSec()).isEqualTo(95.5);
        assertThat(published.segments()).hasSize(2);
        PublishVideoSceneSplitDto.Segment first = published.segments().get(0);
        assertThat(first.segmentIndex()).isEqualTo(1);
        assertThat(first.startTimeSec()).isEqualTo(0.0);
        assertThat(first.endTimeSec()).isEqualTo(45.0);
        assertThat(first.url()).isEqualTo("https://tos/seg-1.mp4");
        assertThat(first.storageKey()).isEqualTo("generated/9/video/seg-1.mp4");
        assertThat(first.md5()).isEqualTo("md5-seg-1");
        assertThat(first.width()).isEqualTo(1920);
        assertThat(first.height()).isEqualTo(1080);
        PublishVideoSceneSplitDto.Segment second = published.segments().get(1);
        assertThat(second.segmentIndex()).isEqualTo(2);
        assertThat(second.endTimeSec()).isEqualTo(95.5);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 父任务 failed → 回退正常重新提交")
    void parentReuseFailed_fallThrough() {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("standard"), null, 0, "amk-parent-fail")));
        when(segmentScenesClient.poll("sk-frozen-token", "amk-parent-fail"))
                .thenReturn(new SceneSplitTaskObservation("failed", null, null,
                        "VideoParseFailed", "输入视频解析失败"));
        stubSourceAsset();
        when(segmentScenesClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(segmentScenesClient).submit("sk-frozen-token", "https://example.com/src.mp4", "standard");
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查询失败后提交前失租，停止执行")
    void parentReuseLeaseLostBeforeSubmit_stops() {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("standard"), null, 0, "amk-parent-race")));
        when(segmentScenesClient.poll("sk-frozen-token", "amk-parent-race"))
                .thenThrow(new RuntimeException("HTTP 503"));
        stubSourceAsset();
        when(stateMachine.reserveParentReuseSubmit("100", "worker-1", 5L)).thenReturn(false);

        processor.handle("100");

        verify(segmentScenesClient, never()).submit(anyString(), anyString(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查父任务异常（不存在/网络错）→ 按不存在处理，回退正常重新提交")
    void parentReusePollError_fallThrough() {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("standard"), null, 0, "amk-parent-gone")));
        when(segmentScenesClient.poll("sk-frozen-token", "amk-parent-gone"))
                .thenThrow(new VideoSceneSplitError(GenerationError.ERROR_PROVIDER_FAILED,
                        "MediaKit 场景切分任务查询失败: HTTP 404"));
        stubSourceAsset();
        when(segmentScenesClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(segmentScenesClient).submit("sk-frozen-token", "https://example.com/src.mp4", "standard");
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("非重试 job（parentProviderTaskId=null）→ 不查父任务，执行路径与现状完全一致")
    void nonRetryJob_skipsParentQuery() {
        stubSubmitClaim(input("standard"));
        stubSourceAsset();
        when(segmentScenesClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(segmentScenesClient, never()).poll(anyString(), anyString());
        verify(segmentScenesClient).submit("sk-frozen-token", "https://example.com/src.mp4", "standard");
    }

    @Test
    @DisplayName("parent-reuse 父任务成功但切片数组为空 → 回退正常重新提交")
    void parentReuseEmptySegments_fallThrough() {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("standard"), null, 0, "amk-parent-empty")));
        when(segmentScenesClient.poll("sk-frozen-token", "amk-parent-empty"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.0, List.of(),
                        null, null));
        stubSourceAsset();
        when(segmentScenesClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(segmentScenesClient).submit("sk-frozen-token", "https://example.com/src.mp4", "standard");
        verify(mediaRelay, never()).persist(anyString(), anyString());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 收割发布失败（段切片下载 404，URL 超 24h 失效）→ 回退正常重新提交，不落失败终态")
    void parentReusePublishFails_fallThrough() {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("standard"), null, 0, "amk-parent-stale")));
        when(segmentScenesClient.poll("sk-frozen-token", "amk-parent-stale"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.0, List.of(
                        new SegmentObservation(0.0, 95.0, "https://volc/old-seg1.mp4")),
                        null, null));
        when(mediaRelay.persist("https://volc/old-seg1.mp4", "9"))
                .thenThrow(new RuntimeException("段切片下载失败: HTTP 404"));
        stubSourceAsset();
        when(segmentScenesClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(segmentScenesClient).submit("sk-frozen-token", "https://example.com/src.mp4", "standard");
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 收割发布守卫未命中（publish 返回 false）→ 停止本次执行：不提交、不自投、不落失败终态（IKICD0）")
    void parentReusePublishGuardMissed_stopWithoutSubmit() {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("standard"), null, 0, "amk-parent-guard")));
        when(segmentScenesClient.poll("sk-frozen-token", "amk-parent-guard"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.0, List.of(
                        new SegmentObservation(0.0, 95.0, "https://volc/old-seg1.mp4")),
                        null, null));
        when(mediaRelay.persist("https://volc/old-seg1.mp4", "9")).thenReturn(stored(1));
        when(stateMachine.publishVideoSceneSplitResult(any())).thenReturn(false);
        stubSourceAsset();

        processor.handle("100");

        // 失租/已终态守卫未命中 = 停止终局（IKICD0）：不提交、不自投、不落失败，
        // 任务保持 processing 由新 worker 重新领取继续收割
        verify(segmentScenesClient, never()).submit(anyString(), anyString(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 收割发布期段转存续租未命中（renew false）→ 停止本次执行：不提交、不自投、不落失败终态（IKICD0）")
    void parentReuseSegmentLeaseRenewMissed_stopWithoutSubmit() {
        when(stateMachine.claimVideoSceneSplit(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("standard"), null, 0, "amk-parent-renew")));
        when(segmentScenesClient.poll("sk-frozen-token", "amk-parent-renew"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.0, List.of(
                        new SegmentObservation(0.0, 45.0, "https://volc/old-seg1.mp4"),
                        new SegmentObservation(45.0, 95.0, "https://volc/old-seg2.mp4")),
                        null, null));
        when(mediaRelay.persist("https://volc/old-seg1.mp4", "9")).thenReturn(stored(1));
        // 第 1 段续租放行、第 2 段续租守卫未命中（转存中途被接管）→ 收割发布中止
        when(stateMachine.updateVideoSceneSplitProgress(any(UpdateVideoSceneSplitProgressDto.class)))
                .thenReturn(true, false);
        stubSourceAsset();

        processor.handle("100");

        // 逐段转存中续租未命中 = 失租（IKICD0）：与守卫未命中同一停止语义，不因共享
        // 回退逻辑提交新上游任务；新 worker 领取后从头重新检查父任务并完成收割
        verify(segmentScenesClient, never()).submit(anyString(), anyString(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(mediaRelay, times(1)).persist(anyString(), anyString());
        verify(stateMachine, never()).publishVideoSceneSplitResult(any());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    // ========== poll 相：状态机 ==========

    @Test
    @DisplayName("poll processing（running）→ rescheduleProviderPoll + scheduleNext(5s)")
    void pollProcessing_reschedules() {
        stubPollClaim(input("standard"), 3);
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("processing", null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoSceneSplitJobProcessor.SCENE_SPLIT_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 超限（pollCount>=720）→ 1046 轮询超时，不再续排")
    void pollExceedsLimit_fails() {
        stubPollClaim(input("standard"), VideoSceneSplitJobProcessor.MAX_SCENE_SPLIT_POLLS);
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("processing", null, null, null, null));

        processor.handle("100");

        assertFailCode(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）→ reschedule 续排，不落终态")
    void pollTransientError_reschedules() {
        stubPollClaim(input("standard"), 3);
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoSceneSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 场景切分任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoSceneSplitJobProcessor.SCENE_SPLIT_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限（pollCount=719）→ 仍按 5s 续排（次数由 SQL +1，IKI61M）")
    void pollTransientErrorBelowLimit_reschedules() {
        stubPollClaim(input("standard"), VideoSceneSplitJobProcessor.MAX_SCENE_SPLIT_POLLS - 1);
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoSceneSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 场景切分任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoSceneSplitJobProcessor.SCENE_SPLIT_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（pollCount=720）→ 1046 轮询超时 + 不再续排（IKI61M：与 processing 共享预算）")
    void pollTransientErrorAtLimit_fails() {
        stubPollClaim(input("standard"), VideoSceneSplitJobProcessor.MAX_SCENE_SPLIT_POLLS);
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoSceneSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 场景切分任务查询超时"));

        processor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED),
                eq("场景切分轮询超时（超过 " + VideoSceneSplitJobProcessor.MAX_SCENE_SPLIT_POLLS
                        + " 次），上游持续错误: MediaKit 场景切分任务查询超时"),
                any(), eq("worker-1"), eq(5L));
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（HTTP 503 瞬时形态）→ 1046（瞬时错误各形态同受上限约束）")
    void pollTransientHttp503AtLimit_fails() {
        stubPollClaim(input("standard"), VideoSceneSplitJobProcessor.MAX_SCENE_SPLIT_POLLS);
        VideoSceneSplitError gatewayBusy = new VideoSceneSplitError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 场景切分任务查询失败: HTTP 503");
        gatewayBusy.initCause(new NewApiVideoClient.HttpStatusException(503));
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(gatewayBusy);

        processor.handle("100");

        assertFailCode(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限但 reschedule 守卫未命中（stale worker / fencing 失配）→ 不自投下一步、不落终态")
    void pollTransientErrorGuardMissed_noScheduleNext() {
        stubPollClaim(input("standard"), 3);
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoSceneSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 场景切分任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 硬错误（HTTP 404 任务不存在）→ 1046 兜底")
    void pollHardError_fails() {
        stubPollClaim(input("standard"), 3);
        VideoSceneSplitError notFound = new VideoSceneSplitError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 场景切分任务查询失败: HTTP 404");
        notFound.initCause(new NewApiVideoClient.HttpStatusException(404));
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(notFound);

        processor.handle("100");

        assertFailCode(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED);
    }

    @Test
    @DisplayName("poll failed → 1046 + 上游可读原因透传（前端投影）")
    void pollFailed_transportsUpstreamReason() {
        stubPollClaim(input("standard"), 3);
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("failed", null, null,
                        "VideoParseFailed", "输入视频解析失败，请更换素材后重试"));

        processor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED),
                eq("输入视频解析失败，请更换素材后重试"),
                any(), eq("worker-1"), eq(5L));
    }

    @Test
    @DisplayName("poll failed + 额度信号 → quota_exhausted（§5 保留）")
    void pollFailedQuotaSignal_preserved() {
        stubPollClaim(input("standard"), 3);
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("failed", null, null,
                        null, "剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    // ========== poll 相：completed → 逐段转存 + 终态发布（链接 24h 有效） ==========

    @Test
    @DisplayName("poll completed 多段 → 逐段 persist（官方顺序）→ 发布段序/起止秒/官方 duration/源宽高")
    void pollCompleted_publishesAllSegmentsInOrder() {
        stubPollClaim(input("standard"), 3);
        stubSourceAsset();
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.5, List.of(
                        new SegmentObservation(0.0, 31.2, "https://volc/seg1.mp4"),
                        new SegmentObservation(31.2, 64.8, "https://volc/seg2.mp4"),
                        new SegmentObservation(64.8, 95.5, "https://volc/seg3.mp4")),
                        null, null));
        when(mediaRelay.persist("https://volc/seg1.mp4", "9")).thenReturn(stored(1));
        when(mediaRelay.persist("https://volc/seg2.mp4", "9")).thenReturn(stored(2));
        when(mediaRelay.persist("https://volc/seg3.mp4", "9")).thenReturn(stored(3));
        when(stateMachine.publishVideoSceneSplitResult(any())).thenReturn(true);

        processor.handle("100");

        // 24h 有效链接：completed 后立即逐段转存（同步链路，无续排）
        verify(mediaRelay).persist("https://volc/seg1.mp4", "9");
        verify(mediaRelay).persist("https://volc/seg2.mp4", "9");
        verify(mediaRelay).persist("https://volc/seg3.mp4", "9");
        ArgumentCaptor<PublishVideoSceneSplitDto> captor =
                ArgumentCaptor.forClass(PublishVideoSceneSplitDto.class);
        verify(stateMachine).publishVideoSceneSplitResult(captor.capture());
        PublishVideoSceneSplitDto published = captor.getValue();
        assertThat(published.durationSec()).isEqualTo(95.5);
        assertThat(published.segments()).hasSize(3);
        PublishVideoSceneSplitDto.Segment first = published.segments().get(0);
        assertThat(first.segmentIndex()).isEqualTo(1);
        assertThat(first.startTimeSec()).isEqualTo(0.0);
        assertThat(first.endTimeSec()).isEqualTo(31.2);
        assertThat(first.url()).isEqualTo("https://tos/seg-1.mp4");
        assertThat(first.storageKey()).isEqualTo("generated/9/video/seg-1.mp4");
        assertThat(first.md5()).isEqualTo("md5-seg-1");
        assertThat(first.width()).isEqualTo(1920);
        assertThat(first.height()).isEqualTo(1080);
        PublishVideoSceneSplitDto.Segment third = published.segments().get(2);
        assertThat(third.segmentIndex()).isEqualTo(3);
        assertThat(third.endTimeSec()).isEqualTo(95.5);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("completed 仅 1 段 → 照常发布 1 段（整片 1 段不特判，规格故事 18）")
    void pollCompletedSingleSegment_publishesOne() {
        stubPollClaim(input("coarse"), 3);
        stubSourceAsset();
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.0, List.of(
                        new SegmentObservation(0.0, 95.0, "https://volc/whole.mp4")),
                        null, null));
        when(mediaRelay.persist("https://volc/whole.mp4", "9")).thenReturn(stored(1));
        when(stateMachine.publishVideoSceneSplitResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<PublishVideoSceneSplitDto> captor =
                ArgumentCaptor.forClass(PublishVideoSceneSplitDto.class);
        verify(stateMachine).publishVideoSceneSplitResult(captor.capture());
        PublishVideoSceneSplitDto published = captor.getValue();
        assertThat(published.segments()).hasSize(1);
        assertThat(published.segments().get(0).segmentIndex()).isEqualTo(1);
        assertThat(published.segments().get(0).startTimeSec()).isEqualTo(0.0);
        assertThat(published.segments().get(0).endTimeSec()).isEqualTo(95.0);
    }

    @Test
    @DisplayName("completed 无官方 duration → 回落源 duration_ms 换算秒")
    void pollCompleted_fallsBackToSourceDuration() {
        stubPollClaim(input("standard"), 3);
        stubSourceAsset();
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", null, List.of(
                        new SegmentObservation(0.0, 40.0, "https://volc/seg1.mp4")),
                        null, null));
        when(mediaRelay.persist(anyString(), eq("9"))).thenReturn(stored(1));
        when(stateMachine.publishVideoSceneSplitResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<PublishVideoSceneSplitDto> captor =
                ArgumentCaptor.forClass(PublishVideoSceneSplitDto.class);
        verify(stateMachine).publishVideoSceneSplitResult(captor.capture());
        assertThat(captor.getValue().durationSec()).isEqualTo(95.0);
    }

    @Test
    @DisplayName("completed 未返回场景段（空 segments）→ 1046 兜底")
    void pollCompletedWithoutSegments_fails() {
        stubPollClaim(input("standard"), 3);
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.0, List.of(),
                        null, null));

        processor.handle("100");

        assertFailCode(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED);
        verify(mediaRelay, never()).persist(anyString(), anyString());
    }

    @Test
    @DisplayName("部分段转存失败（第 2 段 404）→ 整体 1046 失败，不发布任何段资产")
    void secondSegmentRelayFails_wholeJobFails() {
        stubPollClaim(input("standard"), 3);
        stubSourceAsset();
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.0, List.of(
                        new SegmentObservation(0.0, 31.2, "https://volc/seg1.mp4"),
                        new SegmentObservation(31.2, 95.0, "https://volc/seg2.mp4")),
                        null, null));
        when(mediaRelay.persist("https://volc/seg1.mp4", "9")).thenReturn(stored(1));
        when(mediaRelay.persist("https://volc/seg2.mp4", "9"))
                .thenThrow(new RuntimeException("段切片下载失败: HTTP 404"));

        processor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED),
                eq("第 2 段切片下载转存失败: 段切片下载失败: HTTP 404"),
                any(), eq("worker-1"), eq(5L));
        verify(stateMachine, never()).publishVideoSceneSplitResult(any());
    }

    @Test
    @DisplayName("completed 3 段 → 每段转存前心跳续租一次，进度按已完成段占比递增（0/33/66）")
    void pollCompleted_renewsLeasePerSegment() {
        stubPollClaim(input("standard"), 3);
        stubSourceAsset();
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.5, List.of(
                        new SegmentObservation(0.0, 31.2, "https://volc/seg1.mp4"),
                        new SegmentObservation(31.2, 64.8, "https://volc/seg2.mp4"),
                        new SegmentObservation(64.8, 95.5, "https://volc/seg3.mp4")),
                        null, null));
        when(mediaRelay.persist("https://volc/seg1.mp4", "9")).thenReturn(stored(1));
        when(mediaRelay.persist("https://volc/seg2.mp4", "9")).thenReturn(stored(2));
        when(mediaRelay.persist("https://volc/seg3.mp4", "9")).thenReturn(stored(3));
        when(stateMachine.publishVideoSceneSplitResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<UpdateVideoSceneSplitProgressDto> renewCaptor =
                ArgumentCaptor.forClass(UpdateVideoSceneSplitProgressDto.class);
        verify(stateMachine, times(3)).updateVideoSceneSplitProgress(renewCaptor.capture());
        // 续租请求携带 claim 的 worker/fencing；进度 = 转存前已完成段占比（终态 100 由 publish 置）
        renewCaptor.getAllValues().forEach(dto -> {
            assertThat(dto.jobId()).isEqualTo("100");
            assertThat(dto.workerId()).isEqualTo("worker-1");
            assertThat(dto.fencingToken()).isEqualTo(5L);
        });
        assertThat(renewCaptor.getAllValues())
                .extracting(UpdateVideoSceneSplitProgressDto::progress)
                .containsExactly(0, 33, 66);
        verify(stateMachine).publishVideoSceneSplitResult(any());
    }

    @Test
    @DisplayName("段转存续租未命中（已被接管/终态）→ 中止转存，不发布不落失败（stale worker 静默退出）")
    void segmentLeaseRenewMissed_abortsTransferWithoutTerminal() {
        stubPollClaim(input("standard"), 3);
        stubSourceAsset();
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.0, List.of(
                        new SegmentObservation(0.0, 31.2, "https://volc/seg1.mp4"),
                        new SegmentObservation(31.2, 95.0, "https://volc/seg2.mp4")),
                        null, null));
        when(mediaRelay.persist("https://volc/seg1.mp4", "9")).thenReturn(stored(1));
        // 第 1 段续租放行、第 2 段续租守卫未命中
        when(stateMachine.updateVideoSceneSplitProgress(any(UpdateVideoSceneSplitProgressDto.class)))
                .thenReturn(true, false);

        processor.handle("100");

        verify(mediaRelay, times(1)).persist(anyString(), anyString());
        verify(mediaRelay, never()).persist("https://volc/seg2.mp4", "9");
        verify(stateMachine, never()).publishVideoSceneSplitResult(any());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("TOS 未配置 → 1046（切片链接 24h 失效，强依赖不降级直存）")
    void tosMissing_failsWithoutPassthrough() {
        VideoSceneSplitJobProcessor noRelayProcessor = new VideoSceneSplitJobProcessor(
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, segmentScenesClient, null, producer);
        stubPollClaim(input("standard"), 3);
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.0, List.of(
                        new SegmentObservation(0.0, 95.0, "https://volc/seg1.mp4")),
                        null, null));

        noRelayProcessor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED),
                eq("场景切分转存存储未配置"), any(), eq("worker-1"), eq(5L));
        verify(stateMachine, never()).publishVideoSceneSplitResult(any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubPollClaim(input("standard"), 3);
        stubSourceAsset();
        when(segmentScenesClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SceneSplitTaskObservation("succeeded", 95.0, List.of(
                        new SegmentObservation(0.0, 95.0, "https://volc/seg1.mp4")),
                        null, null));
        when(mediaRelay.persist(anyString(), eq("9"))).thenReturn(stored(1));
        when(stateMachine.publishVideoSceneSplitResult(any())).thenReturn(false);

        processor.handle("100");

        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    // ========== 瞬时轮询错误判定（视频骨架同语义） ==========

    @Test
    @DisplayName("瞬时判定：provider_timeout / 网络不可达 / HTTP 429/5xx → 瞬时；4xx / 业务失败 → 非瞬时")
    void transientPollErrorClassification() {
        assertThat(VideoSceneSplitJobProcessor.isTransientPollError(
                new VideoSceneSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT, "timeout")))
                .isTrue();

        VideoSceneSplitError unreachable = new VideoSceneSplitError(
                GenerationError.ERROR_PROVIDER_FAILED, "unreachable");
        unreachable.initCause(new java.net.ConnectException("refused"));
        assertThat(VideoSceneSplitJobProcessor.isTransientPollError(unreachable)).isTrue();

        for (int status : new int[]{429, 500, 502, 503, 504}) {
            VideoSceneSplitError serverError = new VideoSceneSplitError(
                    GenerationError.ERROR_PROVIDER_FAILED, "HTTP " + status);
            serverError.initCause(new NewApiVideoClient.HttpStatusException(status));
            assertThat(VideoSceneSplitJobProcessor.isTransientPollError(serverError))
                    .as("HTTP %d 应判定瞬时", status).isTrue();
        }

        VideoSceneSplitError badRequest = new VideoSceneSplitError(
                GenerationError.ERROR_PROVIDER_FAILED, "HTTP 400");
        badRequest.initCause(new NewApiVideoClient.HttpStatusException(400));
        assertThat(VideoSceneSplitJobProcessor.isTransientPollError(badRequest)).isFalse();

        assertThat(VideoSceneSplitJobProcessor.isTransientPollError(
                new VideoSceneSplitError(VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                        "task failed")))
                .isFalse();
    }
}
