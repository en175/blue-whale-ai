package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitExtractAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitExtractAudioClient.ExtractAudioTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
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
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitExtractAudioClient extractAudioClient;
    @Mock private TosAudioMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private MediaExtractJobProcessor processor;

    private static Map<String, Object> input() {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("output_format", "mp3");
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    @BeforeEach
    void setUp() {
        processor = new MediaExtractJobProcessor(
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, extractAudioClient, mediaRelay, producer);
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
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

    private ClaimedMediaExtractJobDto makeClaim(Map<String, Object> input, String providerTaskId,
                                                int pollCount, int progress) {
        return new ClaimedMediaExtractJobDto(
                "100", "42", "9", input, providerTaskId, "worker-1", 5L, pollCount, progress);
    }

    private void stubSubmitClaim(Map<String, Object> input) {
        when(stateMachine.claimMediaExtract(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, null, 0, 0)));
    }

    private void stubPollClaim(Map<String, Object> input, int pollCount, int progress) {
        when(stateMachine.claimMediaExtract(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input, "amk-task-1", pollCount, progress)));
    }

    private void assertFailCode(String expectedCode) {
        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailMediaExtractDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo(expectedCode);
    }

    // ========== claim 语义（沿用 IKC9EJ：DB 异常上抛保重投） ==========

    @Test
    @DisplayName("claim 抛 DB 异常 → 上抛（不 fail job，不 ack → 重投）")
    void claimThrowsDbError_propagates() {
        when(stateMachine.claimMediaExtract(eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(stateMachine, never()).failMediaExtractJob(any());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(stateMachine.claimMediaExtract(eq("100"), anyString()))
                .thenReturn(Optional.empty());

        processor.handle("100");

        verify(stateMachine, never()).failMediaExtractJob(any());
        verify(stateMachine, never()).publishMediaExtractResult(any());
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
    @DisplayName("缺冻结凭证 → provider_credential_missing（不臆造兜底 token）")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = input();
        input.remove("provider_credential");
        stubSubmitClaim(input);

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
        verify(stateMachine, never()).failMediaExtractJob(any());
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
        verify(stateMachine, never()).failMediaExtractJob(any());
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
        verify(stateMachine, never()).failMediaExtractJob(any());
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

    // ========== poll 相：火山任务 failed（§18.4 第二类映射） ==========

    @Test
    @DisplayName("poll failed → 1044 + 上游可读原因透传（前端投影）")
    void pollFailed_transportsUpstreamReason() {
        stubPollClaim(input(), 3, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("failed", null, null,
                        "VideoParseFailed", "输入视频解析失败，请更换素材后重试"));

        processor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailMediaExtractDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code())
                .isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        assertThat(captor.getValue().message()).isEqualTo("输入视频解析失败，请更换素材后重试");
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

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailMediaExtractDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code())
                .isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        assertThat(captor.getValue().message()).isEqualTo("音频提取任务失败");
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
        when(stateMachine.publishMediaExtractResult(any())).thenReturn(true);

        processor.handle("100");

        // URL 24h 有效：completed 后立即转存（同步链路，无续排）
        verify(mediaRelay).persist("https://volc/out.mp3?auth_key=...", "9", "mp3");
        ArgumentCaptor<PublishMediaExtractDto> captor =
                ArgumentCaptor.forClass(PublishMediaExtractDto.class);
        verify(stateMachine).publishMediaExtractResult(captor.capture());
        PublishMediaExtractDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/out.mp3");
        assertThat(published.storageKey()).isEqualTo("generated/9/audio/abc.mp3");
        assertThat(published.mime()).isEqualTo("audio/mpeg");
        assertThat(published.size()).isEqualTo(123_456L);
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(published.duration()).isEqualTo(65.5);
        verify(stateMachine, never()).failMediaExtractJob(any());
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
        when(stateMachine.publishMediaExtractResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<PublishMediaExtractDto> captor =
                ArgumentCaptor.forClass(PublishMediaExtractDto.class);
        verify(stateMachine).publishMediaExtractResult(captor.capture());
        assertThat(captor.getValue().duration()).isEqualTo(65.0);
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
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, extractAudioClient, null, producer);
        stubPollClaim(input(), 3, 7);
        when(extractAudioClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new ExtractAudioTaskObservation("succeeded",
                        "https://volc/out.mp3", 65.5, null, null));

        noRelayProcessor.handle("100");

        ArgumentCaptor<com.bluewhale.worker.domain.dto.FailMediaExtractDto> captor =
                ArgumentCaptor.forClass(com.bluewhale.worker.domain.dto.FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code())
                .isEqualTo(MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED);
        assertThat(captor.getValue().message()).isEqualTo("音频转存存储未配置");
        verify(stateMachine, never()).publishMediaExtractResult(any());
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
        when(stateMachine.publishMediaExtractResult(any())).thenReturn(false);

        processor.handle("100");

        verify(stateMachine, never()).failMediaExtractJob(any());
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
        verify(stateMachine, never()).publishMediaExtractResult(any());
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
