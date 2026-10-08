package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitExtractAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitExtractAudioClient.ExtractAudioTaskObservation;
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
 * MediaExtractJobProcessor 错误码映射与异步链编排测试（迁移契约 §18 / IKH28W；火山
 * MediaKit 执行面，模板 VideoSubtitleEraseJobProcessorTest）。
 * <p>
 * 覆盖：claim 语义、input 业务键兜底校验、凭证缺失分类、submit 相（提交成功存 task_id +
 * 续排 / §5 信号保留 / 归并 1044）、poll 相（processing 续排进度保持 / 轮询超限 / 瞬时错误
 * 重排 / 火山 failed 分类 + 上游原因透传）、completed 立即转存发布（官方 duration / 回落源
 * 时长 / md5 穿透）、转存强依赖与瞬时判定。不连真实 MQ/DB/TOS/网关。
 * <p>
 * 历史：ffmpeg 本地链路时代的细分码用例（video_download_failed / video_too_large /
 * video_has_no_audio_track / extract_failed / upload_failed）随处理器执行面切换移除——
 * 那些码锁定的保留代码（FfmpegExtractor / TosMediaStorage）由各自测试文件锁定（不动）；
 * §18.4 定稿：火山路径无音轨等上游失败一律归并 1044，不单独识别。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MediaExtractJobProcessorErrorMappingTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobClaimService claimService;
    @Mock private GenerationJobMapper jobMapper;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetMapper assetMapper;
    @Mock private UpstreamCredential upstreamCredential;
    @Mock private NewApiMediaKitExtractAudioClient extractAudioClient;
    @Mock private TosAudioMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private MediaExtractJobProcessor processor;

    private static Map<String, Object> input() {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("output_format", "mp3");
        return input;
    }

    @BeforeEach
    void setUp() {
        processor = new MediaExtractJobProcessor(
                stateMachine, claimService, jobMapper, finalizer,
                new AssetSourceService(assetMapper),
                upstreamCredential, extractAudioClient, mediaRelay, producer);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen-token");
        when(stateMachine.reserveParentReuseSubmit(anyString(), anyString(), anyLong())).thenReturn(true);
    }

    /** 源视频素材（时长供结果 duration 回落）。 */
    private void stubSourceAsset() {
        AssetEntity source = new AssetEntity();
        source.setType("video");
        source.setUrl("https://example.com/src.mp4");
        source.setStorageKey("uploads/9/video/src.mp4");
        source.setDurationMs(65_000);
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
                "100", "42", "9", input, "media_extract", providerTaskId, false,
                "worker-1", 5L, pollCount, progress, null, null, parentProviderTaskId);
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
        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), anyString(), any(),
                eq("worker-1"), eq(5L));
        assertThat(code.getValue()).isEqualTo(expectedCode);
    }

    // ========== claim 语义（沿用 IKC9EJ：DB 异常上抛保重投） ==========

    @Test
    @DisplayName("claim 抛 DB 异常 → 上抛（不 fail job，不 ack → 重投）")
    void claimThrowsDbError_propagates() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.empty());

        processor.handle("100");

        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(finalizer, never()).publishMediaExtractResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), any(), any());
    }

    // ========== input 业务键兜底校验（§18.2；权威复核在创建入口） ==========

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
        verify(extractAudioClient, never()).submit(anyString(), anyString(), anyString());
    }

    // ========== 源素材 / 凭证 ==========

    @Test
    @DisplayName("源素材不可用（非 video）→ 1044 兜底 + 可读原因，不提交上游")
    void sourceAssetNotVideo_providerFailed() {
        stubSubmitClaim(input());
        AssetEntity image = new AssetEntity();
        image.setType("image");
        image.setUrl("https://example.com/src.png");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(image);

        processor.handle("100");

        assertFailCode(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        verify(extractAudioClient, never()).submit(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("上游凭证未配置 → provider_credential_missing（不臆造兜底 token）")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = input();
        stubSubmitClaim(input);

        when(upstreamCredential.requireKey())
                .thenThrow(new IllegalStateException(
                        "上游凭证未配置：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key"));
        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }

    // ========== submit 相：提交成功 + 错误归并（§18.4 第一/二类；无自动重试） ==========

    @Test
    @DisplayName("提交成功：submit 带 output_format → markProviderSubmitted 存 task_id + scheduleNext(5s)")
    void submitSuccess_marksAndSchedules() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(extractAudioClient.submit(eq("sk-frozen-token"), eq("https://example.com/src.mp4"),
                eq("mp3"))).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(extractAudioClient).submit("sk-frozen-token", "https://example.com/src.mp4", "mp3");
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", MediaExtractJobProcessor.MEDIA_EXTRACT_POLL_INTERVAL_MS);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("markProviderSubmitted 守卫未命中（stale worker）→ 不自投下一步")
    void submitGuardMissed_noScheduleNext() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(extractAudioClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-1");
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
        when(extractAudioClient.submit(anyString(), anyString(), anyString()))
                .thenThrow(new MediaExtractError(GenerationError.ERROR_QUOTA_EXHAUSTED,
                        "音频提取任务提交失败: HTTP 402 剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("submit provider_failed → 归并 1044 兜底（无自动重试）")
    void submitProviderFailed_normalized() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(extractAudioClient.submit(anyString(), anyString(), anyString()))
                .thenThrow(new MediaExtractError(GenerationError.ERROR_PROVIDER_FAILED,
                        "音频提取任务提交失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
    }

    @Test
    @DisplayName("submit 超时（provider_timeout）→ 归并 1044（宁可不重试也不双跑，家族口径）")
    void submitTimeout_normalized() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(extractAudioClient.submit(anyString(), anyString(), anyString()))
                .thenThrow(new MediaExtractError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频提取提交超时"));

        processor.handle("100");

        assertFailCode(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    // ========== parent-reuse 重试收割（IKI89P / ADR-0114；平移 VideoJobProcessorTest 先例）==========

    @Test
    @DisplayName("parent-reuse 命中：父任务已成功且结果 URL 齐全 → 不提交，直接转存发布（payload 与正常完成同型）")
    void parentReuseSuccess_publishesWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-1")));
        when(extractAudioClient.poll("sk-frozen-token", "amk-parent-1"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded",
                        "https://volc/old-out.mp3?auth_key=...", 65.5, null, null));
        when(mediaRelay.persist("https://volc/old-out.mp3?auth_key=...", "9", "mp3"))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.mp3", "generated/9/audio/abc.mp3",
                        "audio/mpeg", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishMediaExtractResult(anyString(), anyString(), anyString(), anyString(),
                anyLong(), anyString(), anyString(), anyString(), any(), any(), any()))
                .thenReturn(true);

        processor.handle("100");

        verify(extractAudioClient, never()).submit(anyString(), anyString(), anyString());
        verify(mediaRelay).persist("https://volc/old-out.mp3?auth_key=...", "9", "mp3");
        ArgumentCaptor<String> url = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> storageKey = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> mime = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Long> size = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<String> md5 = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Double> duration = ArgumentCaptor.forClass(Double.class);
        verify(finalizer).publishMediaExtractResult(anyString(), anyString(), anyString(), anyString(),
                anyLong(), url.capture(), storageKey.capture(), mime.capture(), size.capture(),
                md5.capture(), duration.capture());
        assertThat(url.getValue()).isEqualTo("https://tos/out.mp3");
        assertThat(storageKey.getValue()).isEqualTo("generated/9/audio/abc.mp3");
        assertThat(mime.getValue()).isEqualTo("audio/mpeg");
        assertThat(size.getValue()).isEqualTo(123_456L);
        assertThat(md5.getValue()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(duration.getValue()).isEqualTo(65.5);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 父任务 failed → 回退正常重新提交")
    void parentReuseFailed_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-fail")));
        when(extractAudioClient.poll("sk-frozen-token", "amk-parent-fail"))
                .thenReturn(new ExtractAudioTaskObservation("failed", null, null,
                        "VideoParseFailed", "输入视频解析失败"));
        stubSourceAsset();
        when(extractAudioClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(extractAudioClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("mp3"));
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查询失败后提交前失租，停止执行")
    void parentReuseLeaseLostBeforeSubmit_stops() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-race")));
        when(extractAudioClient.poll("sk-frozen-token", "amk-parent-race"))
                .thenThrow(new RuntimeException("HTTP 503"));
        stubSourceAsset();
        when(stateMachine.reserveParentReuseSubmit("100", "worker-1", 5L)).thenReturn(false);

        processor.handle("100");

        verify(extractAudioClient, never()).submit(anyString(), anyString(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查父任务异常（不存在/网络错）→ 按不存在处理，回退正常重新提交")
    void parentReusePollError_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-gone")));
        when(extractAudioClient.poll("sk-frozen-token", "amk-parent-gone"))
                .thenThrow(new MediaExtractError(GenerationError.ERROR_PROVIDER_FAILED,
                        "MediaKit 音频提取任务查询失败: HTTP 404"));
        stubSourceAsset();
        when(extractAudioClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(extractAudioClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("mp3"));
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("非重试 job（parentProviderTaskId=null）→ 不查父任务，执行路径与现状完全一致")
    void nonRetryJob_skipsParentQuery() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(extractAudioClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(extractAudioClient, never()).poll(anyString(), anyString());
        verify(extractAudioClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("mp3"));
    }

    @Test
    @DisplayName("parent-reuse 父任务成功但结果 URL 为空（结果不齐全）→ 回退正常重新提交")
    void parentReuseIncompleteResult_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-empty")));
        when(extractAudioClient.poll("sk-frozen-token", "amk-parent-empty"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded", null, null, null, null));
        stubSourceAsset();
        when(extractAudioClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(extractAudioClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("mp3"));
        verify(mediaRelay, never()).persist(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("parent-reuse 收割发布失败（转存下载 404，URL 超 24h 失效）→ 回退正常重新提交，不落失败终态")
    void parentReusePublishFails_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-stale")));
        when(extractAudioClient.poll("sk-frozen-token", "amk-parent-stale"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded",
                        "https://volc/expired-out.mp3", 65.5, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq("mp3")))
                .thenThrow(new RuntimeException("生成音频下载失败: HTTP 404"));
        stubSourceAsset();
        when(extractAudioClient.submit(anyString(), anyString(), anyString())).thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), anyString(), anyLong(), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(extractAudioClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq("mp3"));
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 收割发布守卫未命中（publish 返回 false）→ 停止本次执行：不提交、不自投、不落失败终态（IKICD0）")
    void parentReusePublishGuardMissed_stopWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input(), null, 0, 0, "amk-parent-guard")));
        when(extractAudioClient.poll("sk-frozen-token", "amk-parent-guard"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded",
                        "https://volc/old-out.mp3", 65.5, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq("mp3")))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.mp3", "generated/9/audio/abc.mp3",
                        "audio/mpeg", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishMediaExtractResult(anyString(), anyString(), anyString(), anyString(),
                anyLong(), anyString(), anyString(), anyString(), any(), any(), any()))
                .thenReturn(false);
        stubSourceAsset();

        processor.handle("100");

        // 失租/已终态守卫未命中 = 停止终局（IKICD0）：不提交、不自投、不落失败，
        // 任务保持 processing 由新 worker 重新领取继续收割
        verify(extractAudioClient, never()).submit(anyString(), anyString(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    // ========== poll 相：状态机 + 进度口径（对齐去字幕） ==========

    @Test
    @DisplayName("poll processing → rescheduleProviderPoll(进度保持不倒退) + scheduleNext(5s)")
    void pollProcessing_reschedules() {
        stubPollClaim(input(), 3, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("processing", null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", MediaExtractJobProcessor.MEDIA_EXTRACT_POLL_INTERVAL_MS);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 超限（pollCount>=720）→ 1044 轮询超时，不再续排")
    void pollExceedsLimit_fails() {
        stubPollClaim(input(), MediaExtractJobProcessor.MAX_MEDIA_EXTRACT_POLLS, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("processing", null, null, null, null));

        processor.handle("100");

        assertFailCode(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）→ reschedule 续排，不落终态")
    void pollTransientError_reschedules() {
        stubPollClaim(input(), 3, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new MediaExtractError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频提取任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", MediaExtractJobProcessor.MEDIA_EXTRACT_POLL_INTERVAL_MS);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限（pollCount=719）→ 仍按 5s 续排（次数由 SQL +1，IKI61M）")
    void pollTransientErrorBelowLimit_reschedules() {
        stubPollClaim(input(), MediaExtractJobProcessor.MAX_MEDIA_EXTRACT_POLLS - 1, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new MediaExtractError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频提取任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", MediaExtractJobProcessor.MEDIA_EXTRACT_POLL_INTERVAL_MS);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（pollCount=720）→ 1044 轮询超时 + 不再续排（IKI61M：与 processing 共享预算）")
    void pollTransientErrorAtLimit_fails() {
        stubPollClaim(input(), MediaExtractJobProcessor.MAX_MEDIA_EXTRACT_POLLS, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new MediaExtractError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频提取任务查询超时"));

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.captor();
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(),
                details.capture(), eq("worker-1"), eq(5L));
        assertThat(code.getValue())
                .isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        assertThat(message.getValue())
                .isEqualTo("音频提取轮询超时（超过 "
                        + MediaExtractJobProcessor.MAX_MEDIA_EXTRACT_POLLS
                        + " 次），上游持续错误: MediaKit 音频提取任务查询超时");
        // 反例钉住缺键语义：无状态 cause（provider_timeout 形态）不写 http_status，只留 raw（IKIN6W）
        assertThat(details.getValue()).doesNotContainKey("http_status").containsKey("raw");
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（HTTP 503 瞬时形态）→ 1044 + details.http_status=503，message 剥离状态码字样（IKIN6W：预算耗尽分支同透传口径）")
    void pollTransientHttp503AtLimit_fails() {
        stubPollClaim(input(), MediaExtractJobProcessor.MAX_MEDIA_EXTRACT_POLLS, 7);
        MediaExtractError gatewayBusy = new MediaExtractError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 音频提取任务查询失败: HTTP 503");
        gatewayBusy.initCause(new NewApiVideoClient.HttpStatusException(503));
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(gatewayBusy);

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.captor();
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(),
                details.capture(), eq("worker-1"), eq(5L));
        assertThat(code.getValue())
                .isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        // 判定只依赖结构化字段：剥「: HTTP 503」后冒号保留，上游持续错误摘要仍在（可读原因）
        assertThat(message.getValue())
                .isEqualTo("音频提取轮询超时（超过 "
                        + MediaExtractJobProcessor.MAX_MEDIA_EXTRACT_POLLS
                        + " 次），上游持续错误: MediaKit 音频提取任务查询失败:")
                .doesNotContain("503");
        assertThat(details.getValue())
                .containsEntry("http_status", 503)
                .containsEntry("raw", "音频提取轮询超时（超过 "
                        + MediaExtractJobProcessor.MAX_MEDIA_EXTRACT_POLLS
                        + " 次），上游持续错误: MediaKit 音频提取任务查询失败:");
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限但 reschedule 守卫未命中（stale worker / fencing 失配）→ 不自投下一步、不落终态")
    void pollTransientErrorGuardMissed_noScheduleNext() {
        stubPollClaim(input(), 3, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new MediaExtractError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频提取任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 硬错误（HTTP 404 任务不存在）→ 1044 兜底")
    void pollHardError_fails() {
        stubPollClaim(input(), 3, 7);
        MediaExtractError notFound = new MediaExtractError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 音频提取任务查询失败: HTTP 404");
        notFound.initCause(new NewApiVideoClient.HttpStatusException(404));
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(notFound);

        processor.handle("100");

        assertFailCode(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
    }

    // ========== 上游 HTTP 状态结构化透传（IKIMN8 / IKIMS2；对齐音频混合 IKIHGQ 样板） ==========

    @Test
    @DisplayName("submit 上游 401（cause 携带状态）→ details.http_status=401，message 剥离状态码字样")
    void submitUnauthorized_persistsHttpStatusDetail() {
        stubSubmitClaim(input());
        stubSourceAsset();
        MediaExtractError unauthorized = new MediaExtractError(GenerationError.ERROR_PROVIDER_FAILED,
                "音频提取任务提交失败: HTTP 401 上游凭证被拒绝 request_id=req-sub-7");
        unauthorized.initCause(new NewApiVideoClient.HttpStatusException(401));
        when(extractAudioClient.submit(anyString(), anyString(), anyString())).thenThrow(unauthorized);

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.captor();
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(),
                details.capture(), eq("worker-1"), eq(5L));
        assertThat(code.getValue()).isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        // 判定只依赖结构化字段：message/raw 不含状态码字样，上游原因与 request_id 保留
        assertThat(message.getValue()).doesNotContain("401").contains("上游凭证被拒绝");
        assertThat(details.getValue())
                .containsEntry("raw", "音频提取任务提交失败: 上游凭证被拒绝 request_id=req-sub-7")
                .containsEntry("http_status", 401);
    }

    @Test
    @DisplayName("poll 上游 401（cause 携带状态）→ details.http_status=401，message 剥离状态码字样")
    void pollUnauthorized_persistsHttpStatusDetail() {
        stubPollClaim(input(), 3, 7);
        MediaExtractError unauthorized = new MediaExtractError(GenerationError.ERROR_PROVIDER_FAILED,
                "MediaKit 音频提取任务查询失败: HTTP 401 body={\"error\":{\"message\":\"Incorrect API key\"}}"
                        + " request_id=req-poll-3");
        unauthorized.initCause(new NewApiVideoClient.HttpStatusException(401));
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(unauthorized);

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.captor();
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(),
                details.capture(), eq("worker-1"), eq(5L));
        assertThat(code.getValue()).isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        assertThat(message.getValue()).doesNotContain("401").contains("Incorrect API key");
        assertThat(details.getValue())
                .containsEntry("raw", "MediaKit 音频提取任务查询失败:"
                        + " body={\"error\":{\"message\":\"Incorrect API key\"}} request_id=req-poll-3")
                .containsEntry("http_status", 401);
    }

    @Test
    @DisplayName("submit 超时（非 HTTP 失败，链上无状态 cause）→ details 不写 http_status 键")
    void submitTimeout_noHttpStatusDetailKey() {
        stubSubmitClaim(input());
        stubSourceAsset();
        when(extractAudioClient.submit(anyString(), anyString(), anyString()))
                .thenThrow(new MediaExtractError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 音频提取提交超时"));

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.captor();
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), anyString(),
                details.capture(), eq("worker-1"), eq(5L));
        assertThat(code.getValue()).isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        // 反例钉住缺键语义：非 HTTP 失败（超时/连接失败/业务异常）不写 http_status，只留 raw
        assertThat(details.getValue()).doesNotContainKey("http_status").containsKey("raw");
    }

    // ========== poll 相：火山任务 failed（§18.4 第二类映射） ==========

    @Test
    @DisplayName("poll failed → 1044 + 上游可读原因透传（前端投影）")
    void pollFailed_transportsUpstreamReason() {
        stubPollClaim(input(), 3, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("failed", null, null,
                        "VideoParseFailed", "输入视频解析失败，请更换素材后重试"));

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(), any(),
                eq("worker-1"), eq(5L));
        assertThat(code.getValue())
                .isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        assertThat(message.getValue()).isEqualTo("输入视频解析失败，请更换素材后重试");
    }

    @Test
    @DisplayName("poll failed + 额度信号 → quota_exhausted（§5 保留）")
    void pollFailedQuotaSignal_preserved() {
        stubPollClaim(input(), 3, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("failed", null, null,
                        null, "剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("poll failed 无上游原因 → 1044 + 默认文案")
    void pollFailedWithoutReason_fallsBackMessage() {
        stubPollClaim(input(), 3, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("failed", null, null, null, null));

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(), any(),
                eq("worker-1"), eq(5L));
        assertThat(code.getValue())
                .isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        assertThat(message.getValue()).isEqualTo("音频提取任务失败");
    }

    // ========== poll 相：completed → 立即转存 + 终态发布（URL 24h 有效） ==========

    @Test
    @DisplayName("poll completed → persist 按任务格式转存 → 发布 payload：官方 duration 秒 + md5 穿透")
    void pollCompleted_publishesWithOfficialDuration() {
        stubPollClaim(input(), 3, 7);
        stubSourceAsset();
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded",
                        "https://volc/out.mp3?auth_key=...", 65.5, null, null));
        when(mediaRelay.persist("https://volc/out.mp3?auth_key=...", "9", "mp3"))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.mp3", "generated/9/audio/abc.mp3",
                        "audio/mpeg", 123_456L, "0123456789abcdef0123456789abcdef"));
        when(finalizer.publishMediaExtractResult(anyString(), anyString(), anyString(), anyString(),
                anyLong(), anyString(), anyString(), anyString(), any(), any(), any()))
                .thenReturn(true);

        processor.handle("100");

        // URL 24h 有效：completed 后立即转存（同步链路，无续排）
        verify(mediaRelay).persist("https://volc/out.mp3?auth_key=...", "9", "mp3");
        ArgumentCaptor<String> url = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> storageKey = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> mime = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Long> size = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<String> md5 = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Double> duration = ArgumentCaptor.forClass(Double.class);
        verify(finalizer).publishMediaExtractResult(anyString(), anyString(), anyString(), anyString(),
                anyLong(), url.capture(), storageKey.capture(), mime.capture(), size.capture(),
                md5.capture(), duration.capture());
        assertThat(url.getValue()).isEqualTo("https://tos/out.mp3");
        assertThat(storageKey.getValue()).isEqualTo("generated/9/audio/abc.mp3");
        assertThat(mime.getValue()).isEqualTo("audio/mpeg");
        assertThat(size.getValue()).isEqualTo(123_456L);
        assertThat(md5.getValue()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(duration.getValue()).isEqualTo(65.5);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("completed 无官方 duration → 回落源 duration_ms 换算秒")
    void pollCompleted_fallsBackToSourceDuration() {
        stubPollClaim(input(), 3, 7);
        stubSourceAsset();
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded",
                        "https://volc/out.mp3", null, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq("mp3")))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.mp3", "generated/9/audio/abc.mp3",
                        "audio/mpeg", 1L, null));
        when(finalizer.publishMediaExtractResult(anyString(), anyString(), anyString(), anyString(),
                anyLong(), anyString(), anyString(), anyString(), any(), any(), any()))
                .thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<Double> duration = ArgumentCaptor.forClass(Double.class);
        verify(finalizer).publishMediaExtractResult(anyString(), anyString(), anyString(), anyString(),
                anyLong(), anyString(), anyString(), anyString(), any(), any(),
                duration.capture());
        assertThat(duration.getValue()).isEqualTo(65.0);
    }

    @Test
    @DisplayName("completed 未返回结果音频 URL → 1044 兜底")
    void pollCompletedWithoutUrl_fails() {
        stubPollClaim(input(), 3, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded", null, null, null, null));

        processor.handle("100");

        assertFailCode(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        verify(mediaRelay, never()).persist(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("TOS 未配置 → 1044（结果 URL 24h 失效，强依赖不降级直存）")
    void tosMissing_failsWithoutPassthrough() {
        MediaExtractJobProcessor noRelayProcessor = new MediaExtractJobProcessor(
                stateMachine, claimService, jobMapper, finalizer,
                new AssetSourceService(assetMapper),
                upstreamCredential, extractAudioClient, null, producer);
        stubPollClaim(input(), 3, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded",
                        "https://volc/out.mp3", 65.5, null, null));

        noRelayProcessor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(), any(),
                eq("worker-1"), eq(5L));
        assertThat(code.getValue())
                .isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        assertThat(message.getValue()).isEqualTo("音频转存存储未配置");
        verify(finalizer, never()).publishMediaExtractResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), any(), any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubPollClaim(input(), 3, 7);
        stubSourceAsset();
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded",
                        "https://volc/out.mp3", 65.5, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq("mp3")))
                .thenReturn(new TosAudioMediaRelay.StoredAudio(
                        "https://tos/out.mp3", "generated/9/audio/abc.mp3",
                        "audio/mpeg", 1L, null));
        when(finalizer.publishMediaExtractResult(anyString(), anyString(), anyString(), anyString(),
                anyLong(), anyString(), anyString(), anyString(), any(), any(), any()))
                .thenReturn(false);

        processor.handle("100");

        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("转存失败（下载 404）→ 1044 兜底，不发布")
    void relayFails_fails() {
        stubPollClaim(input(), 3, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded",
                        "https://volc/out.mp3", 65.5, null, null));
        when(mediaRelay.persist(anyString(), eq("9"), eq("mp3")))
                .thenThrow(new RuntimeException("生成音频下载失败: HTTP 404"));

        processor.handle("100");

        assertFailCode(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        verify(finalizer, never()).publishMediaExtractResult(anyString(), anyString(), anyString(),
                anyString(), anyLong(), anyString(), anyString(), anyString(), any(), any(), any());
    }

    // ========== 瞬时轮询错误判定（视频骨架同语义） ==========

    @Test
    @DisplayName("瞬时判定：provider_timeout / 网络不可达 / HTTP 429/5xx → 瞬时；4xx / 业务失败 → 非瞬时")
    void transientPollErrorClassification() {
        assertThat(MediaExtractJobProcessor.isTransientPollError(
                new MediaExtractError(GenerationError.ERROR_PROVIDER_TIMEOUT, "timeout")))
                .isTrue();

        MediaExtractError unreachable = new MediaExtractError(
                GenerationError.ERROR_PROVIDER_FAILED, "unreachable");
        unreachable.initCause(new java.net.ConnectException("refused"));
        assertThat(MediaExtractJobProcessor.isTransientPollError(unreachable)).isTrue();

        for (int status : new int[]{429, 500, 502, 503, 504}) {
            MediaExtractError serverError = new MediaExtractError(
                    GenerationError.ERROR_PROVIDER_FAILED, "HTTP " + status);
            serverError.initCause(new NewApiVideoClient.HttpStatusException(status));
            assertThat(MediaExtractJobProcessor.isTransientPollError(serverError))
                    .as("HTTP %d 应判定瞬时", status).isTrue();
        }

        MediaExtractError badRequest = new MediaExtractError(
                GenerationError.ERROR_PROVIDER_FAILED, "HTTP 400");
        badRequest.initCause(new NewApiVideoClient.HttpStatusException(400));
        assertThat(MediaExtractJobProcessor.isTransientPollError(badRequest)).isFalse();

        assertThat(MediaExtractJobProcessor.isTransientPollError(
                new MediaExtractError(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED,
                        "task failed")))
                .isFalse();
    }
}
