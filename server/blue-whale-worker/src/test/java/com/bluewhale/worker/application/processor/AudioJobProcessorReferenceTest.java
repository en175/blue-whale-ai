package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.infrastructure.audio.NewApiAudioClient;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * 音频参考素材解析测试（generation-worker.ts:148-207 resolveAudioSeedReferences）。
 * <p>
 * 验证：
 * - null references → 空列表（纯文本生成）
 * - 非数组 → 失败 "参考素材引用无效"
 * - asset 不存在 → 失败 "参考素材不存在或无权访问"
 * - 非 audio/image 类型 → 失败 "参考素材类型不适用"
 * - 同一 URL 重复 → 去重
 * - audio → {audio_url}，image → {image_url}
 */
@ExtendWith(MockitoExtension.class)
class AudioJobProcessorReferenceTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetSourceService assetSource;
    @Mock private UpstreamCredential upstreamCredential;
    @Mock private NewApiAudioClient audioClient;
    @Mock private TosMediaStorage tosService;

    private AudioJobProcessor createProcessor() {
        return new AudioJobProcessor(stateMachine, finalizer, assetSource, upstreamCredential, audioClient, tosService);
    }

    @Test
    @DisplayName("null references → ok + 空列表（纯文本生成）")
    void nullReferences() {
        AudioJobProcessor proc = createProcessor();
        AudioJobProcessor.AudioRefsResult result =
                proc.resolveAudioSeedReferences(null, "9", "42");
        assertThat(result.ok()).isTrue();
        assertThat(result.refs()).isEmpty();
    }

    @Test
    @DisplayName("非数组 → fail '参考素材引用无效'")
    void nonArrayReferences() {
        AudioJobProcessor proc = createProcessor();
        AudioJobProcessor.AudioRefsResult result =
                proc.resolveAudioSeedReferences("not-an-array", "9", "42");
        assertThat(result.ok()).isFalse();
        assertThat(result.message()).isEqualTo("参考素材引用无效");
    }

    @Test
    @DisplayName("asset 不存在 → fail '参考素材不存在或无权访问'")
    void missingAsset() {
        when(assetSource.resolveInputAssets(List.of("100"), "9", "42"))
                .thenReturn(Map.of()); // 空映射 = asset 不存在

        AudioJobProcessor proc = createProcessor();
        AudioJobProcessor.AudioRefsResult result = proc.resolveAudioSeedReferences(
                List.of(Map.of("asset_id", "100")), "9", "42");

        assertThat(result.ok()).isFalse();
        assertThat(result.message()).isEqualTo("参考素材不存在或无权访问");
    }

    @Test
    @DisplayName("非 audio/image 类型 → fail '参考素材类型不适用'")
    void wrongType() {
        AssetEntity videoAsset = new AssetEntity();
        videoAsset.setId(100L);
        videoAsset.setType("video"); // video 不适用于音频参考
        videoAsset.setUrl("https://example.com/video.mp4");

        when(assetSource.resolveInputAssets(List.of("100"), "9", "42"))
                .thenReturn(Map.of("100", videoAsset));

        AudioJobProcessor proc = createProcessor();
        AudioJobProcessor.AudioRefsResult result = proc.resolveAudioSeedReferences(
                List.of(Map.of("asset_id", "100")), "9", "42");

        assertThat(result.ok()).isFalse();
        assertThat(result.message()).isEqualTo("参考素材类型不适用");
    }

    @Test
    @DisplayName("audio asset → {audio_url}")
    void audioAsset() {
        AssetEntity audioAsset = new AssetEntity();
        audioAsset.setId(100L);
        audioAsset.setType("audio");
        audioAsset.setUrl("https://example.com/ref.mp3");

        when(assetSource.resolveInputAssets(List.of("100"), "9", "42"))
                .thenReturn(Map.of("100", audioAsset));

        AudioJobProcessor proc = createProcessor();
        AudioJobProcessor.AudioRefsResult result = proc.resolveAudioSeedReferences(
                List.of(Map.of("asset_id", "100")), "9", "42");

        assertThat(result.ok()).isTrue();
        assertThat(result.refs()).hasSize(1);
        assertThat(result.refs().get(0)).containsEntry("audio_url", "https://example.com/ref.mp3");
    }

    @Test
    @DisplayName("image asset → {image_url}")
    void imageAsset() {
        AssetEntity imageAsset = new AssetEntity();
        imageAsset.setId(101L);
        imageAsset.setType("image");
        imageAsset.setUrl("https://example.com/ref.png");

        when(assetSource.resolveInputAssets(List.of("101"), "9", "42"))
                .thenReturn(Map.of("101", imageAsset));

        AudioJobProcessor proc = createProcessor();
        AudioJobProcessor.AudioRefsResult result = proc.resolveAudioSeedReferences(
                List.of(Map.of("asset_id", "101")), "9", "42");

        assertThat(result.ok()).isTrue();
        assertThat(result.refs()).hasSize(1);
        assertThat(result.refs().get(0)).containsEntry("image_url", "https://example.com/ref.png");
    }

    @Test
    @DisplayName("同一 URL 重复出现 → 去重（仅保留首次）")
    void deduplicateByUrl() {
        AssetEntity audio1 = new AssetEntity();
        audio1.setId(100L);
        audio1.setType("audio");
        audio1.setUrl("https://example.com/same.mp3");

        AssetEntity audio2 = new AssetEntity();
        audio2.setId(101L);
        audio2.setType("audio");
        audio2.setUrl("https://example.com/same.mp3"); // 同一 URL

        when(assetSource.resolveInputAssets(List.of("100", "101"), "9", "42"))
                .thenReturn(Map.of("100", audio1, "101", audio2));

        AudioJobProcessor proc = createProcessor();
        AudioJobProcessor.AudioRefsResult result = proc.resolveAudioSeedReferences(
                List.of(
                        Map.of("asset_id", "100"),
                        Map.of("asset_id", "101")
                ), "9", "42");

        assertThat(result.ok()).isTrue();
        assertThat(result.refs()).hasSize(1); // 去重后仅 1 条
    }

    @Test
    @DisplayName("混合 audio + image → 两条参考")
    void mixedAudioImage() {
        AssetEntity audio = new AssetEntity();
        audio.setId(100L);
        audio.setType("audio");
        audio.setUrl("https://example.com/ref.mp3");

        AssetEntity image = new AssetEntity();
        image.setId(101L);
        image.setType("image");
        image.setUrl("https://example.com/ref.png");

        when(assetSource.resolveInputAssets(List.of("100", "101"), "9", "42"))
                .thenReturn(Map.of("100", audio, "101", image));

        AudioJobProcessor proc = createProcessor();
        AudioJobProcessor.AudioRefsResult result = proc.resolveAudioSeedReferences(
                List.of(
                        Map.of("asset_id", "100"),
                        Map.of("asset_id", "101")
                ), "9", "42");

        assertThat(result.ok()).isTrue();
        assertThat(result.refs()).hasSize(2);
        assertThat(result.refs().get(0)).containsKey("audio_url");
        assertThat(result.refs().get(1)).containsKey("image_url");
    }

    @Test
    @DisplayName("asset_id 为空的项 → 跳过（不复审）")
    void emptyAssetId_skipped() {
        AudioJobProcessor proc = createProcessor();
        AudioJobProcessor.AudioRefsResult result = proc.resolveAudioSeedReferences(
                List.of(
                        Map.of("asset_id", ""),
                        Map.of("role", "vocal") // 无 asset_id
                ), "9", "42");

        assertThat(result.ok()).isTrue();
        assertThat(result.refs()).isEmpty();
    }
}
