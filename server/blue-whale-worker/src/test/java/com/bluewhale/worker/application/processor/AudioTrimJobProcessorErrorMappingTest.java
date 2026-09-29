package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishAudioTrimDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.AudioTrimContract;
import com.bluewhale.worker.domain.error.AudioTrimError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitTrimAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitTrimAudioClient.TrimAudioTaskObservation;
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
 * AudioTrimJobProcessor 错误码映射与异步链编排测试（IKHB6S，父单 IKHB08；火山 MediaKit
 * trim-audio 执行面，模板 MediaExtractJobProcessorErrorMappingTest 一对一平移）。
 * <p>
 * 覆盖：claim 语义、input 业务键兜底校验（含 start_time / end_time 可选与脏值形态）、
 * 凭证缺失分类、submit 相（提交成功存 task_id + 续排 / §5 信号保留 / 归并 1048）、
 * poll 相（processing 续排进度保持 / 轮询超限 / 瞬时错误重排 / 火山 failed 分类 + 上游
 * 原因透传）、completed 立即转存发布（官方 duration 直取不回落 / md5 穿透）、转存强依赖
 * 与瞬时判定。不连真实 MQ/DB/TOS/网关。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AudioTrimJobProcessorErrorMappingTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobClaimService claimService;
    @Mock private GenerationJobMapper jobMapper;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitTrimAudioClient trimAudioClient;
    @Mock private TosAudioMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private AudioTrimJobProcessor processor;

    private static Map<String, Object> input() {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("start_time", 60.5);
        input.put("end_time", 180.75);
        input.put("output_format", "mp3");
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    @BeforeEach
    void setUp() {
        processor = new AudioTrimJobProcessor(
                stateMachine, claimService, jobMapper, finalizer, new AssetSourceService(assetMapper),
                credentialService, trimAudioClient, mediaRelay, producer);
        when(finalizer.failAudioTrimJob(any())).thenReturn(true);
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
        when(stateMachine.reserveParentReuseSubmit(anyString(), anyString(), anyLong())).thenReturn(true);
    }

    /** 源音频素材（worker 不消费其时长——截取产物时长只取官方 duration，不回落）。 */
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
        return makeClaim(input, providerTaskId, pollCount, progress, null);
    }

    private ClaimedJob makeClaim(Map<String, Object> input, String providerTaskId,
                                             int pollCount, int progress,
                                             String parentProviderTaskId) {
        return new ClaimedJob(
                "100", "42", "9", input, "audio_trim", providerTaskId, false, "worker-1", 5L, pollCount,
                progress, null, null, parentProviderTaskId);
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
        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioTrimDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioTrimDto.class);
        verify(finalizer).failAudioTrimJob(captor.capture());
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
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.empty());

        processor.handle("100");

        verify(finalizer, never()).failAudioTrimJob(any());
        verify(finalizer, never()).publishAudioTrimResult(any());
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
    @DisplayName("output_format 枚举外 → invalid_input（兜底防御）")
    void invalidOutputFormat_invalidInput() {
        Map<String, Object> input = input();
        input.put("output_format", "aac");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
        verify(trimAudioClient, never()).submit(anyString(), anyString(), any(), any(), anyString());
    }

    @Test
    @DisplayName("start_time 脏值（非数字形态）→ invalid_input（可选键存在则须为数字）")
    void dirtyStartTime_invalidInput() {
        Map<String, Object> input = input();
        input.put("start_time", "60.5");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("贴边省略形态：start_time / end_time 双省略 → null 出站（走官方默认片头片尾）")
    void edgeOmitted_submitWithoutTimeKeys() {
        Map<String, Object> input = input();
        input.remove("start_time");
        input.remove("end_time");
        stubSubmitClaim(input);
        stubSourceAsset();
        when(trimAudioClient.submit(eq("sk-frozen-token"), eq("https://example.com/src.mp3"),
                isNull(), isNull(), eq("mp3"))).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(trimAudioClient).submit("sk-frozen-token", "https://example.com/src.mp3",
                null, null, "mp3");
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", AudioTrimJobProcessor.AUDIO_TRIM_POLL_INTERVAL_MS);
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    // ========== 源素材 / 凭证 ==========

    @Test
    @DisplayName("源素材不可用（非 audio）→ 1048 兜底 + 可读原因，不提交上游")
    void sourceAssetNotAudio_failed() {
        stubSubmitClaim(input());
        AssetEntity video = new AssetEntity();
        video.setType("video");
        video.setUrl("https://example.com/src.mp4");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(video);

        processor.handle("100");

        assertFailCode(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
        verify(trimAudioClient, never()).submit(anyString(), anyString(), any(), any(), anyString());
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
    @DisplayName("提交成功：submit 带 audio_url + 时间区间 + output_format → markProviderSubmitted 存 task_id + scheduleNext(5s)")
    void submitSuccess_marksAndSchedules() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(trimAudioClient.submit(eq("sk-frozen-token"), eq("https://example.com/src.mp3"),
                eq(60.5), eq(180.75), eq("mp3"))).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(trimAudioClient).submit("sk-frozen-token", "https://example.com/src.mp3",
                60.5, 180.75, "mp3");
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", AudioTrimJobProcessor.AUDIO_TRIM_POLL_INTERVAL_MS);
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("markProviderSubmitted 守卫未命中（stale worker）→ 不自投下一步")
    void submitGuardMissed_noScheduleNext() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(trimAudioClient.submit(anyString(), anyString(), any(), any(), anyString()))
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
        when(trimAudioClient.submit(anyString(), anyString(), any(), any(), anyString()))
                .thenThrow(new AudioTrimError(GenerationError.ERROR_QUOTA_EXHAUSTED,
                        "音频截取任务提交失败: HTTP 402 剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("submit provider_failed → 归并 1048 兜底（无自动重试）")
    void submitProviderFailed_normalized() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(trimAudioClient.submit(anyString(), anyString(), any(), any(), anyString()))
                .thenThrow(new AudioTrimError(GenerationError.ERROR_PROVIDER_FAILED,
                        "音频截取任务提交失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
    }

    @Test
    @DisplayName("submit 超时（provider_timeout）→ 归并 1048（宁可不重试也不双跑，家族口径）")
    void submitTimeout_normalized() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(trimAudioClient.submit(anyString(), anyString(), any(), any(), anyString()))
                .thenThrow(new AudioTrimError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频截取提交超时"));

        processor.handle("100");

        assertFailCode(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    // ========== 上游 HTTP 状态结构化透传（IKIMN8 / IKIMS3；对齐音频提取 IKIMS2 样板） ==========

    @Test
    @DisplayName("submit 上游 401（cause 携带状态）→ details.http_status=401，message 剥离状态码字样")
    void submitUnauthorized_persistsHttpStatusDetail() {
        stubSubmitClaim(input());
        stubSourceAsset();
        AudioTrimError unauthorized = new AudioTrimError(GenerationError.ERROR_PROVIDER_FAILED,
                "音频截取任务提交失败: HTTP 401 上游凭证被拒绝 request_id=req-sub-7");
        unauthorized.initCause(new NewApiVideoClient.HttpStatusException(401));
        when(trimAudioClient.submit(anyString(), anyString(), any(), any(), anyString()))
                .thenThrow(unauthorized);

        processor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioTrimDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioTrimDto.class);
        verify(finalizer).failAudioTrimJob(captor.capture());
        com.bluewhale.worker.domain.dto.FailAudioTrimDto failure = captor.getValue();
        assertThat(failure.code()).isEqualTo(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
        // 判定只依赖结构化字段：message/raw 不含状态码字样，上游原因与 request_id 保留
        assertThat(failure.message()).doesNotContain("401").contains("上游凭证被拒绝");
        assertThat(failure.details())
                .containsEntry("raw", "音频截取任务提交失败: 上游凭证被拒绝 request_id=req-sub-7")
                .containsEntry("http_status", 401);
    }

    // ========== parent-reuse 重试收割（IKI89Q / ADR-0114；平移 IKI89P 定型用例）==========

    @Test
    @DisplayName("parent-reuse 命中：父任务已成功且结果 URL 齐全 → 不提交，直接转存发布（payload 与正常完成同型）")
    void parentReuseSuccess_publishesWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-1")));
        when(trimAudioClient.poll("sk-frozen-token", "amk-parent-1"))
                .thenReturn(new TrimAudioTaskObservation("succeeded",
                        "https://volc/old-out.mp3?auth_key=...", 120.25, null, null));
        when(mediaRelay.persist("https://volc/old-out.mp3?auth_key=...", "9", "mp3"))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.mp3", "generated/9/audio/abc.mp3",
                        "audio/mpeg", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishAudioTrimResult(any())).thenReturn(true);

        processor.handle("100");

        verify(trimAudioClient, never()).submit(anyString(), anyString(), any(), any(), anyString());
        verify(mediaRelay).persist("https://volc/old-out.mp3?auth_key=...", "9", "mp3");
        ArgumentCaptor<PublishAudioTrimDto> captor =
                ArgumentCaptor.forClass(PublishAudioTrimDto.class);
        verify(finalizer).publishAudioTrimResult(captor.capture());
        PublishAudioTrimDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.mp3");
        assertThat(published.storageKey()).isEqualTo("generated/9/audio/abc.mp3");
        assertThat(published.mime()).isEqualTo("audio/mpeg");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(published.durationSec()).isEqualTo(120.25);
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("parent-reuse 父任务 failed → 回退正常重新提交")
    void parentReuseFailed_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-fail")));
        when(trimAudioClient.poll("sk-frozen-token", "amk-parent-fail"))
                .thenReturn(new TrimAudioTaskObservation("failed", null, null,
                        "InvalidParameter", "The parameter `end_time` must be less than audio duration."));
        stubSourceAsset();
        when(trimAudioClient.submit(anyString(), anyString(), any(), any(), anyString()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(trimAudioClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp3"), eq(60.5), eq(180.75), eq("mp3"));
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("parent-reuse 查询失败后提交前失租，停止执行")
    void parentReuseLeaseLostBeforeSubmit_stops() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-race")));
        when(trimAudioClient.poll("sk-frozen-token", "amk-parent-race"))
                .thenThrow(new RuntimeException("HTTP 503"));
        stubSourceAsset();
        when(stateMachine.reserveParentReuseSubmit("100", "worker-1", 5L)).thenReturn(false);

        processor.handle("100");

        verify(trimAudioClient, never()).submit(anyString(), anyString(), any(), any(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查父任务异常（不存在/网络错）→ 按不存在处理，回退正常重新提交")
    void parentReusePollError_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-gone")));
        when(trimAudioClient.poll("sk-frozen-token", "amk-parent-gone"))
                .thenThrow(new AudioTrimError(GenerationError.ERROR_PROVIDER_FAILED,
                        "MediaKit 音频截取任务查询失败: HTTP 404"));
        stubSourceAsset();
        when(trimAudioClient.submit(anyString(), anyString(), any(), any(), anyString()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(trimAudioClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp3"), eq(60.5), eq(180.75), eq("mp3"));
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("非重试 job（parentProviderTaskId=null）→ 不查父任务，执行路径与现状完全一致")
    void nonRetryJob_skipsParentQuery() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(trimAudioClient.submit(anyString(), anyString(), any(), any(), anyString()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(trimAudioClient, never()).poll(anyString(), anyString());
        verify(trimAudioClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp3"), eq(60.5), eq(180.75), eq("mp3"));
    }

    @Test
    @DisplayName("parent-reuse 父任务成功但结果 URL 为空（结果不齐全）→ 回退正常重新提交")
    void parentReuseIncompleteResult_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-empty")));
        when(trimAudioClient.poll("sk-frozen-token", "amk-parent-empty"))
                .thenReturn(new TrimAudioTaskObservation("succeeded", null, null, null, null));
        stubSourceAsset();
        when(trimAudioClient.submit(anyString(), anyString(), any(), any(), anyString()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(trimAudioClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp3"), eq(60.5), eq(180.75), eq("mp3"));
        verify(mediaRelay, never()).persist(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("parent-reuse 收割发布失败（转存下载 404，URL 超 24h 失效）→ 回退正常重新提交，不落失败终态")
    void parentReusePublishFails_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-stale")));
        when(trimAudioClient.poll("sk-frozen-token", "amk-parent-stale"))
                .thenReturn(new TrimAudioTaskObservation("succeeded",
                        "https://volc/expired-out.mp3", 120.25, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq("mp3")))
                .thenThrow(new RuntimeException("生成音频下载失败: HTTP 404"));
        stubSourceAsset();
        when(trimAudioClient.submit(anyString(), anyString(), any(), any(), anyString()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(trimAudioClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp3"), eq(60.5), eq(180.75), eq("mp3"));
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("parent-reuse 收割发布守卫未命中（publish 返回 false）→ 停止本次执行：不提交、不自投、不落失败终态（IKICD0）")
    void parentReusePublishGuardMissed_stopWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-guard")));
        when(trimAudioClient.poll("sk-frozen-token", "amk-parent-guard"))
                .thenReturn(new TrimAudioTaskObservation("succeeded",
                        "https://volc/old-out.mp3", 120.25, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq("mp3")))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.mp3", "generated/9/audio/abc.mp3",
                        "audio/mpeg", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishAudioTrimResult(any())).thenReturn(false);
        stubSourceAsset();

        processor.handle("100");

        // 失租/已终态守卫未命中 = 停止终局（IKICD0）：不提交、不自投、不落失败，
        // 任务保持 processing 由新 worker 重新领取继续收割
        verify(trimAudioClient, never()).submit(anyString(), anyString(), any(), any(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    // ========== poll 相：状态机 + 进度口径（家族对齐） ==========

    @Test
    @DisplayName("poll processing → rescheduleProviderPoll(进度保持不倒退) + scheduleNext(5s)")
    void pollProcessing_reschedules() {
        stubPollClaim(input(), 3, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new TrimAudioTaskObservation("processing", null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", AudioTrimJobProcessor.AUDIO_TRIM_POLL_INTERVAL_MS);
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("poll 超限（pollCount>=720）→ 1048 轮询超时，不再续排")
    void pollExceedsLimit_fails() {
        stubPollClaim(input(), AudioTrimJobProcessor.MAX_AUDIO_TRIM_POLLS, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new TrimAudioTaskObservation("processing", null, null, null, null));

        processor.handle("100");

        assertFailCode(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）→ reschedule 续排，不落终态")
    void pollTransientError_reschedules() {
        stubPollClaim(input(), 3, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new AudioTrimError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频截取任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", AudioTrimJobProcessor.AUDIO_TRIM_POLL_INTERVAL_MS);
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限（pollCount=719）→ 仍按 5s 续排（次数由 SQL +1，IKI61M）")
    void pollTransientErrorBelowLimit_reschedules() {
        stubPollClaim(input(), AudioTrimJobProcessor.MAX_AUDIO_TRIM_POLLS - 1, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new AudioTrimError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频截取任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", AudioTrimJobProcessor.AUDIO_TRIM_POLL_INTERVAL_MS);
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（pollCount=720）→ 1048 轮询超时 + 不再续排（IKI61M：与 processing 共享预算）")
    void pollTransientErrorAtLimit_fails() {
        stubPollClaim(input(), AudioTrimJobProcessor.MAX_AUDIO_TRIM_POLLS, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new AudioTrimError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频截取任务查询超时"));

        processor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioTrimDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioTrimDto.class);
        verify(finalizer).failAudioTrimJob(captor.capture());
        assertThat(captor.getValue().code())
                .isEqualTo(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
        assertThat(captor.getValue().message())
                .isEqualTo("音频截取轮询超时（超过 "
                        + AudioTrimJobProcessor.MAX_AUDIO_TRIM_POLLS
                        + " 次），上游持续错误: MediaKit 音频截取任务查询超时");
        // 反例钉住缺键语义：无状态 cause（provider_timeout 形态）不写 http_status，只留 raw（IKIN6W）
        assertThat(captor.getValue().details()).doesNotContainKey("http_status").containsKey("raw");
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（HTTP 503 瞬时形态）→ 1048 + details.http_status=503，message 剥离状态码字样（IKIN6W：预算耗尽分支同透传口径）")
    void pollTransientHttp503AtLimit_fails() {
        stubPollClaim(input(), AudioTrimJobProcessor.MAX_AUDIO_TRIM_POLLS, 7);
        AudioTrimError gatewayBusy = new AudioTrimError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 音频截取任务查询失败: HTTP 503");
        gatewayBusy.initCause(new NewApiVideoClient.HttpStatusException(503));
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(gatewayBusy);

        processor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioTrimDto> gatewayCaptor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioTrimDto.class);
        verify(finalizer).failAudioTrimJob(gatewayCaptor.capture());
        assertThat(gatewayCaptor.getValue().code())
                .isEqualTo(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
        // 判定只依赖结构化字段：剥「: HTTP 503」后冒号保留，上游持续错误摘要仍在（可读原因）
        assertThat(gatewayCaptor.getValue().message())
                .isEqualTo("音频截取轮询超时（超过 "
                        + AudioTrimJobProcessor.MAX_AUDIO_TRIM_POLLS
                        + " 次），上游持续错误: MediaKit 音频截取任务查询失败:")
                .doesNotContain("503");
        assertThat(gatewayCaptor.getValue().details())
                .containsEntry("http_status", 503)
                .containsEntry("raw", "音频截取轮询超时（超过 "
                        + AudioTrimJobProcessor.MAX_AUDIO_TRIM_POLLS
                        + " 次），上游持续错误: MediaKit 音频截取任务查询失败:");
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限但 reschedule 守卫未命中（stale worker / fencing 失配）→ 不自投下一步、不落终态")
    void pollTransientErrorGuardMissed_noScheduleNext() {
        stubPollClaim(input(), 3, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new AudioTrimError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频截取任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("poll 硬错误（HTTP 404 任务不存在）→ 1048 兜底")
    void pollHardError_fails() {
        stubPollClaim(input(), 3, 7);
        AudioTrimError notFound = new AudioTrimError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 音频截取任务查询失败: HTTP 404");
        notFound.initCause(new NewApiVideoClient.HttpStatusException(404));
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(notFound);

        processor.handle("100");

        assertFailCode(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
    }

    // ========== poll 相：火山任务 failed（§5 分类映射） ==========

    @Test
    @DisplayName("poll failed（end_time 超真实片尾官方约束拒绝）→ 1048 + 上游可读原因透传（前端投影）")
    void pollFailed_transportsUpstreamReason() {
        stubPollClaim(input(), 3, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new TrimAudioTaskObservation("failed", null, null,
                        "InvalidParameter", "The parameter `end_time` must be less than audio duration."));

        processor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioTrimDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioTrimDto.class);
        verify(finalizer).failAudioTrimJob(captor.capture());
        assertThat(captor.getValue().code())
                .isEqualTo(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
        assertThat(captor.getValue().message())
                .isEqualTo("The parameter `end_time` must be less than audio duration.");
    }

    @Test
    @DisplayName("poll failed + 额度信号 → quota_exhausted（§5 保留）")
    void pollFailedQuotaSignal_preserved() {
        stubPollClaim(input(), 3, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new TrimAudioTaskObservation("failed", null, null,
                        null, "剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("poll failed 无上游原因 → 1048 + 默认文案")
    void pollFailedWithoutReason_fallsBackMessage() {
        stubPollClaim(input(), 3, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new TrimAudioTaskObservation("failed", null, null, null, null));

        processor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioTrimDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioTrimDto.class);
        verify(finalizer).failAudioTrimJob(captor.capture());
        assertThat(captor.getValue().code())
                .isEqualTo(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
        assertThat(captor.getValue().message()).isEqualTo("音频截取任务失败");
    }

    // ========== poll 相：completed → 立即转存 + 终态发布（URL 24h 有效） ==========

    @Test
    @DisplayName("poll completed → persist 按任务格式转存 → 发布 payload：官方 duration 秒 + md5 穿透")
    void pollCompleted_publishesWithOfficialDuration() {
        stubPollClaim(input(), 3, 7);
        stubSourceAsset();
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new TrimAudioTaskObservation("succeeded",
                        "https://volc/out.mp3?auth_key=...", 120.25, null, null));
        when(mediaRelay.persist("https://volc/out.mp3?auth_key=...", "9", "mp3"))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.mp3", "generated/9/audio/abc.mp3",
                        "audio/mpeg", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishAudioTrimResult(any())).thenReturn(true);

        processor.handle("100");

        // URL 24h 有效：completed 后立即转存（同步链路，无续排）
        verify(mediaRelay).persist("https://volc/out.mp3?auth_key=...", "9", "mp3");
        ArgumentCaptor<PublishAudioTrimDto> captor =
                ArgumentCaptor.forClass(PublishAudioTrimDto.class);
        verify(finalizer).publishAudioTrimResult(captor.capture());
        PublishAudioTrimDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.mp3");
        assertThat(published.storageKey()).isEqualTo("generated/9/audio/abc.mp3");
        assertThat(published.mime()).isEqualTo("audio/mpeg");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(published.durationSec()).isEqualTo(120.25);
        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("completed 无官方 duration → duration 直取 null（不回落源时长——截取片段 ≠ 源全长）")
    void pollCompleted_noSourceDurationFallback() {
        stubPollClaim(input(), 3, 7);
        stubSourceAsset();
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new TrimAudioTaskObservation("succeeded",
                        "https://volc/out.mp3", null, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq("mp3")))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.mp3", "generated/9/audio/abc.mp3",
                        "audio/mpeg", 1L, null));
        when(finalizer.publishAudioTrimResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<PublishAudioTrimDto> captor =
                ArgumentCaptor.forClass(PublishAudioTrimDto.class);
        verify(finalizer).publishAudioTrimResult(captor.capture());
        assertThat(captor.getValue().durationSec()).isNull();
    }

    @Test
    @DisplayName("completed 未返回结果音频 URL → 1048 兜底")
    void pollCompletedWithoutUrl_fails() {
        stubPollClaim(input(), 3, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new TrimAudioTaskObservation("succeeded", null, null, null, null));

        processor.handle("100");

        assertFailCode(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
        verify(mediaRelay, never()).persist(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("TOS 未配置 → 1048（结果 URL 24h 失效，强依赖不降级直存）")
    void tosMissing_failsWithoutPassthrough() {
        AudioTrimJobProcessor noRelayProcessor = new AudioTrimJobProcessor(
                stateMachine, claimService, jobMapper, finalizer, new AssetSourceService(assetMapper),
                credentialService, trimAudioClient, null, producer);
        stubPollClaim(input(), 3, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new TrimAudioTaskObservation("succeeded",
                        "https://volc/out.mp3", 120.25, null, null));

        noRelayProcessor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailAudioTrimDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailAudioTrimDto.class);
        verify(finalizer).failAudioTrimJob(captor.capture());
        assertThat(captor.getValue().code())
                .isEqualTo(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
        assertThat(captor.getValue().message()).isEqualTo("音频转存存储未配置");
        verify(finalizer, never()).publishAudioTrimResult(any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubPollClaim(input(), 3, 7);
        stubSourceAsset();
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new TrimAudioTaskObservation("succeeded",
                        "https://volc/out.mp3", 120.25, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq("mp3")))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.mp3", "generated/9/audio/abc.mp3",
                        "audio/mpeg", 1L, null));
        when(finalizer.publishAudioTrimResult(any())).thenReturn(false);

        processor.handle("100");

        verify(finalizer, never()).failAudioTrimJob(any());
    }

    @Test
    @DisplayName("转存失败（下载 404）→ 1048 兜底，不发布")
    void relayFails_fails() {
        stubPollClaim(input(), 3, 7);
        when(trimAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new TrimAudioTaskObservation("succeeded",
                        "https://volc/out.mp3", 120.25, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq("mp3")))
                .thenThrow(new RuntimeException("生成音频下载失败: HTTP 404"));

        processor.handle("100");

        assertFailCode(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED);
        verify(finalizer, never()).publishAudioTrimResult(any());
    }

    // ========== 瞬时轮询错误判定（视频骨架同语义） ==========

    @Test
    @DisplayName("瞬时判定：provider_timeout / 网络不可达 / HTTP 429/5xx → 瞬时；4xx / 业务失败 → 非瞬时")
    void transientPollErrorClassification() {
        assertThat(AudioTrimJobProcessor.isTransientPollError(
                new AudioTrimError(GenerationError.ERROR_PROVIDER_TIMEOUT, "timeout")))
                .isTrue();

        AudioTrimError unreachable = new AudioTrimError(
                GenerationError.ERROR_PROVIDER_FAILED, "unreachable");
        unreachable.initCause(new java.net.ConnectException("refused"));
        assertThat(AudioTrimJobProcessor.isTransientPollError(unreachable)).isTrue();

        for (int status : new int[]{429, 500, 502, 503, 504}) {
            AudioTrimError serverError = new AudioTrimError(
                    GenerationError.ERROR_PROVIDER_FAILED, "HTTP " + status);
            serverError.initCause(new NewApiVideoClient.HttpStatusException(status));
            assertThat(AudioTrimJobProcessor.isTransientPollError(serverError))
                    .as("HTTP %d 应判定瞬时", status).isTrue();
        }

        AudioTrimError badRequest = new AudioTrimError(
                GenerationError.ERROR_PROVIDER_FAILED, "HTTP 400");
        badRequest.initCause(new NewApiVideoClient.HttpStatusException(400));
        assertThat(AudioTrimJobProcessor.isTransientPollError(badRequest)).isFalse();

        assertThat(AudioTrimJobProcessor.isTransientPollError(
                new AudioTrimError(AudioTrimContract.ERROR_AUDIO_TRIM_FAILED, "task failed")))
                .isFalse();
    }
}
