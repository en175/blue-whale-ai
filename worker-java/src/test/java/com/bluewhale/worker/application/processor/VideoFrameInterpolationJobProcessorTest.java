package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract;
import com.bluewhale.worker.domain.dto.ClaimedVideoFrameInterpolationJobDto;
import com.bluewhale.worker.domain.dto.PublishVideoFrameInterpolationDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoFrameInterpolationError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitInterpolateVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitInterpolateVideoClient.InterpolateVideoTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
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
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * VideoFrameInterpolationJobProcessor 单测（IKHLKJ，父需求 IKHLES）。
 * <p>
 * 覆盖：异步两段式状态机（submit 存 task_id → markProviderSubmitted + scheduleNext / poll
 * processing 续排 / 轮询超限 720≈60 分钟 / completed 立即转存发布——官方 duration、源宽高近似、
 * resolution/fps 随发布 payload / failed 归 1049 + 上游原因透传）、input 业务键兜底校验
 * （含整型 fps 三档）、凭证缺失与 **per-job 凭证隔离**、§5 信号保留与兜底归并、瞬时轮询错误
 * 判定、取消落确定终态（未提交 / 已提交两条 CAS）、迟到结果发布守卫未命中即不落资产。
 * 不连真实 MQ/DB/TOS/网关。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class VideoFrameInterpolationJobProcessorTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitInterpolateVideoClient interpolateVideoClient;
    @Mock private TosVideoMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private VideoFrameInterpolationJobProcessor processor;

    private static Map<String, Object> input(Object fps) {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("fps", fps);
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    @BeforeEach
    void setUp() {
        processor = new VideoFrameInterpolationJobProcessor(
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, interpolateVideoClient, mediaRelay, producer);
        when(stateMachine.failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong())).thenReturn(true);
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
        when(stateMachine.reserveParentReuseSubmit(anyString(), anyString(), anyLong())).thenReturn(true);
    }

    /** 源视频素材（横屏 1920x1080 / 65s：宽高作输出近似值、时长供回落）。 */
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

    private ClaimedVideoFrameInterpolationJobDto makeClaim(Map<String, Object> input, String providerTaskId,
                                                           int pollCount) {
        return makeClaim(input, providerTaskId, pollCount, null);
    }

    private ClaimedVideoFrameInterpolationJobDto makeClaim(Map<String, Object> input, String providerTaskId,
                                                           int pollCount, String parentProviderTaskId) {
        return new ClaimedVideoFrameInterpolationJobDto(
                "100", "42", "9", input, providerTaskId, false, "worker-1", 5L, pollCount, 0,
                parentProviderTaskId);
    }

    private ClaimedVideoFrameInterpolationJobDto makeCancelRequestedClaim(Map<String, Object> input,
                                                                         String providerTaskId) {
        return new ClaimedVideoFrameInterpolationJobDto(
                "100", "42", "9", input, providerTaskId, true, "worker-1", 5L, 0, 0, null);
    }

    private void stubSubmitClaim(Map<String, Object> input) {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, null, 0)));
    }

    private void stubPollClaim(Map<String, Object> input, int pollCount) {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
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
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒 / 已终态）")
    void claimReturnsEmpty_silentReturn() {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.empty());

        processor.handle("100");

        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(stateMachine, never()).publishVideoFrameInterpolationResult(any());
    }

    // ========== 取消（生成中可取消：软取消 → 确定终态；迟到结果不得复活） ==========

    @Test
    @DisplayName("cancelRequested + 未提交上游 → cancelVideoFrameInterpolation(providerTaskId=null)，不提交不轮询")
    void cancelBeforeDispatch_cancelsWithoutSubmit() {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.of(makeCancelRequestedClaim(input(60), null)));

        processor.handle("100");

        verify(stateMachine).cancelVideoFrameInterpolation("100", "worker-1", 5L, null);
        verify(interpolateVideoClient, never()).submit(anyString(), anyString(), anyInt());
        verify(interpolateVideoClient, never()).poll(anyString(), anyString());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("cancelRequested + 已提交上游 → cancelVideoFrameInterpolation(带 providerTaskId)，迟到结果不发布")
    void cancelAfterDispatch_cancelsAndIgnoresLateResult() {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.of(makeCancelRequestedClaim(input(60), "amk-task-1")));

        processor.handle("100");

        // 上游任务不可撤（官方无取消端点）→ 本仓侧停止接纳结果：不轮询、不转存、不发布
        verify(stateMachine).cancelVideoFrameInterpolation("100", "worker-1", 5L, "amk-task-1");
        verify(interpolateVideoClient, never()).poll(anyString(), anyString());
        verify(mediaRelay, never()).persist(anyString(), anyString());
        verify(stateMachine, never()).publishVideoFrameInterpolationResult(any());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("取消先于结果落地时发布守卫未命中 → 不落资产、不改终态（fencing/终态权威）")
    void publishGuardMissedOnCancelRace_noAssetNoRevival() {
        stubPollClaim(input(60), 3);
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("succeeded",
                        "https://volc/out.mp4", 65.5, "1080p", 60.0, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 1L, null));
        // 守卫未命中 = 任务已被取消（status='cancelled'，非 processing）或 fencing 失效
        when(stateMachine.publishVideoFrameInterpolationResult(any())).thenReturn(false);

        processor.handle("100");

        verify(stateMachine).publishVideoFrameInterpolationResult(any());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    // ========== input 业务键兜底校验（权威复核在创建入口 IKHLK3） ==========

    @Test
    @DisplayName("缺 source_asset_id → invalid_input")
    void missingSourceAssetId_invalidInput() {
        Map<String, Object> input = input(60);
        input.remove("source_asset_id");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
        verify(interpolateVideoClient, never()).submit(anyString(), anyString(), anyInt());
    }

    @Test
    @DisplayName("fps 枚举外 / 字符串 / 小数 / 缺失 → invalid_input（整型直传口径）")
    void invalidFps_invalidInput() {
        for (Object fps : new Object[]{45, 12, "60", 60.5, null}) {
            stubSubmitClaim(input(fps));

            processor.handle("100");

            verify(stateMachine).failVideoJob(eq("100"), eq(GenerationError.ERROR_INVALID_INPUT),
                    anyString(), any(), eq("worker-1"), eq(5L));
            clearInvocations(stateMachine);
        }
        verify(interpolateVideoClient, never()).submit(anyString(), anyString(), anyInt());
    }

    // ========== 源素材 / 凭证 ==========

    @Test
    @DisplayName("源素材不可用（非 video）→ 1049 兜底 + 可读原因，不提交上游")
    void sourceAssetNotVideo_interpolationFailed() {
        stubSubmitClaim(input(60));
        AssetEntity image = new AssetEntity();
        image.setType("image");
        image.setUrl("https://example.com/src.png");
        image.setStorageKey("uploads/9/image/src.png");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(image);

        processor.handle("100");

        assertFailCode(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED);
        verify(interpolateVideoClient, never()).submit(anyString(), anyString(), anyInt());
    }

    @Test
    @DisplayName("缺冻结凭证 → provider_credential_missing")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = input(60);
        input.remove("provider_credential");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }

    // ========== submit 相：参数 + 状态机（出站 JSON 映射在客户端测试钉） ==========

    @Test
    @DisplayName("submit：整型 fps 透传 → markProviderSubmitted 存 task_id + scheduleNext(5s)")
    void submitTransportsFpsAndSchedulesNext() {
        stubSubmitClaim(input(120));
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.submit("sk-frozen-token", "https://example.com/src.mp4", 120))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(interpolateVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4", 120);
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", VideoFrameInterpolationJobProcessor.VIDEO_FRAME_INTERPOLATION_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("凭证隔离：两个 job 各自用自己冻结的 sk- 调网关（不串号）")
    void credentialsAreIsolatedPerJob() {
        // job 100：冻结 sk-frozen-token
        stubSubmitClaim(input(60));
        stubSourceAsset(1920, 1080);
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
        when(interpolateVideoClient.submit("sk-frozen-token", "https://example.com/src.mp4", 60))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);
        processor.handle("100");

        // job 200：另一份冻结凭证
        Map<String, Object> input2 = input(30);
        input2.put("provider_credential", "sk-other-token");
        when(credentialService.open("sk-other-token")).thenReturn("sk-other-token");
        when(stateMachine.claimVideoFrameInterpolation(eq("200"), anyString()))
                .thenReturn(Optional.of(new ClaimedVideoFrameInterpolationJobDto(
                        "200", "42", "9", input2, "amk-task-2", false, "worker-1", 6L, 2, 0, null)));
        when(interpolateVideoClient.poll("sk-other-token", "amk-task-2"))
                .thenReturn(new InterpolateVideoTaskObservation("processing", null, null, null, null,
                        null, null));
        when(stateMachine.rescheduleProviderPoll(eq("200"), eq("worker-1"), eq(6L), anyInt()))
                .thenReturn(true);
        processor.handle("200");

        verify(interpolateVideoClient, never()).poll(eq("sk-frozen-token"), anyString());
        verify(interpolateVideoClient).poll("sk-other-token", "amk-task-2");
    }

    @Test
    @DisplayName("markProviderSubmitted 守卫未命中（stale worker）→ 不自投下一步")
    void submitGuardMissed_noScheduleNext() {
        stubSubmitClaim(input(60));
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.submit(anyString(), anyString(), anyInt()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    // ========== submit 相：错误归并（§5 信号保留，其余归 1049；无自动重试） ==========

    @Test
    @DisplayName("submit content_rejected → 保留既有码投影（§5 信号）")
    void submitContentRejected_preserved() {
        stubSubmitClaim(input(60));
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.submit(anyString(), anyString(), anyInt()))
                .thenThrow(new VideoFrameInterpolationError(GenerationError.ERROR_CONTENT_REJECTED,
                        "视频插帧任务提交失败: HTTP 400 sensitive content"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("submit provider_failed → 归并 1049 兜底（无自动重试）")
    void submitProviderFailed_normalized() {
        stubSubmitClaim(input(60));
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.submit(anyString(), anyString(), anyInt()))
                .thenThrow(new VideoFrameInterpolationError(GenerationError.ERROR_PROVIDER_FAILED,
                        "视频插帧任务提交失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED);
    }

    @Test
    @DisplayName("submit 超时（provider_timeout）→ 归并 1049（宁可不重试也不双跑，家族口径）")
    void submitTimeout_normalized() {
        stubSubmitClaim(input(60));
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.submit(anyString(), anyString(), anyInt()))
                .thenThrow(new VideoFrameInterpolationError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 视频插帧提交超时"));

        processor.handle("100");

        assertFailCode(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED);
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    // ========== parent-reuse 重试收割（IKI8A0 / ADR-0114；平移定型票 IKI89P 用例）==========

    @Test
    @DisplayName("parent-reuse 命中：父任务已成功且结果 URL 齐全 → 不提交，直接转存发布（payload 与正常完成同型）")
    void parentReuseSuccess_publishesWithoutSubmit() {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(60), null, 0, "amk-parent-1")));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-parent-1"))
                .thenReturn(new InterpolateVideoTaskObservation("succeeded",
                        "https://volc/old-out.mp4?auth_key=...", 65.5, "1080p", 60.0, null, null));
        stubSourceAsset(1920, 1080);
        when(mediaRelay.persist("https://volc/old-out.mp4?auth_key=...", "9"))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishVideoFrameInterpolationResult(any())).thenReturn(true);

        processor.handle("100");

        verify(interpolateVideoClient, never()).submit(anyString(), anyString(), anyInt());
        verify(mediaRelay).persist("https://volc/old-out.mp4?auth_key=...", "9");
        ArgumentCaptor<PublishVideoFrameInterpolationDto> captor =
                ArgumentCaptor.forClass(PublishVideoFrameInterpolationDto.class);
        verify(stateMachine).publishVideoFrameInterpolationResult(captor.capture());
        PublishVideoFrameInterpolationDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.mp4");
        assertThat(published.storageKey()).isEqualTo("generated/9/video/abc.mp4");
        assertThat(published.mime()).isEqualTo("video/mp4");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        // 插帧不改变分辨率 → 宽高 = 源近似（1920x1080），不做档位推导，与正常完成路径同型
        assertThat(published.width()).isEqualTo(1920);
        assertThat(published.height()).isEqualTo(1080);
        assertThat(published.durationSec()).isEqualTo(65.5);
        assertThat(published.resolution()).isEqualTo("1080p");
        assertThat(published.fps()).isEqualTo(60.0);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        // 收割即终态：不自投下一步
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 父任务 failed → 回退正常重新提交")
    void parentReuseFailed_fallThrough() {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(60), null, 0, "amk-parent-fail")));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-parent-fail"))
                .thenReturn(new InterpolateVideoTaskObservation("failed", null, null, null, null,
                        "InvalidParameter", "The 'fps' parameter is out of range [15, 120]"));
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.submit(anyString(), anyString(), anyInt())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(interpolateVideoClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq(60));
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查询失败后提交前失租，停止执行")
    void parentReuseLeaseLostBeforeSubmit_stops() {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(60), null, 0, "amk-parent-race")));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-parent-race"))
                .thenThrow(new RuntimeException("HTTP 503"));
        stubSourceAsset(1920, 1080);
        when(stateMachine.reserveParentReuseSubmit("100", "worker-1", 5L)).thenReturn(false);

        processor.handle("100");

        verify(interpolateVideoClient, never()).submit(anyString(), anyString(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查父任务异常（不存在/网络错）→ 按不存在处理，回退正常重新提交")
    void parentReusePollError_fallThrough() {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(60), null, 0, "amk-parent-gone")));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-parent-gone"))
                .thenThrow(new VideoFrameInterpolationError(GenerationError.ERROR_PROVIDER_FAILED,
                        "MediaKit 视频插帧任务查询失败: HTTP 404"));
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.submit(anyString(), anyString(), anyInt())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(interpolateVideoClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq(60));
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("非重试 job（parentProviderTaskId=null）→ 不查父任务，执行路径与现状完全一致")
    void nonRetryJob_skipsParentQuery() {
        stubSubmitClaim(input(60));
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.submit(anyString(), anyString(), anyInt())).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(interpolateVideoClient, never()).poll(anyString(), anyString());
        verify(interpolateVideoClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq(60));
    }

    @Test
    @DisplayName("parent-reuse 父任务成功但结果 URL 为空（结果不齐全）→ 回退正常重新提交")
    void parentReuseIncompleteResult_fallThrough() {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(60), null, 0, "amk-parent-empty")));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-parent-empty"))
                .thenReturn(new InterpolateVideoTaskObservation("succeeded", null, null, null, null,
                        null, null));
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.submit(anyString(), anyString(), anyInt())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(interpolateVideoClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq(60));
        verify(mediaRelay, never()).persist(anyString(), anyString());
    }

    @Test
    @DisplayName("parent-reuse 收割发布失败（转存下载 404，URL 超 24h 失效）→ 回退正常重新提交，不落失败终态")
    void parentReusePublishFails_fallThrough() {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(60), null, 0, "amk-parent-stale")));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-parent-stale"))
                .thenReturn(new InterpolateVideoTaskObservation("succeeded",
                        "https://volc/expired-out.mp4", 65.5, "1080p", 60.0, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenThrow(new RuntimeException("生成视频下载失败: HTTP 404"));
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.submit(anyString(), anyString(), anyInt())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(interpolateVideoClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq(60));
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 收割发布守卫未命中（publish 返回 false）→ 停止本次执行：不提交、不自投、不落失败终态（IKICD0）")
    void parentReusePublishGuardMissed_stopWithoutSubmit() {
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(60), null, 0, "amk-parent-guard")));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-parent-guard"))
                .thenReturn(new InterpolateVideoTaskObservation("succeeded",
                        "https://volc/old-out.mp4", 65.5, "1080p", 60.0, null, null));
        stubSourceAsset(1920, 1080);
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishVideoFrameInterpolationResult(any())).thenReturn(false);

        processor.handle("100");

        // 失租/已终态守卫未命中 = 停止终局（IKICD0）：不提交、不自投、不落失败，
        // 任务保持 processing 由新 worker 重新领取继续收割
        verify(interpolateVideoClient, never()).submit(anyString(), anyString(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    // ========== poll 相：状态机 ==========

    @Test
    @DisplayName("poll processing → rescheduleProviderPoll + scheduleNext(5s)（每步释放租约 + 自投驱动下一步）")
    void pollProcessing_reschedules() {
        stubPollClaim(input(60), 3);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("processing", null, null, null, null,
                        null, null));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoFrameInterpolationJobProcessor.VIDEO_FRAME_INTERPOLATION_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 超限（pollCount>=720 ≈60 分钟）→ 1049 轮询超时，不再续排")
    void pollExceedsLimit_fails() {
        stubPollClaim(input(60), VideoFrameInterpolationJobProcessor.MAX_VIDEO_FRAME_INTERPOLATION_POLLS);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("processing", null, null, null, null,
                        null, null));

        processor.handle("100");

        assertFailCode(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）→ reschedule 续排，不落终态")
    void pollTransientError_reschedules() {
        stubPollClaim(input(60), 3);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoFrameInterpolationError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 视频插帧任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoFrameInterpolationJobProcessor.VIDEO_FRAME_INTERPOLATION_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    // ========== IKHSFI：瞬时错误续排与 processing 续排共用轮询预算（超限即终态） ==========

    @Test
    @DisplayName("poll 瞬时错误达上限（timeout + pollCount=720）→ 1049 终态，不续排不重提交（IKHSFI）")
    void pollTransientTimeoutAtLimit_timesOut() {
        stubPollClaim(input(60), VideoFrameInterpolationJobProcessor.MAX_VIDEO_FRAME_INTERPOLATION_POLLS);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoFrameInterpolationError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 视频插帧任务查询超时"));

        processor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED),
                contains("持续瞬时错误"), any(), eq("worker-1"), eq(5L));
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
        // 不新增自动重新提交供应商任务的行为：超限只落终态，用户手动重试才走新 job
        verify(interpolateVideoClient, never()).submit(anyString(), anyString(), anyInt());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（HTTP 503 + pollCount=720）→ 1049 终态，不续排（IKHSFI）")
    void pollTransient503AtLimit_timesOut() {
        stubPollClaim(input(60), VideoFrameInterpolationJobProcessor.MAX_VIDEO_FRAME_INTERPOLATION_POLLS);
        VideoFrameInterpolationError unavailable = new VideoFrameInterpolationError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 视频插帧任务查询失败: HTTP 503");
        unavailable.initCause(new NewApiVideoClient.HttpStatusException(503));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(unavailable);

        processor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED),
                contains("503"), any(), eq("worker-1"), eq(5L));
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（HTTP 429 + pollCount=720）→ 1049 终态，不续排（IKHSFI）")
    void pollTransient429AtLimit_timesOut() {
        stubPollClaim(input(60), VideoFrameInterpolationJobProcessor.MAX_VIDEO_FRAME_INTERPOLATION_POLLS);
        VideoFrameInterpolationError rateLimited = new VideoFrameInterpolationError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 视频插帧任务查询失败: HTTP 429");
        rateLimited.initCause(new NewApiVideoClient.HttpStatusException(429));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(rateLimited);

        processor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED),
                contains("429"), any(), eq("worker-1"), eq(5L));
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（连接错误 ConnectException + pollCount=720）→ 1049 终态，不续排（IKHSFI）")
    void pollTransientConnectErrorAtLimit_timesOut() {
        stubPollClaim(input(60), VideoFrameInterpolationJobProcessor.MAX_VIDEO_FRAME_INTERPOLATION_POLLS);
        VideoFrameInterpolationError connectError = new VideoFrameInterpolationError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 视频插帧任务查询失败: 连接被拒");
        connectError.initCause(new java.net.ConnectException("Connection refused"));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(connectError);

        processor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED),
                contains("连接被拒"), any(), eq("worker-1"), eq(5L));
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
        // 超限只落终态，不自动重新提交供应商任务（用户手动重试才走新 job）
        verify(interpolateVideoClient, never()).submit(anyString(), anyString(), anyInt());
    }

    @Test
    @DisplayName("poll 瞬时错误上限前一次（pollCount=719）→ 仍续排，不落终态（计数边界：共 720 次续排）")
    void pollTransientErrorJustBelowLimit_reschedules() {
        stubPollClaim(input(60), VideoFrameInterpolationJobProcessor.MAX_VIDEO_FRAME_INTERPOLATION_POLLS - 1);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoFrameInterpolationError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 视频插帧任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoFrameInterpolationJobProcessor.VIDEO_FRAME_INTERPOLATION_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误续排守卫未命中（stale worker / 已取消已终态）→ 不自投下一步（fencing/终态权威）")
    void pollTransientErrorGuardMissed_noScheduleNext() {
        stubPollClaim(input(60), 3);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoFrameInterpolationError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 视频插帧任务查询超时"));
        // reschedule CAS 要求 status='processing' + 当前 lease_owner + fencing_token：
        // 已取消 / 已终态 / 旧 worker 一律不命中 → 不派发下一次轮询
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("超限落 failed 终态后：重复唤醒 claim 不命中 → 静默返回，不复活不续排（IKHSFI）")
    void pollBudgetExhaustedTerminalRewake_noRevival() {
        // 第一步：瞬时错误超限 → failVideoJob 写终态 failed（清 next_poll_at，不自投消息）
        stubPollClaim(input(60), VideoFrameInterpolationJobProcessor.MAX_VIDEO_FRAME_INTERPOLATION_POLLS);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoFrameInterpolationError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 视频插帧任务查询超时"));
        processor.handle("100");
        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED),
                anyString(), any(), eq("worker-1"), eq(5L));

        // 第二步：终态后的重复唤醒（MQ 迟到重投，或 recovery 扫描兜底重投同一条消息）。
        // claim 候选查询（findCandidateByTypeAndSources）只认 queued / processing(+空或过期
        // 租约) 且 next_action_at 到期——failed 终态一律不命中 → claim 返回空 → 处理器静默
        // 返回，不产生任何状态机写或自投（claimReturnsEmpty_silentReturn 同款语义，
        // 锚定超限终态场景：claim 与 recovery 两条唤醒路径都不复活已终态任务）。
        clearInvocations(stateMachine, interpolateVideoClient, producer);
        when(stateMachine.claimVideoFrameInterpolation(eq("100"), anyString()))
                .thenReturn(Optional.empty());
        processor.handle("100");

        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(stateMachine, never()).publishVideoFrameInterpolationResult(any());
        verify(interpolateVideoClient, never()).poll(anyString(), anyString());
        verify(interpolateVideoClient, never()).submit(anyString(), anyString(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 硬错误（HTTP 404 任务不存在）→ 1049 兜底")
    void pollHardError_fails() {
        stubPollClaim(input(60), 3);
        VideoFrameInterpolationError notFound = new VideoFrameInterpolationError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 视频插帧任务查询失败: HTTP 404");
        notFound.initCause(new NewApiVideoClient.HttpStatusException(404));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(notFound);

        processor.handle("100");

        assertFailCode(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED);
    }

    @Test
    @DisplayName("poll failed（官方门槛拒绝：fps 越界）→ 1049 + 上游可读原因透传（前端投影）")
    void pollFailed_transportsUpstreamReason() {
        stubPollClaim(input(60), 3);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("failed", null, null, null, null,
                        "InvalidParameter", "The 'fps' parameter is out of range [15, 120]"));

        processor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED),
                eq("The 'fps' parameter is out of range [15, 120]"),
                any(), eq("worker-1"), eq(5L));
    }

    @Test
    @DisplayName("poll failed + 额度信号 → quota_exhausted（§5 保留）")
    void pollFailedQuotaSignal_preserved() {
        stubPollClaim(input(60), 3);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("failed", null, null, null, null,
                        null, "剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("poll failed + 内容 / 版权信号 → content_rejected 与 content_rejected_reference（§5 保留）")
    void pollFailedContentSignals_preserved() {
        stubPollClaim(input(60), 3);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("failed", null, null, null, null,
                        null, "content policy violation"));
        processor.handle("100");
        assertFailCode(GenerationError.ERROR_CONTENT_REJECTED);

        stubPollClaim(input(60), 3);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("failed", null, null, null, null,
                        null, "copyright reference detected"));
        processor.handle("100");
        assertFailCode(GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);
    }

    // ========== 上游 HTTP 状态结构化透传（IKIMN8 / IKIMS4；对齐音频提取 IKIMS2 样板） ==========

    @Test
    @DisplayName("poll 上游 401（cause 携带状态）→ details.http_status=401，message 剥离状态码字样")
    void pollUnauthorized_persistsHttpStatusDetail() {
        stubPollClaim(input(60), 3);
        VideoFrameInterpolationError unauthorized = new VideoFrameInterpolationError(
                GenerationError.ERROR_PROVIDER_FAILED,
                "MediaKit 视频插帧任务查询失败: HTTP 401"
                        + " body={\"error\":{\"message\":\"Incorrect API key\"}} request_id=req-poll-3");
        unauthorized.initCause(new NewApiVideoClient.HttpStatusException(401));
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(unauthorized);

        processor.handle("100");

        ArgumentCaptor<String> messageCaptor = ArgumentCaptor.captor();
        ArgumentCaptor<Map<String, Object>> detailsCaptor = ArgumentCaptor.captor();
        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED),
                messageCaptor.capture(), detailsCaptor.capture(), eq("worker-1"), eq(5L));
        // 判定只依赖结构化字段：message 不含状态码字样，上游 body / request_id 原样保留
        assertThat(messageCaptor.getValue()).doesNotContain("401").contains("Incorrect API key");
        assertThat(detailsCaptor.getValue())
                .containsEntry("raw", "MediaKit 视频插帧任务查询失败:"
                        + " body={\"error\":{\"message\":\"Incorrect API key\"}} request_id=req-poll-3")
                .containsEntry("http_status", 401);
    }

    // ========== poll 相：completed → 立即下载转存 + 终态发布（URL 24h 有效） ==========

    @Test
    @DisplayName("poll completed → persist 转存 → 发布 payload：官方 duration/resolution/fps + 源宽高近似 + md5 穿透")
    void pollCompleted_publishesWithOfficialResultFields() {
        stubPollClaim(input(120), 3);
        stubSourceAsset(1920, 1080);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("succeeded",
                        "https://volc/out.mp4?auth_key=...", 65.5, "1080p", 120.0, null, null));
        when(mediaRelay.persist("https://volc/out.mp4?auth_key=...", "9"))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishVideoFrameInterpolationResult(any())).thenReturn(true);

        processor.handle("100");

        // URL 24h 有效：completed 后立即转存（同步链路，无续排）
        verify(mediaRelay).persist("https://volc/out.mp4?auth_key=...", "9");
        ArgumentCaptor<PublishVideoFrameInterpolationDto> captor =
                ArgumentCaptor.forClass(PublishVideoFrameInterpolationDto.class);
        verify(stateMachine).publishVideoFrameInterpolationResult(captor.capture());
        PublishVideoFrameInterpolationDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.mp4");
        assertThat(published.storageKey()).isEqualTo("generated/9/video/abc.mp4");
        assertThat(published.mime()).isEqualTo("video/mp4");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        // 插帧不改变分辨率 → 宽高 = 源近似（1920x1080），不做档位推导
        assertThat(published.width()).isEqualTo(1920);
        assertThat(published.height()).isEqualTo(1080);
        assertThat(published.durationSec()).isEqualTo(65.5);
        assertThat(published.resolution()).isEqualTo("1080p");
        assertThat(published.fps()).isEqualTo(120.0);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("completed 缺官方 duration/fps → 回落源时长与冻结 input fps；源宽高缺失 → null（静默容忍）")
    void pollCompleted_fallsBackToFrozenValues() {
        stubPollClaim(input(30), 3);
        stubSourceAsset(null, null);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("succeeded",
                        "https://volc/out.mp4", null, null, null, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 1L, null));
        when(stateMachine.publishVideoFrameInterpolationResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<PublishVideoFrameInterpolationDto> captor =
                ArgumentCaptor.forClass(PublishVideoFrameInterpolationDto.class);
        verify(stateMachine).publishVideoFrameInterpolationResult(captor.capture());
        assertThat(captor.getValue().durationSec()).isEqualTo(65.0); // 源 65000ms 换算
        assertThat(captor.getValue().fps()).isEqualTo(30.0);         // 冻结 input fps 回落
        assertThat(captor.getValue().width()).isNull();
        assertThat(captor.getValue().height()).isNull();
        assertThat(captor.getValue().resolution()).isNull();
    }

    @Test
    @DisplayName("completed 未返回结果视频 URL → 1049 兜底，不转存不发布")
    void pollCompletedWithoutUrl_fails() {
        stubPollClaim(input(60), 3);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("succeeded", null, null, null, null,
                        null, null));

        processor.handle("100");

        assertFailCode(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED);
        verify(mediaRelay, never()).persist(anyString(), anyString());
        verify(stateMachine, never()).publishVideoFrameInterpolationResult(any());
    }

    @Test
    @DisplayName("TOS 未配置 → 1049（结果 URL 24h 失效，强依赖不降级直存）")
    void tosMissing_failsWithoutPassthrough() {
        VideoFrameInterpolationJobProcessor noRelayProcessor = new VideoFrameInterpolationJobProcessor(
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, interpolateVideoClient, null, producer);
        stubPollClaim(input(60), 3);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("succeeded",
                        "https://volc/out.mp4", 65.5, "1080p", 60.0, null, null));

        noRelayProcessor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED),
                eq("视频插帧转存存储未配置"), any(), eq("worker-1"), eq(5L));
        verify(stateMachine, never()).publishVideoFrameInterpolationResult(any());
    }

    @Test
    @DisplayName("转存失败（下载 404）→ 1049 兜底，不发布")
    void relayFails_fails() {
        stubPollClaim(input(60), 3);
        when(interpolateVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new InterpolateVideoTaskObservation("succeeded",
                        "https://volc/out.mp4", 65.5, "1080p", 60.0, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenThrow(new RuntimeException("生成视频下载失败: HTTP 404"));

        processor.handle("100");

        assertFailCode(VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED);
        verify(stateMachine, never()).publishVideoFrameInterpolationResult(any());
    }

    // ========== 冻结 input 解析（整型 fps 兜底，契约三档） ==========

    @Test
    @DisplayName("parseFps：三档整型通过；字符串 / 小数 / 越界 / null 一律拒（兜底防御不放松口径）")
    void parseFpsStrictIntegerThreeTiers() {
        assertThat(VideoFrameInterpolationJobProcessor.parseFps(30)).isEqualTo(30);
        assertThat(VideoFrameInterpolationJobProcessor.parseFps(60L)).isEqualTo(60);
        assertThat(VideoFrameInterpolationJobProcessor.parseFps(120)).isEqualTo(120);

        assertThat(VideoFrameInterpolationJobProcessor.parseFps("60")).isNull();
        assertThat(VideoFrameInterpolationJobProcessor.parseFps(60.5)).isNull();
        assertThat(VideoFrameInterpolationJobProcessor.parseFps(45)).isNull();
        assertThat(VideoFrameInterpolationJobProcessor.parseFps(null)).isNull();
    }

    // ========== 瞬时轮询错误判定（视频骨架同语义） ==========

    @Test
    @DisplayName("瞬时判定：provider_timeout / 网络不可达 / HTTP 429/5xx → 瞬时；4xx / 业务失败 → 非瞬时")
    void transientPollErrorClassification() {
        assertThat(VideoFrameInterpolationJobProcessor.isTransientPollError(
                new VideoFrameInterpolationError(GenerationError.ERROR_PROVIDER_TIMEOUT, "timeout")))
                .isTrue();

        VideoFrameInterpolationError unreachable = new VideoFrameInterpolationError(
                GenerationError.ERROR_PROVIDER_FAILED, "unreachable");
        unreachable.initCause(new java.net.ConnectException("refused"));
        assertThat(VideoFrameInterpolationJobProcessor.isTransientPollError(unreachable)).isTrue();

        for (int status : new int[]{429, 500, 502, 503, 504}) {
            VideoFrameInterpolationError serverError = new VideoFrameInterpolationError(
                    GenerationError.ERROR_PROVIDER_FAILED, "HTTP " + status);
            serverError.initCause(new NewApiVideoClient.HttpStatusException(status));
            assertThat(VideoFrameInterpolationJobProcessor.isTransientPollError(serverError))
                    .as("HTTP %d 应判定瞬时", status).isTrue();
        }

        VideoFrameInterpolationError badRequest = new VideoFrameInterpolationError(
                GenerationError.ERROR_PROVIDER_FAILED, "HTTP 400");
        badRequest.initCause(new NewApiVideoClient.HttpStatusException(400));
        assertThat(VideoFrameInterpolationJobProcessor.isTransientPollError(badRequest)).isFalse();

        assertThat(VideoFrameInterpolationJobProcessor.isTransientPollError(
                new VideoFrameInterpolationError(
                        VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
                        "task failed")))
                .isFalse();
    }
}
