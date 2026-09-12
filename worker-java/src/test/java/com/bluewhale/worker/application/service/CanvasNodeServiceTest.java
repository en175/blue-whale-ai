package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.CanvasEntity;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.mapper.CanvasMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 画布节点更新测试。
 * <p>
 * 重点回归（2026-09-12 job 1834 实证）：占位节点不存在时
 * {@code withCanvasUpdate} 返回 null，public 方法若直接返回（boolean 拆箱）会抛 NPE
 * → 非阻断 catch 吞掉 → 画布静默不更新。此处钉住「返回 false 而非抛异常」。
 */
@ExtendWith(MockitoExtension.class)
class CanvasNodeServiceTest {

    @Mock
    private CanvasMapper canvasMapper;
    @Mock
    private GenerationJobMapper jobMapper;

    private CanvasNodeService service;

    @BeforeEach
    void setUp() {
        service = new CanvasNodeService(canvasMapper, jobMapper);
    }

    @Test
    @DisplayName("占位节点不存在 → 返回 false（不抛 NPE）")
    void nodeMissing_returnsFalseNotNpe() {
        CanvasEntity canvas = new CanvasEntity();
        canvas.setId(1L);
        canvas.setVersion(0);
        // 画布存在但没有 media-extract-<jobId> 占位节点
        canvas.setNodesJson("[{\"id\":\"other-node\",\"data\":{}}]");
        when(canvasMapper.findByProjectId(anyLong())).thenReturn(canvas);
        lenient().when(jobMapper.selectById(anyLong())).thenReturn(new GenerationJobEntity());

        boolean result = service.updateMediaExtractNodeToAudio(
                "1834", "438", "https://tos/a.mp3", "audio/mpeg", 124563L, 3.9);

        assertThat(result).isFalse();
        // 未找到节点 → 不应写画布
        verify(canvasMapper, never()).updateNodesCas(anyLong(), any(), anyString());
    }

    @Test
    @DisplayName("画布不存在 → 返回 false（不抛 NPE）")
    void canvasMissing_returnsFalseNotNpe() {
        when(canvasMapper.findByProjectId(anyLong())).thenReturn(null);

        boolean result = service.failMediaExtractNode(
                "1834", "438", "media_extract_failed", "ffmpeg 失败");

        assertThat(result).isFalse();
        verify(canvasMapper, never()).updateNodesCas(anyLong(), any(), anyString());
    }

    @Test
    @DisplayName("占位节点存在 → 写入并返回 true")
    void nodePresent_writesAndReturnsTrue() {
        CanvasEntity canvas = new CanvasEntity();
        canvas.setId(1L);
        canvas.setVersion(2);
        canvas.setNodesJson(
                "[{\"id\":\"media-extract-1834\",\"data\":{\"genStatus\":\"generating\",\"name\":\"旧名\"}}]");
        when(canvasMapper.findByProjectId(anyLong())).thenReturn(canvas);
        when(canvasMapper.updateNodesCas(anyLong(), any(), anyString())).thenReturn(1);
        GenerationJobEntity job = new GenerationJobEntity();
        job.setId(1834L);
        job.setOutputAssetIds("[6041]");
        when(jobMapper.selectById(anyLong())).thenReturn(job);

        boolean result = service.updateMediaExtractNodeToAudio(
                "1834", "438", "https://tos/a.mp3", "audio/mpeg", 124563L, 3.9);

        assertThat(result).isTrue();
        verify(canvasMapper).updateNodesCas(anyLong(), any(), anyString());
    }
}
