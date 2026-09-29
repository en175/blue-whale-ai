package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishAudioSpeedDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.AudioSpeedContract;
import com.bluewhale.worker.domain.error.AudioSpeedError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitAdjustAudioSpeedClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitAdjustAudioSpeedClient.AudioSpeedTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
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
 * AudioSpeedJobProcessor 错误码映射与异步链编排测试（IKHW5A，父单 IKHVYO；火山 MediaKit
 * adjust-audio-speed 执行面，模板 AudioTrimJobProcessorErrorMappingTest 一对一平移）。
 * <p>
 * 覆盖：claim 语义、input 业务键兜底校验（含 speed 可选与脏值形态）、凭证缺失分类、
 * submit 相（提交成功存 task_id + 续排 / §5 信号保留 / 归并 1051）、poll 相
 * （processing 续排进度保持 / 轮询超限 / 瞬时错误重排 / 火山 failed 分类 + 上游原因透传）、
 * completed 立即转存发布（固定 m4a 转存格式 / 官方 duration 直取不回落 / md5 穿透）、
 * 转存强依赖与瞬时判定。不连真实 MQ/DB/TOS/网关。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AudioSpeedJobProcessorErrorMappingTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobClaimService claimService;
    @Mock private GenerationJobMapper jobMapper;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitAdjustAudioSpeedClient adjustAudioSpeedClient;
    @Mock private TosAudioMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private AudioSpeedJobProcessor processor;

    private static Map<String, Object> input() {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("speed", 1.35);
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    @BeforeEach
    void setUp() {
        processor = new AudioSpeedJobProcessor(
                stateMachine, claimService, jobMapper, finalizer, new AssetSourceService(assetMapper),
                credentialService, adjustAudioSpeedClient, mediaRelay, producer);
        when(finalizer.failAudioSpeedJob(any())).thenReturn(true);
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
    }

    /** 源音频素材（worker 不消费其时长——调速产物时长只取官方 duration，不回落）。 */
    private void stubSourceAsset() {
        AssetEntity source = new AssetEntity();
        source.setType("audio");
        source.setUrl("https://example.com/src.mp3");
        source.setStorageKey("uploads/9/audio/src.mp3");
        source.setDurationMs(300_000);
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(source);
    }

    private ClaimedJob makeClaim(Map<String, Object> input, String providerTaskId,
                                              int pollCount, int progress) {
        return new ClaimedJob(
                "100", "42", "9", input, "audio_speed", providerTaskId, false, "worker-1", 5L, pollCount,
                progress, null, null, null);
    }

    private void stubSubmitClaim(Map<String, Object> input) {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, null, 0, 0)));
    }

    private void stubPollClaim(Map<String, Object> input, int pollCount, int progress) {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, "amk-task-1", pollCount, progress)));
    }

    private void assertFailCode(String expectedCode) {
        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioSpeedDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioSpeedDto.class);
        verify(finalizer).failAudioSpeedJob(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo(expectedCode);
    }

    // ========== claim 语义（家族同构：DB 异常上抛保重投） ==========

    @Test
    @DisplayName("claim 抛 DB 异常 → 上抛（不 fail job，不 ack → 重投）")
    void claimThrowsDbError_propagates() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(finalizer, never()).failAudioSpeedJob(any());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.empty());

        processor.handle("100");

        verify(finalizer, never()).failAudioSpeedJob(any());
        verify(finalizer, never()).publishAudioSpeedResult(any());
    }

    // ========== input 业务键兜底校验（权威复核在创建入口） ==========

    @Test
    @DisplayName("缺少 source_asset_id → invalid_input")
    void missingSourceAssetId_invalidInput() {
        Map<String, Object> input = input();
        input.remove("source_asset_id");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("speed 脏值（非数字形态）→ invalid_input（可选键存在则须为数字）")
    void dirtySpeed_invalidInput() {
        Map<String, Object> input = input();
        input.put("speed", "1.35");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("贴原速省略形态：speed 键省略 → null 出站（走官方默认 1）")
    void speedOmitted_submitWithoutSpeedKey() {
        Map<String, Object> input = input();
        input.remove("speed");
        stubSubmitClaim(input);
        stubSourceAsset();
        when(adjustAudioSpeedClient.submit(eq("sk-frozen-token"), eq("https://example.com/src.mp3"),
                isNull())).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(adjustAudioSpeedClient).submit("sk-frozen-token", "https://example.com/src.mp3",
                null);
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", AudioSpeedJobProcessor.AUDIO_SPEED_POLL_INTERVAL_MS);
        verify(finalizer, never()).failAudioSpeedJob(any());
    }

    // ========== 源素材 / 凭证 ==========

    @Test
    @DisplayName("源素材不可用（非 audio）→ 1051 兜底 + 可读原因，不提交上游")
    void sourceAssetNotAudio_failed() {
        stubSubmitClaim(input());
        AssetEntity video = new AssetEntity();
        video.setType("video");
        video.setUrl("https://example.com/src.mp4");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(video);

        processor.handle("100");

        assertFailCode(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
        verify(adjustAudioSpeedClient, never()).submit(anyString(), anyString(), any());
    }

    @Test
    @DisplayName("缺冻结凭证 → provider_credential_missing（不臆造兜底 token）")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = input();
        input.remove("provider_credential");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }

    // ========== submit 相：提交成功 + 错误归并（§5 分类；无自动重试） ==========

    @Test
    @DisplayName("提交成功：submit 带 audio_url + speed → markProviderSubmitted 存 task_id + scheduleNext(5s)")
    void submitSuccess_marksAndSchedules() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(adjustAudioSpeedClient.submit(eq("sk-frozen-token"), eq("https://example.com/src.mp3"),
                eq(1.35))).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(adjustAudioSpeedClient).submit("sk-frozen-token", "https://example.com/src.mp3", 1.35);
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", AudioSpeedJobProcessor.AUDIO_SPEED_POLL_INTERVAL_MS);
        verify(finalizer, never()).failAudioSpeedJob(any());
    }

    @Test
    @DisplayName("markProviderSubmitted 守卫未命中（stale worker）→ 不自投下一步")
    void submitGuardMissed_noScheduleNext() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(adjustAudioSpeedClient.submit(anyString(), anyString(), any()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("submit quota_exhausted → 保留既有码投影（§5 信号）")
    void submitQuotaExhausted_preserved() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(adjustAudioSpeedClient.submit(anyString(), anyString(), any()))
                .thenThrow(new AudioSpeedError(GenerationError.ERROR_QUOTA_EXHAUSTED,
                        "音频调速任务提交失败: HTTP 402 剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("submit provider_failed → 归并 1051 兜底（无自动重试）")
    void submitProviderFailed_normalized() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(adjustAudioSpeedClient.submit(anyString(), anyString(), any()))
                .thenThrow(new AudioSpeedError(GenerationError.ERROR_PROVIDER_FAILED,
                        "音频调速任务提交失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
    }

    @Test
    @DisplayName("submit 超时（provider_timeout）→ 归并 1051（宁可不重试也不双跑，家族口径）")
    void submitTimeout_normalized() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(adjustAudioSpeedClient.submit(anyString(), anyString(), any()))
                .thenThrow(new AudioSpeedError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频调速提交超时"));

        processor.handle("100");

        assertFailCode(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    // ========== 上游 HTTP 状态结构化透传（IKIMN8 / IKIMS3；对齐音频提取 IKIMS2 样板） ==========

    @Test
    @DisplayName("submit 上游 401（cause 携带状态）→ details.http_status=401，message 剥离状态码字样")
    void submitUnauthorized_persistsHttpStatusDetail() {
        stubSubmitClaim(input());
        stubSourceAsset();
        AudioSpeedError unauthorized = new AudioSpeedError(GenerationError.ERROR_PROVIDER_FAILED,
                "音频调速任务提交失败: HTTP 401 上游凭证被拒绝 request_id=req-sub-7");
        unauthorized.initCause(new NewApiVideoClient.HttpStatusException(401));
        when(adjustAudioSpeedClient.submit(anyString(), anyString(), any())).thenThrow(unauthorized);

        processor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioSpeedDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioSpeedDto.class);
        verify(finalizer).failAudioSpeedJob(captor.capture());
        com.bluewhale.worker.domain.dto.FailAudioSpeedDto failure = captor.getValue();
        assertThat(failure.code()).isEqualTo(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
        // 判定只依赖结构化字段：message/raw 不含状态码字样，上游原因与 request_id 保留
        assertThat(failure.message()).doesNotContain("401").contains("上游凭证被拒绝");
        assertThat(failure.details())
                .containsEntry("raw", "音频调速任务提交失败: 上游凭证被拒绝 request_id=req-sub-7")
                .containsEntry("http_status", 401);
    }

    // ========== poll 相：状态机 + 进度口径（家族对齐） ==========

    @Test
    @DisplayName("poll processing → rescheduleProviderPoll(进度保持不倒退) + scheduleNext(5s)")
    void pollProcessing_reschedules() {
        stubPollClaim(input(), 3, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new AudioSpeedTaskObservation("processing", null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", AudioSpeedJobProcessor.AUDIO_SPEED_POLL_INTERVAL_MS);
        verify(finalizer, never()).failAudioSpeedJob(any());
    }

    @Test
    @DisplayName("poll 超限（pollCount>=720）→ 1051 轮询超时，不再续排")
    void pollExceedsLimit_fails() {
        stubPollClaim(input(), AudioSpeedJobProcessor.MAX_AUDIO_SPEED_POLLS, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new AudioSpeedTaskObservation("processing", null, null, null, null));

        processor.handle("100");

        assertFailCode(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）→ reschedule 续排，不落终态")
    void pollTransientError_reschedules() {
        stubPollClaim(input(), 3, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new AudioSpeedError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频调速任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", AudioSpeedJobProcessor.AUDIO_SPEED_POLL_INTERVAL_MS);
        verify(finalizer, never()).failAudioSpeedJob(any());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限（pollCount=719）→ 仍按 5s 续排（次数由 SQL +1，IKI4M4）")
    void pollTransientErrorBelowLimit_reschedules() {
        stubPollClaim(input(), AudioSpeedJobProcessor.MAX_AUDIO_SPEED_POLLS - 1, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new AudioSpeedError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频调速任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", AudioSpeedJobProcessor.AUDIO_SPEED_POLL_INTERVAL_MS);
        verify(finalizer, never()).failAudioSpeedJob(any());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（pollCount=720）→ 1051 轮询超时 + 不再续排（IKI4M4：与 processing 共享预算）")
    void pollTransientErrorAtLimit_fails() {
        stubPollClaim(input(), AudioSpeedJobProcessor.MAX_AUDIO_SPEED_POLLS, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new AudioSpeedError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频调速任务查询超时"));

        processor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioSpeedDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioSpeedDto.class);
        verify(finalizer).failAudioSpeedJob(captor.capture());
        assertThat(captor.getValue().code())
                .isEqualTo(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
        assertThat(captor.getValue().message())
                .isEqualTo("音频调速轮询超时（超过 "
                        + AudioSpeedJobProcessor.MAX_AUDIO_SPEED_POLLS
                        + " 次），上游持续错误: MediaKit 音频调速任务查询超时");
        // 反例钉住缺键语义：无状态 cause（provider_timeout 形态）不写 http_status，只留 raw（IKIN6W）
        assertThat(captor.getValue().details()).doesNotContainKey("http_status").containsKey("raw");
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（HTTP 503 瞬时形态）→ 1051 + details.http_status=503，message 剥离状态码字样（IKIN6W：预算耗尽分支同透传口径）")
    void pollTransientHttp503AtLimit_fails() {
        stubPollClaim(input(), AudioSpeedJobProcessor.MAX_AUDIO_SPEED_POLLS, 7);
        AudioSpeedError gatewayBusy = new AudioSpeedError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 音频调速任务查询失败: HTTP 503");
        gatewayBusy.initCause(new NewApiVideoClient.HttpStatusException(503));
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(gatewayBusy);

        processor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioSpeedDto> gatewayCaptor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioSpeedDto.class);
        verify(finalizer).failAudioSpeedJob(gatewayCaptor.capture());
        assertThat(gatewayCaptor.getValue().code())
                .isEqualTo(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
        // 判定只依赖结构化字段：剥「: HTTP 503」后冒号保留，上游持续错误摘要仍在（可读原因）
        assertThat(gatewayCaptor.getValue().message())
                .isEqualTo("音频调速轮询超时（超过 "
                        + AudioSpeedJobProcessor.MAX_AUDIO_SPEED_POLLS
                        + " 次），上游持续错误: MediaKit 音频调速任务查询失败:")
                .doesNotContain("503");
        assertThat(gatewayCaptor.getValue().details())
                .containsEntry("http_status", 503)
                .containsEntry("raw", "音频调速轮询超时（超过 "
                        + AudioSpeedJobProcessor.MAX_AUDIO_SPEED_POLLS
                        + " 次），上游持续错误: MediaKit 音频调速任务查询失败:");
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限但 reschedule 守卫未命中（stale worker / fencing 失配）→ 不自投下一步、不落终态")
    void pollTransientErrorGuardMissed_noScheduleNext() {
        stubPollClaim(input(), 3, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new AudioSpeedError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频调速任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failAudioSpeedJob(any());
    }

    @Test
    @DisplayName("poll 硬错误（HTTP 404 任务不存在）→ 1051 兜底")
    void pollHardError_fails() {
        stubPollClaim(input(), 3, 7);
        AudioSpeedError notFound = new AudioSpeedError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 音频调速任务查询失败: HTTP 404");
        notFound.initCause(new NewApiVideoClient.HttpStatusException(404));
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(notFound);

        processor.handle("100");

        assertFailCode(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
    }

    // ========== poll 相：火山任务 failed（§5 分类映射） ==========

    @Test
    @DisplayName("poll failed（speed 越界官方约束拒绝）→ 1051 + 上游可读原因透传（前端投影）")
    void pollFailed_transportsUpstreamReason() {
        stubPollClaim(input(), 3, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new AudioSpeedTaskObservation("failed", null, null,
                        "InvalidParameter", "The parameter `speed` must be in range [0.1, 4]."));

        processor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioSpeedDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioSpeedDto.class);
        verify(finalizer).failAudioSpeedJob(captor.capture());
        assertThat(captor.getValue().code())
                .isEqualTo(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
        assertThat(captor.getValue().message())
                .isEqualTo("The parameter `speed` must be in range [0.1, 4].");
    }

    @Test
    @DisplayName("poll failed + 额度信号 → quota_exhausted（§5 保留）")
    void pollFailedQuotaSignal_preserved() {
        stubPollClaim(input(), 3, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new AudioSpeedTaskObservation("failed", null, null,
                        null, "剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("poll failed 无上游原因 → 1051 + 默认文案")
    void pollFailedWithoutReason_fallsBackMessage() {
        stubPollClaim(input(), 3, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new AudioSpeedTaskObservation("failed", null, null, null, null));

        processor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioSpeedDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioSpeedDto.class);
        verify(finalizer).failAudioSpeedJob(captor.capture());
        assertThat(captor.getValue().code())
                .isEqualTo(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
        assertThat(captor.getValue().message()).isEqualTo("音频调速任务失败");
    }

    // ========== poll 相：completed → 立即转存 + 终态发布（URL 24h 有效） ==========

    @Test
    @DisplayName("poll completed → persist 固定 m4a 转存（不传官方 format，产物跟随默认）→ 发布 payload：官方 duration 秒 + md5 穿透")
    void pollCompleted_publishesWithOfficialDuration() {
        stubPollClaim(input(), 3, 7);
        stubSourceAsset();
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new AudioSpeedTaskObservation("succeeded",
                        "https://volc/out.m4a?auth_key=...", 47.5, null, null));
        when(mediaRelay.persist("https://volc/out.m4a?auth_key=...", "9",
                AudioSpeedContract.TRANSFER_OUTPUT_FORMAT))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.m4a", "generated/9/audio/abc.m4a",
                        "audio/mp4", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishAudioSpeedResult(any())).thenReturn(true);

        processor.handle("100");

        // URL 24h 有效：completed 后立即转存（同步链路，无续排）；扩展名/mime 固定契约
        // TRANSFER_OUTPUT_FORMAT（本产品不传官方 format，产物跟随默认 m4a）
        verify(mediaRelay).persist("https://volc/out.m4a?auth_key=...", "9",
                AudioSpeedContract.TRANSFER_OUTPUT_FORMAT);
        ArgumentCaptor<PublishAudioSpeedDto> captor =
                ArgumentCaptor.forClass(PublishAudioSpeedDto.class);
        verify(finalizer).publishAudioSpeedResult(captor.capture());
        PublishAudioSpeedDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.m4a");
        assertThat(published.storageKey()).isEqualTo("generated/9/audio/abc.m4a");
        assertThat(published.mime()).isEqualTo("audio/mp4");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(published.durationSec()).isEqualTo(47.5);
        verify(finalizer, never()).failAudioSpeedJob(any());
    }

    @Test
    @DisplayName("completed 无官方 duration → duration 直取 null（不回落源时长——调速产物时长 = 源时长/speed ≠ 源时长）")
    void pollCompleted_noSourceDurationFallback() {
        stubPollClaim(input(), 3, 7);
        stubSourceAsset();
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new AudioSpeedTaskObservation("succeeded",
                        "https://volc/out.m4a", null, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq(AudioSpeedContract.TRANSFER_OUTPUT_FORMAT)))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.m4a", "generated/9/audio/abc.m4a",
                        "audio/mp4", 1L, null));
        when(finalizer.publishAudioSpeedResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<PublishAudioSpeedDto> captor =
                ArgumentCaptor.forClass(PublishAudioSpeedDto.class);
        verify(finalizer).publishAudioSpeedResult(captor.capture());
        assertThat(captor.getValue().durationSec()).isNull();
    }

    @Test
    @DisplayName("completed 未返回结果音频 URL → 1051 兜底")
    void pollCompletedWithoutUrl_fails() {
        stubPollClaim(input(), 3, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new AudioSpeedTaskObservation("succeeded", null, null, null, null));

        processor.handle("100");

        assertFailCode(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
        verify(mediaRelay, never()).persist(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("TOS 未配置 → 1051（结果 URL 24h 失效，强依赖不降级直存）")
    void tosMissing_failsWithoutPassthrough() {
        AudioSpeedJobProcessor noRelayProcessor = new AudioSpeedJobProcessor(
                stateMachine, claimService, jobMapper, finalizer, new AssetSourceService(assetMapper),
                credentialService, adjustAudioSpeedClient, null, producer);
        stubPollClaim(input(), 3, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new AudioSpeedTaskObservation("succeeded",
                        "https://volc/out.m4a", 47.5, null, null));

        noRelayProcessor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioSpeedDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioSpeedDto.class);
        verify(finalizer).failAudioSpeedJob(captor.capture());
        assertThat(captor.getValue().code())
                .isEqualTo(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
        assertThat(captor.getValue().message()).isEqualTo("音频转存存储未配置");
        verify(finalizer, never()).publishAudioSpeedResult(any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubPollClaim(input(), 3, 7);
        stubSourceAsset();
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new AudioSpeedTaskObservation("succeeded",
                        "https://volc/out.m4a", 47.5, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq(AudioSpeedContract.TRANSFER_OUTPUT_FORMAT)))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.m4a", "generated/9/audio/abc.m4a",
                        "audio/mp4", 1L, null));
        when(finalizer.publishAudioSpeedResult(any())).thenReturn(false);

        processor.handle("100");

        verify(finalizer, never()).failAudioSpeedJob(any());
    }

    @Test
    @DisplayName("转存失败（下载 404）→ 1051 兜底，不发布")
    void relayFails_fails() {
        stubPollClaim(input(), 3, 7);
        when(adjustAudioSpeedClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new AudioSpeedTaskObservation("succeeded",
                        "https://volc/out.m4a", 47.5, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq(AudioSpeedContract.TRANSFER_OUTPUT_FORMAT)))
                .thenThrow(new RuntimeException("生成音频下载失败: HTTP 404"));

        processor.handle("100");

        assertFailCode(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED);
        verify(finalizer, never()).publishAudioSpeedResult(any());
    }

    // ========== 瞬时轮询错误判定（视频骨架同语义） ==========

    @Test
    @DisplayName("瞬时判定：provider_timeout / 网络不可达 / HTTP 429/5xx → 瞬时；4xx / 业务失败 → 非瞬时")
    void transientPollErrorClassification() {
        assertThat(AudioSpeedJobProcessor.isTransientPollError(
                new AudioSpeedError(GenerationError.ERROR_PROVIDER_TIMEOUT, "timeout")))
                .isTrue();

        AudioSpeedError unreachable = new AudioSpeedError(
                GenerationError.ERROR_PROVIDER_FAILED, "unreachable");
        unreachable.initCause(new java.net.ConnectException("refused"));
        assertThat(AudioSpeedJobProcessor.isTransientPollError(unreachable)).isTrue();

        for (int status : new int[]{429, 500, 502, 503, 504}) {
            AudioSpeedError serverError = new AudioSpeedError(
                    GenerationError.ERROR_PROVIDER_FAILED, "HTTP " + status);
            serverError.initCause(new NewApiVideoClient.HttpStatusException(status));
            assertThat(AudioSpeedJobProcessor.isTransientPollError(serverError))
                    .as("HTTP %d 应判定瞬时", status).isTrue();
        }

        AudioSpeedError badRequest = new AudioSpeedError(
                GenerationError.ERROR_PROVIDER_FAILED, "HTTP 400");
        badRequest.initCause(new NewApiVideoClient.HttpStatusException(400));
        assertThat(AudioSpeedJobProcessor.isTransientPollError(badRequest)).isFalse();

        assertThat(AudioSpeedJobProcessor.isTransientPollError(
                new AudioSpeedError(AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED, "task failed")))
                .isFalse();
    }
}
