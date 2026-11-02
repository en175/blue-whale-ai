package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class JobFinalizerAudioVideoMuxTest {
    @Mock GenerationJobMapper jobMapper;
    @Mock AssetMapper assetMapper;
    @Mock GenerationJobLogMapper jobLogMapper;
    @Mock GenerationOutputSlotMapper slotMapper;
    @Mock GenerationJobExtraMapper extraMapper;
    @Mock TerminalEventOutbox settlementPublisher;

    private JobFinalizer finalizer;

    @BeforeEach
    void setUp() {
        finalizer = new JobFinalizer(jobMapper, assetMapper, jobLogMapper, slotMapper, extraMapper,
                settlementPublisher);
        lenient().when(assetMapper.insert(any(AssetEntity.class))).thenAnswer(invocation -> {
            ((AssetEntity) invocation.getArgument(0)).setId(99L);
            return 1;
        });
    }

    private AssetEntity sourceVideo() {
        AssetEntity source = new AssetEntity();
        source.setId(12L);
        source.setName("my_vlog.mp4");
        source.setWidth(1280);
        source.setHeight(720);
        source.setDurationMs(33_000);
        return source;
    }

    private PublishAudioVideoMuxDto input(Double durationSec, String resolution) {
        return new PublishAudioVideoMuxDto("70", "5", "9", "worker-1", 3L,
                "https://our-tos/out.mp4", "generated/9/video/out.mp4", "video/mp4", 100L, "md5",
                durationSec, resolution, "12");
    }

    @Test
    @DisplayName("命名 = 源视频资产名去扩展名 + (音视频合成).mp4；duration 秒→毫秒在收口换算")
    void namesResultFromSourceVideoAndConvertsSecondsToMillis() {
        when(jobMapper.publishResultGuard(eq(70L), eq("worker-1"), eq(3L))).thenReturn(1);
        when(assetMapper.selectById(12L)).thenReturn(sourceVideo());

        assertThat(finalizer.publishAudioVideoMuxResult(input(227.0, "1920x1080"))).isTrue();

        ArgumentCaptor<AssetEntity> inserted = ArgumentCaptor.forClass(AssetEntity.class);
        verify(assetMapper).insert(inserted.capture());
        assertThat(inserted.getValue().getName()).isEqualTo("my_vlog(音视频合成).mp4");
        assertThat(inserted.getValue().getType()).isEqualTo("video");
        assertThat(inserted.getValue().getDurationMs()).isEqualTo(227_000);
        assertThat(inserted.getValue().getWidth()).isEqualTo(1920);
        assertThat(inserted.getValue().getHeight()).isEqualTo(1080);
    }

    @Test
    @DisplayName("result.duration/resolution 缺失回落源视频资产；解析失败同样回落")
    void fallsBackToSourceMetadataWhenResultFieldsAreMissing() {
        when(jobMapper.publishResultGuard(eq(70L), eq("worker-1"), eq(3L))).thenReturn(1);
        when(assetMapper.selectById(12L)).thenReturn(sourceVideo());

        assertThat(finalizer.publishAudioVideoMuxResult(input(null, null))).isTrue();
        assertThat(finalizer.publishAudioVideoMuxResult(input(1.5, "not-a-resolution"))).isTrue();

        ArgumentCaptor<AssetEntity> inserted = ArgumentCaptor.forClass(AssetEntity.class);
        verify(assetMapper, times(2)).insert(inserted.capture());
        for (AssetEntity asset : inserted.getAllValues()) {
            assertThat(asset.getWidth()).isEqualTo(1280);
            assertThat(asset.getHeight()).isEqualTo(720);
            assertThat(asset.getName()).isEqualTo("my_vlog(音视频合成).mp4");
        }
        assertThat(inserted.getAllValues().get(0).getDurationMs()).isEqualTo(33_000);
        assertThat(inserted.getAllValues().get(1).getDurationMs()).isEqualTo(1_500);
    }

    @Test
    @DisplayName("源名只去最后一段扩展名；空白源名回落基名「视频」")
    void stripsOnlyTheLastExtensionAndFallsBackToGenericBase() {
        when(jobMapper.publishResultGuard(eq(70L), eq("worker-1"), eq(3L))).thenReturn(1);
        AssetEntity dotted = sourceVideo();
        dotted.setName("my.vlog.final.mp4");
        when(assetMapper.selectById(12L)).thenReturn(dotted, sourceVideo(), new AssetEntity());
        assertThat(finalizer.publishAudioVideoMuxResult(input(1.0, null))).isTrue();
        assertThat(finalizer.publishAudioVideoMuxResult(input(1.0, null))).isTrue();
        assertThat(finalizer.publishAudioVideoMuxResult(input(1.0, null))).isTrue();

        ArgumentCaptor<AssetEntity> inserted = ArgumentCaptor.forClass(AssetEntity.class);
        verify(assetMapper, times(3)).insert(inserted.capture());
        assertThat(inserted.getAllValues().get(0).getName()).isEqualTo("my.vlog.final(音视频合成).mp4");
        assertThat(inserted.getAllValues().get(1).getName()).isEqualTo("my_vlog(音视频合成).mp4");
        assertThat(inserted.getAllValues().get(2).getName()).isEqualTo("视频(音视频合成).mp4");
    }

    @Test
    @DisplayName("发布守卫未命中不建资产")
    void staleFencePublishesNothing() {
        when(jobMapper.publishResultGuard(eq(70L), eq("worker-1"), eq(3L))).thenReturn(0);
        when(assetMapper.selectById(12L)).thenReturn(sourceVideo());

        assertThat(finalizer.publishAudioVideoMuxResult(input(227.0, "1920x1080"))).isFalse();

        verify(assetMapper, never()).insert(any(AssetEntity.class));
    }
}
