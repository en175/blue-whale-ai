package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.domain.error.MediaExtractError;

import com.bluewhale.worker.infrastructure.media.FfmpegExtractor;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.application.service.CanvasNodeService;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * MediaExtractJobProcessor 错误码映射测试（media-extract-runner.ts:303-315）。
 * <p>
 * 验证每种异常类型被正确映射到对应错误码。不连真实 MQ/DB/TOS。
 */
@ExtendWith(MockitoExtension.class)
class MediaExtractJobProcessorErrorMappingTest {

    @Mock
    private JobStateMachineService stateMachine;

    @Mock
    private AssetMapper assetMapper;

    @Mock
    private TosMediaStorage tosService;

    @Mock
    private FfmpegExtractor ffmpeg;

    @Mock
    private CanvasNodeService canvasNodeService;

    private MediaExtractJobProcessor processor;

    @BeforeEach
    void setUp() {
        processor = new MediaExtractJobProcessor(
                stateMachine, new AssetSourceService(assetMapper), tosService, ffmpeg, canvasNodeService
        );
    }

    private ClaimedMediaExtractJobDto makeClaim(String jobId, Map<String, Object> input) {
        return new ClaimedMediaExtractJobDto(jobId, "42", "9", input, "worker-1", 5L);
    }

    @Test
    @DisplayName("缺少 source_asset_id → invalid_input")
    void missingSourceAssetId_invalidInput() {
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenReturn(Optional.of(makeClaim("100", Map.of())));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<FailMediaExtractDto> captor = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo(MediaExtractError.INVALID_INPUT);
        assertThat(captor.getValue().message()).contains("缺少源视频资产 id");
    }

    @Test
    @DisplayName("source_asset_id 为 null → invalid_input")
    void nullSourceAssetId_invalidInput() {
        Map<String, Object> input = new java.util.HashMap<>();
        input.put("source_asset_id", null);
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenReturn(Optional.of(makeClaim("100", input)));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<FailMediaExtractDto> captor = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo(MediaExtractError.INVALID_INPUT);
    }

    @Test
    @DisplayName("源资产不存在 → source_asset_unavailable")
    void sourceAssetNotFound_sourceAssetUnavailable() {
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenReturn(Optional.of(makeClaim("100", Map.of("source_asset_id", "555"))));
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList())).thenReturn(null);
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<FailMediaExtractDto> captor = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo(MediaExtractError.SOURCE_ASSET_UNAVAILABLE);
    }

    @Test
    @DisplayName("下载失败 → video_download_failed")
    void downloadFails_videoDownloadFailed() {
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenReturn(Optional.of(makeClaim("100", Map.of("source_asset_id", "555"))));
        AssetEntity source = new AssetEntity();
        source.setStorageKey("videos/test.mp4");
        source.setUrl("https://example.com/test.mp4");
        source.setMime("video/mp4");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList())).thenReturn(source);
        doThrow(new MediaExtractError(MediaExtractError.VIDEO_DOWNLOAD_FAILED, "TOS 视频下载失败: 404"))
                .when(tosService).download(anyString(), anyString(), any(), anyLong());
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<FailMediaExtractDto> captor = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo(MediaExtractError.VIDEO_DOWNLOAD_FAILED);
    }

    @Test
    @DisplayName("视频太大 → video_too_large")
    void videoTooLarge() {
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenReturn(Optional.of(makeClaim("100", Map.of("source_asset_id", "555"))));
        AssetEntity source = new AssetEntity();
        source.setStorageKey("videos/test.mp4");
        source.setUrl("https://example.com/test.mp4");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList())).thenReturn(source);
        doThrow(new MediaExtractError(MediaExtractError.VIDEO_TOO_LARGE, "视频超过大小上限"))
                .when(tosService).download(anyString(), anyString(), any(), anyLong());
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<FailMediaExtractDto> captor = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo(MediaExtractError.VIDEO_TOO_LARGE);
    }

    @Test
    @DisplayName("无音轨 → video_has_no_audio_track")
    void noAudioTrack() {
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenReturn(Optional.of(makeClaim("100", Map.of("source_asset_id", "555"))));
        AssetEntity source = new AssetEntity();
        source.setStorageKey("videos/test.mp4");
        source.setUrl("https://example.com/test.mp4");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList())).thenReturn(source);
        when(ffmpeg.extract(anyString(), anyString(), any()))
                .thenThrow(new MediaExtractError(MediaExtractError.VIDEO_HAS_NO_AUDIO_TRACK, "视频没有音轨"));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<FailMediaExtractDto> captor = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo(MediaExtractError.VIDEO_HAS_NO_AUDIO_TRACK);
    }

    @Test
    @DisplayName("ffmpeg 失败 → extract_failed")
    void ffmpegFails_extractFailed() {
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenReturn(Optional.of(makeClaim("100", Map.of("source_asset_id", "555"))));
        AssetEntity source = new AssetEntity();
        source.setStorageKey("videos/test.mp4");
        source.setUrl("https://example.com/test.mp4");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList())).thenReturn(source);
        when(ffmpeg.extract(anyString(), anyString(), any()))
                .thenThrow(new MediaExtractError(MediaExtractError.EXTRACT_FAILED, "ffmpeg 退出码 1"));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<FailMediaExtractDto> captor = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo(MediaExtractError.EXTRACT_FAILED);
    }

    @Test
    @DisplayName("上传失败 → upload_failed")
    void uploadFails_uploadFailed() {
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenReturn(Optional.of(makeClaim("100", Map.of("source_asset_id", "555"))));
        AssetEntity source = new AssetEntity();
        source.setStorageKey("videos/test.mp4");
        source.setUrl("https://example.com/test.mp4");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList())).thenReturn(source);
        when(ffmpeg.extract(anyString(), anyString(), any()))
                .thenReturn(new FfmpegExtractor.ExtractResult(12.5));
        doThrow(new MediaExtractError(MediaExtractError.UPLOAD_FAILED, "TOS 音频上传失败: 500"))
                .when(tosService).upload(any(), anyString());
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<FailMediaExtractDto> captor = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo(MediaExtractError.UPLOAD_FAILED);
    }

    @Test
    @DisplayName("非 MediaExtractError 异常 → media_extract_failed 兜底")
    void unexpectedError_mediaExtractFailed() {
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenReturn(Optional.of(makeClaim("100", Map.of("source_asset_id", "555"))));
        AssetEntity source = new AssetEntity();
        source.setStorageKey("videos/test.mp4");
        source.setUrl("https://example.com/test.mp4");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList())).thenReturn(source);
        doThrow(new RuntimeException("unexpected system error"))
                .when(tosService).download(anyString(), anyString(), any(), anyLong());
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<FailMediaExtractDto> captor = ArgumentCaptor.forClass(FailMediaExtractDto.class);
        verify(stateMachine).failMediaExtractJob(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo(MediaExtractError.MEDIA_EXTRACT_FAILED);
    }

    @Test
    @DisplayName("claim 抛 DB 异常 → 上抛（不 fail job，不 ack → 重投）")
    void claimThrowsDbError_propagates() {
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        org.assertj.core.api.ThrowableAssert.ThrowingCallable action = () -> processor.handle("100");

        assertThat(org.assertj.core.api.Assertions.catchThrowable(action))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("DB connection refused");

        // 不应调 failMediaExtractJob（瞬时 DB 错误不应落 failed）
        verify(stateMachine, never()).failMediaExtractJob(any());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领）")
    void claimReturnsEmpty_silentReturn() {
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenReturn(Optional.empty());

        processor.handle("100");

        verify(stateMachine, never()).failMediaExtractJob(any());
        verify(stateMachine, never()).publishMediaExtractResult(any());
    }

    @Test
    @DisplayName("failMediaExtract 同时调用 canvasNodeService.failMediaExtractNode")
    void failAlsoUpdatesCanvasNode() {
        when(stateMachine.claimMediaExtract(anyString(), anyString()))
                .thenReturn(Optional.of(makeClaim("100", Map.of())));
        when(stateMachine.failMediaExtractJob(any())).thenReturn(true);

        processor.handle("100");

        verify(canvasNodeService).failMediaExtractNode(
                eq("100"), eq("42"),
                eq(MediaExtractError.INVALID_INPUT),
                anyString()
        );
    }
}
