package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedVideoEnhanceJobDto;
import com.bluewhale.worker.domain.dto.PublishVideoEnhanceDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.VideoEnhanceContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoEnhanceError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitEnhanceVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitEnhanceVideoClient.EnhanceVideoTaskObservation;
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
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * VideoEnhanceJobProcessor 单测（IKH3VF，父规格 IKH3VB）。
 * <p>
 * 覆盖：异步两段式状态机（submit 存 task_id → markProviderSubmitted + scheduleNext / poll
 * processing 续排 / 轮询超限 / completed 立即转存发布——官方 duration、档位推导宽高、
 * resolution/fps 随发布 payload / failed 归 1045 + 上游原因透传〔含 SDR 限制场景〕）、
 * input 业务键兜底校验、凭证缺失分类、§5 信号保留与兜底归并、瞬时轮询错误判定、
 * 输出宽高推导（横竖屏 / 三档位 / 源宽高缺失容忍）。不连真实 MQ/DB/TOS/网关。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class VideoEnhanceJobProcessorTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitEnhanceVideoClient enhanceVideoClient;
    @Mock private TosVideoMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private VideoEnhanceJobProcessor processor;

    private static Map<String, Object> input(String resolution) {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("resolution", resolution);
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    @BeforeEach
    void setUp() {
        processor = new VideoEnhanceJobProcessor(
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, enhanceVideoClient, mediaRelay, producer);
        when(stateMachine.failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong())).thenReturn(true);
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
        when(stateMachine.reserveParentReuseSubmit(anyString(), anyString(), anyLong())).thenReturn(true);
    }

    /** 源视频素材（横屏 1920x1080 / 65s：宽高供输出推导、时长供回落）。 */
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

    private ClaimedVideoEnhanceJobDto makeClaim(Map<String, Object> input, String providerTaskId,
                                                int pollCount) {
        return makeClaim(input, providerTaskId, pollCount, null);
    }

    private ClaimedVideoEnhanceJobDto makeClaim(Map<String, Object> input, String providerTaskId,
                                                int pollCount, String parentProviderTaskId) {
        return new ClaimedVideoEnhanceJobDto(
                "100", "42", "9", input, providerTaskId, "worker-1", 5L, pollCount, 0,
                parentProviderTaskId);
    }

    private void stubSubmitClaim(Map<String, Object> input) {
        when(stateMachine.claimVideoEnhance(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, null, 0)));
    }

    private void stubPollClaim(Map<String, Object> input, int pollCount) {
        when(stateMachine.claimVideoEnhance(eq("100"), anyString()))
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
        when(stateMachine.claimVideoEnhance(eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(stateMachine.claimVideoEnhance(eq("100"), anyString()))
                .thenReturn(Optional.empty());

        processor.handle("100");

        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(stateMachine, never()).publishVideoEnhanceResult(any());
    }

    // ========== input 业务键兜底校验（权威复核在创建入口 IKH3VE） ==========

    @Test
    @DisplayName("缺 source_asset_id → invalid_input")
    void missingSourceAssetId_invalidInput() {
        Map<String, Object> input = input("1080p");
        input.remove("source_asset_id");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("resolution 枚举外（含被产品裁掉的 720p）→ invalid_input")
    void invalidResolution_invalidInput() {
        stubSubmitClaim(input("720p"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    // ========== 源素材 / 凭证 ==========

    @Test
    @DisplayName("源素材不可用（非 video）→ 1045 兜底 + 可读原因，不提交上游")
    void sourceAssetNotVideo_enhanceFailed() {
        stubSubmitClaim(input("1080p"));
        AssetEntity image = new AssetEntity();
        image.setType("image");
        image.setUrl("https://example.com/src.png");
        image.setStorageKey("uploads/9/image/src.png");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(image);

        processor.handle("100");

        assertFailCode(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED);
        verify(enhanceVideoClient, never()).submit(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("缺冻结凭证 → provider_credential_missing")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = input("1080p");
        input.remove("provider_credential");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }

    // ========== submit 相：参数 + 状态机（出站 JSON 映射在客户端测试钉） ==========

    @Test
    @DisplayName("submit：resolution 透传 → markProviderSubmitted 存 task_id + scheduleNext(5s)")
    void submitTransportsResolutionAndSchedulesNext() {
        stubSubmitClaim(input("2k"));
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.submit("sk-frozen-token", "https://example.com/src.mp4", "2k"))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(enhanceVideoClient).submit("sk-frozen-token", "https://example.com/src.mp4", "2k");
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", VideoEnhanceJobProcessor.VIDEO_ENHANCE_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("markProviderSubmitted 守卫未命中（stale worker）→ 不自投下一步")
    void submitGuardMissed_noScheduleNext() {
        stubSubmitClaim(input("1080p"));
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.submit(anyString(), anyString(), anyString()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    // ========== submit 相：错误归并（§5 信号保留，其余归 1045；无自动重试） ==========

    @Test
    @DisplayName("submit content_rejected → 保留既有码投影（§5 信号）")
    void submitContentRejected_preserved() {
        stubSubmitClaim(input("1080p"));
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.submit(anyString(), anyString(), anyString()))
                .thenThrow(new VideoEnhanceError(GenerationError.ERROR_CONTENT_REJECTED,
                        "画质增强任务提交失败: HTTP 400 sensitive content"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("submit provider_failed → 归并 1045 兜底（无自动重试）")
    void submitProviderFailed_normalized() {
        stubSubmitClaim(input("1080p"));
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.submit(anyString(), anyString(), anyString()))
                .thenThrow(new VideoEnhanceError(GenerationError.ERROR_PROVIDER_FAILED,
                        "画质增强任务提交失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED);
    }

    @Test
    @DisplayName("submit 超时（provider_timeout）→ 归并 1045（宁可不重试也不双跑，家族口径）")
    void submitTimeout_normalized() {
        stubSubmitClaim(input("1080p"));
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.submit(anyString(), anyString(), anyString()))
                .thenThrow(new VideoEnhanceError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 画质增强提交超时"));

        processor.handle("100");

        assertFailCode(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED);
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    // ========== parent-reuse 重试收割（IKI89S / ADR-0114；平移 VideoJobProcessorTest 先例）==========

    @Test
    @DisplayName("parent-reuse 命中：父任务已成功且结果 URL 齐全 → 不提交，直接转存发布（payload 与正常完成同型）")
    void parentReuseSuccess_publishesWithoutSubmit() {
        when(stateMachine.claimVideoEnhance(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("2k"), null, 0, "amk-parent-1")));
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-parent-1"))
                .thenReturn(new EnhanceVideoTaskObservation("succeeded",
                        "https://volc/old-out.mp4?auth_key=...", 65.5, "2k", 30.0, null, null));
        stubSourceAsset(1920, 1080);
        when(mediaRelay.persist("https://volc/old-out.mp4?auth_key=...", "9"))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishVideoEnhanceResult(any())).thenReturn(true);

        processor.handle("100");

        verify(enhanceVideoClient, never()).submit(anyString(), anyString(), anyString());
        verify(mediaRelay).persist("https://volc/old-out.mp4?auth_key=...", "9");
        ArgumentCaptor<PublishVideoEnhanceDto> captor =
                ArgumentCaptor.forClass(PublishVideoEnhanceDto.class);
        verify(stateMachine).publishVideoEnhanceResult(captor.capture());
        PublishVideoEnhanceDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.mp4");
        assertThat(published.storageKey()).isEqualTo("generated/9/video/abc.mp4");
        assertThat(published.mime()).isEqualTo("video/mp4");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        // 源横屏 1920x1080 → 2k 档推导 2560x1440，档位推导与正常完成路径同型
        assertThat(published.width()).isEqualTo(2560);
        assertThat(published.height()).isEqualTo(1440);
        assertThat(published.durationSec()).isEqualTo(65.5);
        assertThat(published.resolution()).isEqualTo("2k");
        assertThat(published.fps()).isEqualTo(30.0);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 父任务 failed → 回退正常重新提交")
    void parentReuseFailed_fallThrough() {
        when(stateMachine.claimVideoEnhance(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("1080p"), null, 0, "amk-parent-fail")));
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-parent-fail"))
                .thenReturn(new EnhanceVideoTaskObservation("failed", null, null, null, null,
                        "VideoNotSupported", "仅支持 SDR 视频"));
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(enhanceVideoClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("1080p"));
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查询失败后提交前失租，停止执行")
    void parentReuseLeaseLostBeforeSubmit_stops() {
        when(stateMachine.claimVideoEnhance(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("1080p"), null, 0, "amk-parent-race")));
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-parent-race"))
                .thenThrow(new RuntimeException("HTTP 503"));
        stubSourceAsset(1920, 1080);
        when(stateMachine.reserveParentReuseSubmit("100", "worker-1", 5L)).thenReturn(false);

        processor.handle("100");

        verify(enhanceVideoClient, never()).submit(anyString(), anyString(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查父任务异常（不存在/网络错）→ 按不存在处理，回退正常重新提交")
    void parentReusePollError_fallThrough() {
        when(stateMachine.claimVideoEnhance(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("1080p"), null, 0, "amk-parent-gone")));
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-parent-gone"))
                .thenThrow(new VideoEnhanceError(GenerationError.ERROR_PROVIDER_FAILED,
                        "MediaKit 画质增强任务查询失败: HTTP 404"));
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(enhanceVideoClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("1080p"));
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("非重试 job（parentProviderTaskId=null）→ 不查父任务，执行路径与现状完全一致")
    void nonRetryJob_skipsParentQuery() {
        stubSubmitClaim(input("1080p"));
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(enhanceVideoClient, never()).poll(anyString(), anyString());
        verify(enhanceVideoClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("1080p"));
    }

    @Test
    @DisplayName("parent-reuse 父任务成功但结果 URL 为空（结果不齐全）→ 回退正常重新提交")
    void parentReuseIncompleteResult_fallThrough() {
        when(stateMachine.claimVideoEnhance(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("1080p"), null, 0, "amk-parent-empty")));
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-parent-empty"))
                .thenReturn(new EnhanceVideoTaskObservation("succeeded", null, null, null, null,
                        null, null));
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(enhanceVideoClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("1080p"));
        verify(mediaRelay, never()).persist(anyString(), anyString());
    }

    @Test
    @DisplayName("parent-reuse 收割发布失败（转存下载 404，URL 超 24h 失效）→ 回退正常重新提交，不落失败终态")
    void parentReusePublishFails_fallThrough() {
        when(stateMachine.claimVideoEnhance(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("1080p"), null, 0, "amk-parent-stale")));
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-parent-stale"))
                .thenReturn(new EnhanceVideoTaskObservation("succeeded",
                        "https://volc/expired-out.mp4", 65.5, "1080p", 30.0, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenThrow(new RuntimeException("生成视频下载失败: HTTP 404"));
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(enhanceVideoClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("1080p"));
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 收割发布守卫未命中（publish 返回 false）→ 停止本次执行：不提交、不自投、不落失败终态（IKICD0）")
    void parentReusePublishGuardMissed_stopWithoutSubmit() {
        when(stateMachine.claimVideoEnhance(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("1080p"), null, 0, "amk-parent-guard")));
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-parent-guard"))
                .thenReturn(new EnhanceVideoTaskObservation("succeeded",
                        "https://volc/old-out.mp4", 65.5, "1080p", 30.0, null, null));
        stubSourceAsset(1920, 1080);
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishVideoEnhanceResult(any())).thenReturn(false);

        processor.handle("100");

        // 失租/已终态守卫未命中 = 停止终局（IKICD0）：当前 worker 已无执行权，回退提交只会
        // 先白付一次上游 submit 再被 markProviderSubmitted 守卫丢弃（孤儿上游任务）；任务
        // 保持 processing，由新 worker 重新领取后重新检查父任务继续收割
        verify(enhanceVideoClient, never()).submit(anyString(), anyString(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    // ========== poll 相：状态机 ==========

    @Test
    @DisplayName("poll processing → rescheduleProviderPoll + scheduleNext(5s)")
    void pollProcessing_reschedules() {
        stubPollClaim(input("1080p"), 3);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new EnhanceVideoTaskObservation("processing", null, null, null, null,
                        null, null));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoEnhanceJobProcessor.VIDEO_ENHANCE_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 超限（pollCount>=720）→ 1045 轮询超时，不再续排")
    void pollExceedsLimit_fails() {
        stubPollClaim(input("1080p"), VideoEnhanceJobProcessor.MAX_VIDEO_ENHANCE_POLLS);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new EnhanceVideoTaskObservation("processing", null, null, null, null,
                        null, null));

        processor.handle("100");

        assertFailCode(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）→ reschedule 续排，不落终态")
    void pollTransientError_reschedules() {
        stubPollClaim(input("1080p"), 3);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoEnhanceError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 画质增强任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoEnhanceJobProcessor.VIDEO_ENHANCE_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限（pollCount=719）→ 仍按 5s 续排（次数由 SQL +1，IKI61M）")
    void pollTransientErrorBelowLimit_reschedules() {
        stubPollClaim(input("1080p"), VideoEnhanceJobProcessor.MAX_VIDEO_ENHANCE_POLLS - 1);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoEnhanceError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 画质增强任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 0);
        verify(producer).enqueue("100", VideoEnhanceJobProcessor.VIDEO_ENHANCE_POLL_INTERVAL_MS);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（pollCount=720）→ 1045 轮询超时 + 不再续排（IKI61M：与 processing 共享预算）")
    void pollTransientErrorAtLimit_fails() {
        stubPollClaim(input("1080p"), VideoEnhanceJobProcessor.MAX_VIDEO_ENHANCE_POLLS);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoEnhanceError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 画质增强任务查询超时"));

        processor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED),
                eq("画质增强轮询超时（超过 " + VideoEnhanceJobProcessor.MAX_VIDEO_ENHANCE_POLLS
                        + " 次），上游持续错误: MediaKit 画质增强任务查询超时"),
                any(), eq("worker-1"), eq(5L));
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（HTTP 503 瞬时形态）→ 1045（瞬时错误各形态同受上限约束）")
    void pollTransientHttp503AtLimit_fails() {
        stubPollClaim(input("1080p"), VideoEnhanceJobProcessor.MAX_VIDEO_ENHANCE_POLLS);
        VideoEnhanceError gatewayBusy = new VideoEnhanceError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 画质增强任务查询失败: HTTP 503");
        gatewayBusy.initCause(new NewApiVideoClient.HttpStatusException(503));
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(gatewayBusy);

        processor.handle("100");

        assertFailCode(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限但 reschedule 守卫未命中（stale worker / fencing 失配）→ 不自投下一步、不落终态")
    void pollTransientErrorGuardMissed_noScheduleNext() {
        stubPollClaim(input("1080p"), 3);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VideoEnhanceError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 画质增强任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 硬错误（HTTP 404 任务不存在）→ 1045 兜底")
    void pollHardError_fails() {
        stubPollClaim(input("1080p"), 3);
        VideoEnhanceError notFound = new VideoEnhanceError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 画质增强任务查询失败: HTTP 404");
        notFound.initCause(new NewApiVideoClient.HttpStatusException(404));
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(notFound);

        processor.handle("100");

        assertFailCode(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED);
    }

    @Test
    @DisplayName("poll failed（SDR 限制场景）→ 1045 + 上游可读原因透传（前端投影）")
    void pollFailed_transportsUpstreamReason() {
        stubPollClaim(input("1080p"), 3);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new EnhanceVideoTaskObservation("failed", null, null, null, null,
                        "VideoNotSupported", "仅支持 SDR 视频"));

        processor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED),
                eq("仅支持 SDR 视频"),
                any(), eq("worker-1"), eq(5L));
    }

    @Test
    @DisplayName("poll failed + 额度信号 → quota_exhausted（§5 保留）")
    void pollFailedQuotaSignal_preserved() {
        stubPollClaim(input("1080p"), 3);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new EnhanceVideoTaskObservation("failed", null, null, null, null,
                        null, "剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    // ========== poll 相：completed → 立即下载转存 + 终态发布（URL 24h 有效） ==========

    @Test
    @DisplayName("poll completed → persist 转存 → 发布 payload：官方 duration + 档位推导宽高 + resolution/fps + md5 穿透")
    void pollCompleted_publishesDerivedDimensions() {
        stubPollClaim(input("2k"), 3);
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new EnhanceVideoTaskObservation("succeeded",
                        "https://volc/out.mp4?auth_key=...", 65.5, "2k", 30.0, null, null));
        when(mediaRelay.persist("https://volc/out.mp4?auth_key=...", "9"))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishVideoEnhanceResult(any())).thenReturn(true);

        processor.handle("100");

        // URL 24h 有效：completed 后立即转存（同步链路，无续排）
        verify(mediaRelay).persist("https://volc/out.mp4?auth_key=...", "9");
        ArgumentCaptor<PublishVideoEnhanceDto> captor =
                ArgumentCaptor.forClass(PublishVideoEnhanceDto.class);
        verify(stateMachine).publishVideoEnhanceResult(captor.capture());
        PublishVideoEnhanceDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.mp4");
        assertThat(published.storageKey()).isEqualTo("generated/9/video/abc.mp4");
        assertThat(published.mime()).isEqualTo("video/mp4");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        // 源横屏 1920x1080 → 2k 档：短边 1440、长边 1920*1440/1080=2560 → 宽 2560 高 1440
        assertThat(published.width()).isEqualTo(2560);
        assertThat(published.height()).isEqualTo(1440);
        assertThat(published.durationSec()).isEqualTo(65.5);
        assertThat(published.resolution()).isEqualTo("2k");
        assertThat(published.fps()).isEqualTo(30.0);
        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("completed 无官方 resolution → 回落任务冻结 resolution 推导")
    void pollCompleted_fallsBackToFrozenResolution() {
        stubPollClaim(input("4k"), 3);
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new EnhanceVideoTaskObservation("succeeded",
                        "https://volc/out.mp4", null, null, null, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 1L, null));
        when(stateMachine.publishVideoEnhanceResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<PublishVideoEnhanceDto> captor =
                ArgumentCaptor.forClass(PublishVideoEnhanceDto.class);
        verify(stateMachine).publishVideoEnhanceResult(captor.capture());
        // 官方 duration 也缺失 → 回落源 duration_ms 换算秒
        assertThat(captor.getValue().durationSec()).isEqualTo(65.0);
        // 4k 档短边 2160、长边 1920*2160/1080=3840
        assertThat(captor.getValue().width()).isEqualTo(3840);
        assertThat(captor.getValue().height()).isEqualTo(2160);
        assertThat(captor.getValue().resolution()).isEqualTo("4k");
    }

    @Test
    @DisplayName("completed 未返回结果视频 URL → 1045 兜底")
    void pollCompletedWithoutUrl_fails() {
        stubPollClaim(input("1080p"), 3);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new EnhanceVideoTaskObservation("succeeded", null, null, null, null,
                        null, null));

        processor.handle("100");

        assertFailCode(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED);
        verify(mediaRelay, never()).persist(anyString(), anyString());
    }

    @Test
    @DisplayName("TOS 未配置 → 1045（结果 URL 24h 失效，强依赖不降级直存）")
    void tosMissing_failsWithoutPassthrough() {
        VideoEnhanceJobProcessor noRelayProcessor = new VideoEnhanceJobProcessor(
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, enhanceVideoClient, null, producer);
        stubPollClaim(input("1080p"), 3);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new EnhanceVideoTaskObservation("succeeded",
                        "https://volc/out.mp4", 65.5, "1080p", 30.0, null, null));

        noRelayProcessor.handle("100");

        verify(stateMachine).failVideoJob(eq("100"),
                eq(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED),
                eq("画质增强转存存储未配置"), any(), eq("worker-1"), eq(5L));
        verify(stateMachine, never()).publishVideoEnhanceResult(any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubPollClaim(input("1080p"), 3);
        stubSourceAsset(1920, 1080);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new EnhanceVideoTaskObservation("succeeded",
                        "https://volc/out.mp4", 65.5, "1080p", 30.0, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenReturn(new TosVideoMediaRelay.StoredVideo(
                        "https://tos/out.mp4", "generated/9/video/abc.mp4",
                        "video/mp4", 1L, null));
        when(stateMachine.publishVideoEnhanceResult(any())).thenReturn(false);

        processor.handle("100");

        verify(stateMachine, never()).failVideoJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("转存失败（下载 404）→ 1045 兜底，不发布")
    void relayFails_fails() {
        stubPollClaim(input("1080p"), 3);
        when(enhanceVideoClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new EnhanceVideoTaskObservation("succeeded",
                        "https://volc/out.mp4", 65.5, "1080p", 30.0, null, null));
        when(mediaRelay.persist(anyString(), eq("9")))
                .thenThrow(new RuntimeException("生成视频下载失败: HTTP 404"));

        processor.handle("100");

        assertFailCode(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED);
        verify(stateMachine, never()).publishVideoEnhanceResult(any());
    }

    // ========== 输出宽高推导（官方仅返回档位字符串，短边 = 码率参考表档位口径） ==========

    @Test
    @DisplayName("推导：横屏 1920x1080 → 1080p 档 = 1920x1080（源已是 1080P）")
    void deriveLandscape1080p() {
        int[] dims = VideoEnhanceJobProcessor.deriveOutputDimensions(sourceAsset(1920, 1080), "1080p");
        assertThat(dims).containsExactly(1920, 1080);
    }

    @Test
    @DisplayName("推导：竖屏 1080x1920 → 4k 档保持竖屏 2160x3840（宽=短边）")
    void derivePortrait4kKeepsOrientation() {
        int[] dims = VideoEnhanceJobProcessor.deriveOutputDimensions(sourceAsset(1080, 1920), "4k");
        assertThat(dims).containsExactly(2160, 3840);
    }

    @Test
    @DisplayName("推导：非整数比例取偶（横屏 1280x544 源 → 1080p 档长边 2541.17 → 2541 奇 → 2542）")
    void deriveRoundsLongSideToEven() {
        int[] dims = VideoEnhanceJobProcessor.deriveOutputDimensions(sourceAsset(1280, 544), "1080p");
        assertThat(dims).containsExactly(2542, 1080);
    }

    @Test
    @DisplayName("推导：源宽高缺失 / 档位未知 → null（静默容忍，去字幕同款口径）")
    void deriveMissingDimensionsOrNull() {
        assertThat(VideoEnhanceJobProcessor.deriveOutputDimensions(null, "1080p")).isNull();
        assertThat(VideoEnhanceJobProcessor.deriveOutputDimensions(sourceAsset(null, null), "2k"))
                .isNull();
        assertThat(VideoEnhanceJobProcessor.deriveOutputDimensions(sourceAsset(1920, 1080), "720p"))
                .isNull();
    }

    /** 独立构造源 Asset（不动 mock 桩，供静态推导测试直用）。 */
    private static AssetEntity sourceAsset(Integer width, Integer height) {
        AssetEntity source = new AssetEntity();
        source.setWidth(width);
        source.setHeight(height);
        return source;
    }

    // ========== 瞬时轮询错误判定（视频骨架同语义） ==========

    @Test
    @DisplayName("瞬时判定：provider_timeout / 网络不可达 / HTTP 429/5xx → 瞬时；4xx / 业务失败 → 非瞬时")
    void transientPollErrorClassification() {
        assertThat(VideoEnhanceJobProcessor.isTransientPollError(
                new VideoEnhanceError(GenerationError.ERROR_PROVIDER_TIMEOUT, "timeout")))
                .isTrue();

        VideoEnhanceError unreachable = new VideoEnhanceError(
                GenerationError.ERROR_PROVIDER_FAILED, "unreachable");
        unreachable.initCause(new java.net.ConnectException("refused"));
        assertThat(VideoEnhanceJobProcessor.isTransientPollError(unreachable)).isTrue();

        for (int status : new int[]{429, 500, 502, 503, 504}) {
            VideoEnhanceError serverError = new VideoEnhanceError(
                    GenerationError.ERROR_PROVIDER_FAILED, "HTTP " + status);
            serverError.initCause(new NewApiVideoClient.HttpStatusException(status));
            assertThat(VideoEnhanceJobProcessor.isTransientPollError(serverError))
                    .as("HTTP %d 应判定瞬时", status).isTrue();
        }

        VideoEnhanceError badRequest = new VideoEnhanceError(
                GenerationError.ERROR_PROVIDER_FAILED, "HTTP 400");
        badRequest.initCause(new NewApiVideoClient.HttpStatusException(400));
        assertThat(VideoEnhanceJobProcessor.isTransientPollError(badRequest)).isFalse();

        assertThat(VideoEnhanceJobProcessor.isTransientPollError(
                new VideoEnhanceError(VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED,
                        "task failed")))
                .isFalse();
    }
}
