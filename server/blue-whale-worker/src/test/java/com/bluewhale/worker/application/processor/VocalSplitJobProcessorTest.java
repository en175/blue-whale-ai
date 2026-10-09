package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishVocalSplitDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.VocalSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VocalSplitError;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSeparateVoiceClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSeparateVoiceClient.SeparateVoiceTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
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
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class VocalSplitJobProcessorTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobClaimService claimService;
    @Mock private GenerationJobMapper jobMapper;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetMapper assetMapper;
    @Mock private UpstreamCredential upstreamCredential;
    @Mock private NewApiMediaKitSeparateVoiceClient separateVoiceClient;
    @Mock private TosAudioMediaRelay mediaRelay;
    @Mock private GenerationMessageProducer producer;

    private VocalSplitJobProcessor processor;

    private static Map<String, Object> input(String scene) {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("scene", scene);
        input.put("output_format", "aac");
        return input;
    }

    @BeforeEach
    void setUp() {
        processor = new VocalSplitJobProcessor(
                stateMachine, claimService, jobMapper, finalizer,
                new AssetSourceService(assetMapper),
                upstreamCredential, separateVoiceClient, mediaRelay, producer);
        when(finalizer.failMediaExtractJob(anyString(), anyString(), anyString(), any(), anyString(),
                anyLong())).thenReturn(true);
        when(upstreamCredential.requireKey()).thenReturn("sk-frozen-token");
        when(stateMachine.reserveParentReuseSubmit(anyString(), anyString(), anyLong())).thenReturn(true);
    }

    private void stubSourceAsset(String type) {
        AssetEntity source = new AssetEntity();
        source.setType(type);
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
                "100", "42", "9", input, "vocal_split", providerTaskId, false,
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
        verify(finalizer, never()).publishVocalSplitResult(any());
    }


    @Test
    @DisplayName("缺少 source_asset_id → invalid_input")
    void missingSourceAssetId_invalidInput() {
        Map<String, Object> input = input("audio");
        input.remove("source_asset_id");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("scene 枚举外（官方大写 Audio 不内收）→ invalid_input（兜底防御）")
    void invalidScene_invalidInput() {
        Map<String, Object> input = input("Audio");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
        verify(separateVoiceClient, never()).submit(anyString(), anyString(), anyBoolean(),
                anyString(), anyString());
    }

    @Test
    @DisplayName("output_format 枚举外（ogg 是 media_extract 面）→ invalid_input（兜底防御）")
    void invalidOutputFormat_invalidInput() {
        Map<String, Object> input = input("audio");
        input.put("output_format", "ogg");
        stubSubmitClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
        verify(separateVoiceClient, never()).submit(anyString(), anyString(), anyBoolean(),
                anyString(), anyString());
    }


    @Test
    @DisplayName("源素材不可用（图片）→ 1047 兜底 + 可读原因，不提交上游")
    void sourceAssetNotMedia_providerFailed() {
        stubSubmitClaim(input("audio"));
        AssetEntity image = new AssetEntity();
        image.setType("image");
        image.setUrl("https://example.com/src.png");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(image);

        processor.handle("100");

        assertFailCode(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
        verify(separateVoiceClient, never()).submit(anyString(), anyString(), anyBoolean(),
                anyString(), anyString());
    }

    @Test
    @DisplayName("纯音频源素材可用 → 出站 audio_url（sourceIsVideo=false）")
    void audioSourceSubmitsWithAudioUrl() {
        stubSubmitClaim(input("music"));
        stubSourceAsset("audio");
        when(separateVoiceClient.submit(eq("sk-frozen-token"), eq("https://example.com/src.mp4"),
                eq(false), eq("music"), eq("aac"))).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(separateVoiceClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                false, "music", "aac");
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
    }

    @Test
    @DisplayName("上游凭证未配置 → provider_credential_missing（不臆造兜底 token）")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = input("audio");
        stubSubmitClaim(input);

        when(upstreamCredential.requireKey())
                .thenThrow(new IllegalStateException(
                        "上游凭证未配置：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key"));
        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }


    @Test
    @DisplayName("提交成功：submit 带产品小写 scene + output_format → markProviderSubmitted 存 task_id + scheduleNext(5s)")
    void submitSuccess_marksAndSchedules() {
        stubSubmitClaim(input("drama"));
        stubSourceAsset("video");
        when(separateVoiceClient.submit(eq("sk-frozen-token"), eq("https://example.com/src.mp4"),
                eq(true), eq("drama"), eq("aac"))).thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(separateVoiceClient).submit("sk-frozen-token", "https://example.com/src.mp4",
                true, "drama", "aac");
        verify(stateMachine).markProviderSubmitted("100", "worker-1", 5L, "amk-task-1");
        verify(producer).enqueue("100", VocalSplitJobProcessor.VOCAL_SPLIT_POLL_INTERVAL_MS);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("markProviderSubmitted 守卫未命中（stale worker）→ 不自投下一步")
    void submitGuardMissed_noScheduleNext() {
        stubSubmitClaim(input("audio"));
        stubSourceAsset("video");
        when(separateVoiceClient.submit(anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("submit quota_exhausted → 保留既有码投影（§5 信号）")
    void submitQuotaExhausted_preserved() {
        stubSubmitClaim(input("audio"));
        stubSourceAsset("video");
        when(separateVoiceClient.submit(anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenThrow(new VocalSplitError(GenerationError.ERROR_QUOTA_EXHAUSTED,
                        "人声背景分离任务提交失败: HTTP 402 剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("submit provider_failed → 归并 1047 兜底（无自动重试）")
    void submitProviderFailed_normalized() {
        stubSubmitClaim(input("audio"));
        stubSourceAsset("video");
        when(separateVoiceClient.submit(anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenThrow(new VocalSplitError(GenerationError.ERROR_PROVIDER_FAILED,
                        "人声背景分离任务提交失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
    }

    @Test
    @DisplayName("submit 超时（provider_timeout）→ 归并 1047（宁可不重试也不双跑，家族口径）")
    void submitTimeout_normalized() {
        stubSubmitClaim(input("audio"));
        stubSourceAsset("video");
        when(separateVoiceClient.submit(anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenThrow(new VocalSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 人声背景分离提交超时"));

        processor.handle("100");

        assertFailCode(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
        verify(producer, never()).enqueue(anyString(), anyLong());
    }


    @Test
    @DisplayName("submit 上游 401（cause 携带状态）→ details.http_status=401，message 剥离状态码字样")
    void submitUnauthorized_persistsHttpStatusDetail() {
        stubSubmitClaim(input("audio"));
        stubSourceAsset("video");
        VocalSplitError unauthorized = new VocalSplitError(GenerationError.ERROR_PROVIDER_FAILED,
                "人声背景分离任务提交失败: HTTP 401 上游凭证被拒绝 request_id=req-sub-7");
        unauthorized.initCause(new NewApiVideoClient.HttpStatusException(401));
        when(separateVoiceClient.submit(anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenThrow(unauthorized);

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.captor();
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(),
                details.capture(), eq("worker-1"), eq(5L));
        assertThat(code.getValue()).isEqualTo(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
        assertThat(message.getValue()).doesNotContain("401").contains("上游凭证被拒绝");
        assertThat(details.getValue())
                .containsEntry("raw", "人声背景分离任务提交失败: 上游凭证被拒绝 request_id=req-sub-7")
                .containsEntry("http_status", 401);
    }


    @Test
    @DisplayName("parent-reuse 命中：父任务已成功且轨数组齐全 → 不提交，直接逐轨转存发布（payload 与正常完成同型）")
    void parentReuseSuccess_publishesWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("audio"), null, 0, 0, "amk-parent-1")));
        when(separateVoiceClient.poll("sk-frozen-token", "amk-parent-1"))
                .thenReturn(twoTrackObservation(65.5));
        when(mediaRelay.persist("https://volc/voice.aac?auth_key=...", "9", "aac"))
                .thenReturn(stored("voice"));
        when(mediaRelay.persist("https://volc/background.aac?auth_key=...", "9", "aac"))
                .thenReturn(stored("bg"));
        when(finalizer.publishVocalSplitResult(any())).thenReturn(true);

        processor.handle("100");

        verify(separateVoiceClient, never()).submit(anyString(), anyString(), anyBoolean(),
                anyString(), anyString());
        verify(mediaRelay).persist("https://volc/voice.aac?auth_key=...", "9", "aac");
        verify(mediaRelay).persist("https://volc/background.aac?auth_key=...", "9", "aac");
        ArgumentCaptor<PublishVocalSplitDto> captor =
                ArgumentCaptor.forClass(PublishVocalSplitDto.class);
        verify(finalizer).publishVocalSplitResult(captor.capture());
        PublishVocalSplitDto published = captor.getValue();
        assertThat(published.tracks()).hasSize(2);
        assertThat(published.tracks().get(0).trackType()).isEqualTo("voice");
        assertThat(published.tracks().get(0).url()).isEqualTo("https://tos/out-voice");
        assertThat(published.tracks().get(1).trackType()).isEqualTo("background");
        assertThat(published.tracks().get(1).durationSec()).isEqualTo(65.5);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 父任务 failed → 回退正常重新提交")
    void parentReuseFailed_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("audio"), null, 0, 0, "amk-parent-fail")));
        when(separateVoiceClient.poll("sk-frozen-token", "amk-parent-fail"))
                .thenReturn(new SeparateVoiceTaskObservation("failed", null, null,
                        "AudioParseFailed", "输入音频解析失败"));
        stubSourceAsset("video");
        when(separateVoiceClient.submit(anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(separateVoiceClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq(true), eq("audio"), eq("aac"));
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查询失败后提交前失租，停止执行")
    void parentReuseLeaseLostBeforeSubmit_stops() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("audio"), null, 0, 0, "amk-parent-race")));
        when(separateVoiceClient.poll("sk-frozen-token", "amk-parent-race"))
                .thenThrow(new RuntimeException("HTTP 503"));
        stubSourceAsset("video");
        when(stateMachine.reserveParentReuseSubmit("100", "worker-1", 5L)).thenReturn(false);

        processor.handle("100");

        verify(separateVoiceClient, never()).submit(anyString(), anyString(), anyBoolean(), anyString(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 查父任务异常（不存在/网络错）→ 按不存在处理，回退正常重新提交")
    void parentReusePollError_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("audio"), null, 0, 0, "amk-parent-gone")));
        when(separateVoiceClient.poll("sk-frozen-token", "amk-parent-gone"))
                .thenThrow(new VocalSplitError(GenerationError.ERROR_PROVIDER_FAILED,
                        "MediaKit 人声背景分离任务查询失败: HTTP 404"));
        stubSourceAsset("video");
        when(separateVoiceClient.submit(anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(separateVoiceClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq(true), eq("audio"), eq("aac"));
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("非重试 job（parentProviderTaskId=null）→ 不查父任务，执行路径与现状完全一致")
    void nonRetryJob_skipsParentQuery() {
        stubSubmitClaim(input("audio"));
        stubSourceAsset("video");
        when(separateVoiceClient.submit(anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenReturn("amk-task-1");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-1")))
                .thenReturn(true);

        processor.handle("100");

        verify(separateVoiceClient, never()).poll(anyString(), anyString());
        verify(separateVoiceClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq(true), eq("audio"), eq("aac"));
    }

    @Test
    @DisplayName("parent-reuse 父任务成功但轨数组不齐（drama 场景缺 sfx 轨）→ 回退正常重新提交")
    void parentReuseIncompleteResult_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("drama"), null, 0, 0, "amk-parent-empty")));
        Map<String, String> trackUrls = new LinkedHashMap<>();
        trackUrls.put("voice", "https://volc/voice.aac");
        trackUrls.put("music", "https://volc/music.aac");
        when(separateVoiceClient.poll("sk-frozen-token", "amk-parent-empty"))
                .thenReturn(new SeparateVoiceTaskObservation("succeeded", trackUrls, 95.0,
                        null, null));
        stubSourceAsset("video");
        when(separateVoiceClient.submit(anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(separateVoiceClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq(true), eq("drama"), eq("aac"));
        verify(mediaRelay, never()).persist(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("parent-reuse 收割发布失败（轨转存下载 404，URL 超 24h 失效）→ 回退正常重新提交，不落失败终态")
    void parentReusePublishFails_fallThrough() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("audio"), null, 0, 0, "amk-parent-stale")));
        when(separateVoiceClient.poll("sk-frozen-token", "amk-parent-stale"))
                .thenReturn(twoTrackObservation(65.5));
        when(mediaRelay.persist(anyString(), eq("9"), eq("aac")))
                .thenThrow(new RuntimeException("生成音频下载失败: HTTP 404"));
        stubSourceAsset("video");
        when(separateVoiceClient.submit(anyString(), anyString(), anyBoolean(), anyString(), anyString()))
                .thenReturn("amk-task-new");
        when(stateMachine.markProviderSubmitted(eq("100"), eq("worker-1"), eq(5L), eq("amk-task-new")))
                .thenReturn(true);

        processor.handle("100");

        verify(separateVoiceClient).submit(eq("sk-frozen-token"),
                eq("https://example.com/src.mp4"), eq(true), eq("audio"), eq("aac"));
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("parent-reuse 收割发布守卫未命中（publish 返回 false）→ 停止本次执行：不提交、不自投、不落失败终态（IKICD0）")
    void parentReusePublishGuardMissed_stopWithoutSubmit() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input("audio"), null, 0, 0, "amk-parent-guard")));
        when(separateVoiceClient.poll("sk-frozen-token", "amk-parent-guard"))
                .thenReturn(twoTrackObservation(65.5));
        when(mediaRelay.persist(anyString(), eq("9"), eq("aac"))).thenReturn(stored("v"));
        when(finalizer.publishVocalSplitResult(any())).thenReturn(false);
        stubSourceAsset("video");

        processor.handle("100");

        verify(separateVoiceClient, never()).submit(anyString(), anyString(), anyBoolean(),
                anyString(), anyString());
        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }


    @Test
    @DisplayName("poll processing → rescheduleProviderPoll(进度保持不倒退) + scheduleNext(5s)")
    void pollProcessing_reschedules() {
        stubPollClaim(input("audio"), 3, 7);
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SeparateVoiceTaskObservation("processing", null, null, null, null));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", VocalSplitJobProcessor.VOCAL_SPLIT_POLL_INTERVAL_MS);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 超限（pollCount>=720 ≈ 60 分钟窗口）→ 1047 轮询超时，不再续排")
    void pollExceedsLimit_fails() {
        stubPollClaim(input("audio"), VocalSplitJobProcessor.MAX_VOCAL_SPLIT_POLLS, 7);
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SeparateVoiceTaskObservation("processing", null, null, null, null));

        processor.handle("100");

        assertFailCode(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误（provider_timeout）→ reschedule 续排，不落终态")
    void pollTransientError_reschedules() {
        stubPollClaim(input("audio"), 3, 7);
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VocalSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 人声背景分离任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", VocalSplitJobProcessor.VOCAL_SPLIT_POLL_INTERVAL_MS);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限（pollCount=719）→ 仍按 5s 续排（次数由 SQL +1，IKI61M）")
    void pollTransientErrorBelowLimit_reschedules() {
        stubPollClaim(input("audio"), VocalSplitJobProcessor.MAX_VOCAL_SPLIT_POLLS - 1, 7);
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VocalSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 人声背景分离任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(true);

        processor.handle("100");

        verify(stateMachine).rescheduleProviderPoll("100", "worker-1", 5L, 7);
        verify(producer).enqueue("100", VocalSplitJobProcessor.VOCAL_SPLIT_POLL_INTERVAL_MS);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（pollCount=720）→ 1047 轮询超时 + 不再续排（IKI61M：与 processing 共享预算）")
    void pollTransientErrorAtLimit_fails() {
        stubPollClaim(input("audio"), VocalSplitJobProcessor.MAX_VOCAL_SPLIT_POLLS, 7);
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VocalSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 人声背景分离任务查询超时"));

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.captor();
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(),
                details.capture(), eq("worker-1"), eq(5L));
        assertThat(code.getValue())
                .isEqualTo(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
        assertThat(message.getValue())
                .isEqualTo("人声背景分离轮询超时（超过 "
                        + VocalSplitJobProcessor.MAX_VOCAL_SPLIT_POLLS
                        + " 次），上游持续错误: MediaKit 人声背景分离任务查询超时");
        assertThat(details.getValue()).doesNotContainKey("http_status").containsKey("raw");
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误达上限（HTTP 503 瞬时形态）→ 1047 + details.http_status=503，message 剥离状态码字样（IKIN6W：预算耗尽分支同透传口径）")
    void pollTransientHttp503AtLimit_fails() {
        stubPollClaim(input("audio"), VocalSplitJobProcessor.MAX_VOCAL_SPLIT_POLLS, 7);
        VocalSplitError gatewayBusy = new VocalSplitError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 人声背景分离任务查询失败: HTTP 503");
        gatewayBusy.initCause(new NewApiVideoClient.HttpStatusException(503));
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(gatewayBusy);

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.captor();
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(),
                details.capture(), eq("worker-1"), eq(5L));
        assertThat(code.getValue())
                .isEqualTo(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
        assertThat(message.getValue())
                .isEqualTo("人声背景分离轮询超时（超过 "
                        + VocalSplitJobProcessor.MAX_VOCAL_SPLIT_POLLS
                        + " 次），上游持续错误: MediaKit 人声背景分离任务查询失败:")
                .doesNotContain("503");
        assertThat(details.getValue())
                .containsEntry("http_status", 503)
                .containsEntry("raw", "人声背景分离轮询超时（超过 "
                        + VocalSplitJobProcessor.MAX_VOCAL_SPLIT_POLLS
                        + " 次），上游持续错误: MediaKit 人声背景分离任务查询失败:");
        verify(stateMachine, never()).rescheduleProviderPoll(anyString(), anyString(), anyLong(), anyInt());
        verify(producer, never()).enqueue(anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 瞬时错误未超限但 reschedule 守卫未命中（stale worker / fencing 失配）→ 不自投下一步、不落终态")
    void pollTransientErrorGuardMissed_noScheduleNext() {
        stubPollClaim(input("audio"), 3, 7);
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenThrow(new VocalSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 人声背景分离任务查询超时"));
        when(stateMachine.rescheduleProviderPoll(eq("100"), eq("worker-1"), eq(5L), anyInt()))
                .thenReturn(false);

        processor.handle("100");

        verify(producer, never()).enqueue(anyString(), anyLong());
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("poll 硬错误（HTTP 404 任务不存在）→ 1047 兜底")
    void pollHardError_fails() {
        stubPollClaim(input("audio"), 3, 7);
        VocalSplitError notFound = new VocalSplitError(
                GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 人声背景分离任务查询失败: HTTP 404");
        notFound.initCause(new NewApiVideoClient.HttpStatusException(404));
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1")).thenThrow(notFound);

        processor.handle("100");

        assertFailCode(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
    }


    @Test
    @DisplayName("poll failed → 1047 + 上游可读原因透传（前端投影）")
    void pollFailed_transportsUpstreamReason() {
        stubPollClaim(input("audio"), 3, 7);
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SeparateVoiceTaskObservation("failed", null, null,
                        "AudioParseFailed", "输入音频解析失败，请更换素材后重试"));

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(), any(),
                eq("worker-1"), eq(5L));
        assertThat(code.getValue())
                .isEqualTo(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
        assertThat(message.getValue()).isEqualTo("输入音频解析失败，请更换素材后重试");
    }

    @Test
    @DisplayName("poll failed + 额度信号 → quota_exhausted（§5 保留）")
    void pollFailedQuotaSignal_preserved() {
        stubPollClaim(input("audio"), 3, 7);
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SeparateVoiceTaskObservation("failed", null, null,
                        null, "剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("poll failed 无上游原因 → 1047 + 默认文案")
    void pollFailedWithoutReason_fallsBackMessage() {
        stubPollClaim(input("audio"), 3, 7);
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SeparateVoiceTaskObservation("failed", null, null, null, null));

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(), any(),
                eq("worker-1"), eq(5L));
        assertThat(code.getValue())
                .isEqualTo(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
        assertThat(message.getValue()).isEqualTo("人声背景分离任务失败");
    }


    private SeparateVoiceTaskObservation twoTrackObservation(Double durationSec) {
        Map<String, String> trackUrls = new LinkedHashMap<>();
        trackUrls.put("voice", "https://volc/voice.aac?auth_key=...");
        trackUrls.put("background", "https://volc/background.aac?auth_key=...");
        return new SeparateVoiceTaskObservation("succeeded", trackUrls, durationSec, null, null);
    }

    private SeparateVoiceTaskObservation threeTrackObservation(Double durationSec) {
        Map<String, String> trackUrls = new LinkedHashMap<>();
        trackUrls.put("voice", "https://volc/voice.aac");
        trackUrls.put("music", "https://volc/music.aac");
        trackUrls.put("sfx", "https://volc/sfx.aac");
        return new SeparateVoiceTaskObservation("succeeded", trackUrls, durationSec, null, null);
    }

    private TosAudioMediaRelay.StoredAudio stored(String suffix) {
        return new TosAudioMediaRelay.StoredAudio(
                "https://tos/out-" + suffix, "generated/9/audio/abc-" + suffix,
                "audio/aac", 1_000L + suffix.length(), "md5-" + suffix);
    }

    @Test
    @DisplayName("completed 两轨（audio 场景）：逐轨 persist → 发布轨序 [voice, background]，duration 逐轨冗余官方值")
    void pollCompletedTwoTracks_publishesInTrackOrder() {
        stubPollClaim(input("audio"), 3, 7);
        stubSourceAsset("video");
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(twoTrackObservation(65.5));
        when(mediaRelay.persist(eq("https://volc/voice.aac?auth_key=..."), eq("9"), eq("aac")))
                .thenReturn(stored("voice"));
        when(mediaRelay.persist(eq("https://volc/background.aac?auth_key=..."), eq("9"), eq("aac")))
                .thenReturn(stored("bg"));
        when(finalizer.publishVocalSplitResult(any())).thenReturn(true);

        processor.handle("100");

        verify(mediaRelay).persist("https://volc/voice.aac?auth_key=...", "9", "aac");
        verify(mediaRelay).persist("https://volc/background.aac?auth_key=...", "9", "aac");
        ArgumentCaptor<PublishVocalSplitDto> captor =
                ArgumentCaptor.forClass(PublishVocalSplitDto.class);
        verify(finalizer).publishVocalSplitResult(captor.capture());
        PublishVocalSplitDto published = captor.getValue();
        assertThat(published.tracks()).hasSize(2);
        assertThat(published.tracks().get(0).trackType()).isEqualTo("voice");
        assertThat(published.tracks().get(0).url()).isEqualTo("https://tos/out-voice");
        assertThat(published.tracks().get(0).storageKey()).isEqualTo("generated/9/audio/abc-voice");
        assertThat(published.tracks().get(0).mime()).isEqualTo("audio/aac");
        assertThat(published.tracks().get(0).md5()).isEqualTo("md5-voice");
        assertThat(published.tracks().get(0).durationSec()).isEqualTo(65.5);
        assertThat(published.tracks().get(1).trackType()).isEqualTo("background");
        assertThat(published.tracks().get(1).url()).isEqualTo("https://tos/out-bg");
        assertThat(published.tracks().get(1).durationSec()).isEqualTo(65.5);
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("completed 三轨（drama 场景）：发布轨序 [voice, music, sfx]（契约 SCENE_TRACKS）")
    void pollCompletedThreeTracks_publishesInTrackOrder() {
        stubPollClaim(input("drama"), 3, 7);
        stubSourceAsset("video");
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(threeTrackObservation(95.0));
        when(mediaRelay.persist(eq("https://volc/voice.aac"), eq("9"), eq("aac")))
                .thenReturn(stored("voice"));
        when(mediaRelay.persist(eq("https://volc/music.aac"), eq("9"), eq("aac")))
                .thenReturn(stored("music"));
        when(mediaRelay.persist(eq("https://volc/sfx.aac"), eq("9"), eq("aac")))
                .thenReturn(stored("sfx"));
        when(finalizer.publishVocalSplitResult(any())).thenReturn(true);

        processor.handle("100");

        verify(mediaRelay, times(3)).persist(anyString(), eq("9"), eq("aac"));
        ArgumentCaptor<PublishVocalSplitDto> captor =
                ArgumentCaptor.forClass(PublishVocalSplitDto.class);
        verify(finalizer).publishVocalSplitResult(captor.capture());
        assertThat(captor.getValue().tracks())
                .extracting(PublishVocalSplitDto.PublishVocalSplitTrackDto::trackType)
                .containsExactly("voice", "music", "sfx");
        assertThat(captor.getValue().tracks().get(1).url()).isEqualTo("https://tos/out-music");
        assertThat(captor.getValue().tracks().get(2).url()).isEqualTo("https://tos/out-sfx");
        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("completed 无官方 duration → 回落源 duration_ms 换算秒（逐轨同值）")
    void pollCompleted_fallsBackToSourceDuration() {
        stubPollClaim(input("music"), 3, 7);
        stubSourceAsset("video");
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(twoTrackObservation(null));
        when(mediaRelay.persist(anyString(), eq("9"), eq("aac"))).thenReturn(stored("v"));
        when(finalizer.publishVocalSplitResult(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<PublishVocalSplitDto> captor =
                ArgumentCaptor.forClass(PublishVocalSplitDto.class);
        verify(finalizer).publishVocalSplitResult(captor.capture());
        assertThat(captor.getValue().tracks()).hasSize(2);
        assertThat(captor.getValue().tracks().get(0).durationSec()).isEqualTo(65.0);
        assertThat(captor.getValue().tracks().get(1).durationSec()).isEqualTo(65.0);
    }

    @Test
    @DisplayName("completed 缺轨（drama 场景只回两轨）→ 1047 兜底整单失败，不发布不转存")
    void pollCompletedMissingTrack_fails() {
        stubPollClaim(input("drama"), 3, 7);
        Map<String, String> trackUrls = new LinkedHashMap<>();
        trackUrls.put("voice", "https://volc/voice.aac");
        trackUrls.put("music", "https://volc/music.aac");
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(new SeparateVoiceTaskObservation("succeeded", trackUrls, 95.0,
                        null, null));

        processor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(), any(),
                eq("worker-1"), eq(5L));
        assertThat(code.getValue())
                .isEqualTo(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
        assertThat(message.getValue()).contains("sfx");
        verify(mediaRelay, never()).persist(anyString(), anyString(), anyString());
        verify(finalizer, never()).publishVocalSplitResult(any());
    }

    @Test
    @DisplayName("TOS 未配置 → 1047（结果 URL 24h 失效，强依赖不降级直存）")
    void tosMissing_failsWithoutPassthrough() {
        VocalSplitJobProcessor noRelayProcessor = new VocalSplitJobProcessor(
                stateMachine, claimService, jobMapper, finalizer,
                new AssetSourceService(assetMapper),
                upstreamCredential, separateVoiceClient, null, producer);
        stubPollClaim(input("audio"), 3, 7);
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(twoTrackObservation(65.5));

        noRelayProcessor.handle("100");

        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failMediaExtractJob(eq("100"), code.capture(), message.capture(), any(),
                eq("worker-1"), eq(5L));
        assertThat(code.getValue())
                .isEqualTo(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
        assertThat(message.getValue()).isEqualTo("音频转存存储未配置");
        verify(finalizer, never()).publishVocalSplitResult(any());
    }

    @Test
    @DisplayName("任一轨转存失败（背景轨下载 404）→ 1047 兜底整单失败，不发布")
    void relayFailsOnAnyTrack_fails() {
        stubPollClaim(input("audio"), 3, 7);
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(twoTrackObservation(65.5));
        when(mediaRelay.persist(eq("https://volc/voice.aac?auth_key=..."), eq("9"), eq("aac")))
                .thenReturn(stored("voice"));
        when(mediaRelay.persist(eq("https://volc/background.aac?auth_key=..."), eq("9"), eq("aac")))
                .thenThrow(new RuntimeException("生成音频下载失败: HTTP 404"));

        processor.handle("100");

        assertFailCode(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED);
        verify(finalizer, never()).publishVocalSplitResult(any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubPollClaim(input("audio"), 3, 7);
        stubSourceAsset("video");
        when(separateVoiceClient.poll("sk-frozen-token", "amk-task-1"))
                .thenReturn(twoTrackObservation(65.5));
        when(mediaRelay.persist(anyString(), eq("9"), eq("aac"))).thenReturn(stored("v"));
        when(finalizer.publishVocalSplitResult(any())).thenReturn(false);

        processor.handle("100");

        verify(finalizer, never()).failMediaExtractJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }


    @Test
    @DisplayName("瞬时判定：provider_timeout / 网络不可达 / HTTP 429/5xx → 瞬时；4xx / 业务失败 → 非瞬时")
    void transientPollErrorClassification() {
        assertThat(VocalSplitJobProcessor.isTransientPollError(
                new VocalSplitError(GenerationError.ERROR_PROVIDER_TIMEOUT, "timeout")))
                .isTrue();

        VocalSplitError unreachable = new VocalSplitError(
                GenerationError.ERROR_PROVIDER_FAILED, "unreachable");
        unreachable.initCause(new java.net.ConnectException("refused"));
        assertThat(VocalSplitJobProcessor.isTransientPollError(unreachable)).isTrue();

        for (int status : new int[]{429, 500, 502, 503, 504}) {
            VocalSplitError serverError = new VocalSplitError(
                    GenerationError.ERROR_PROVIDER_FAILED, "HTTP " + status);
            serverError.initCause(new NewApiVideoClient.HttpStatusException(status));
            assertThat(VocalSplitJobProcessor.isTransientPollError(serverError))
                    .as("HTTP %d 应判定瞬时", status).isTrue();
        }

        VocalSplitError badRequest = new VocalSplitError(
                GenerationError.ERROR_PROVIDER_FAILED, "HTTP 400");
        badRequest.initCause(new NewApiVideoClient.HttpStatusException(400));
        assertThat(VocalSplitJobProcessor.isTransientPollError(badRequest)).isFalse();

        assertThat(VocalSplitJobProcessor.isTransientPollError(
                new VocalSplitError(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED, "task failed")))
                .isFalse();
    }
}
