package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.CanvasMapper;
import com.blue.whale.agent.model.dto.CanvasDto;
import com.blue.whale.agent.model.dto.SaveCanvasRequest;
import com.blue.whale.agent.model.entity.Canvas;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * {@link CanvasService} 单测：整体 JSON 透传，project 1:1 upsert（ADR-0011 D3/D4）。
 * 全 mock {@link CanvasMapper}，不连数据库。
 */
@ExtendWith(MockitoExtension.class)
class CanvasServiceTest {

    @Mock
    private CanvasMapper canvasMapper;

    private CanvasService canvasService;

    @BeforeEach
    void setUp() {
        canvasService = new CanvasService(canvasMapper);
    }

    @Test
    void getByProjectReturnsEmptyShellWhenNoRecord() {
        when(canvasMapper.selectOne(any())).thenReturn(null);

        CanvasDto dto = canvasService.getByProject(1L);

        assertThat(dto.id()).isNull();
        assertThat(dto.projectId()).isEqualTo(1L);
        assertThat(dto.nodes()).isEqualTo("[]");
        assertThat(dto.viewport()).isNull();
    }

    @Test
    void getByProjectReturnsExistingRecord() {
        Canvas c = new Canvas()
                .setProjectId(1L)
                .setViewportJson("{\"x\":0,\"y\":0,\"zoom\":1}")
                .setNodesJson("[{\"id\":\"n1\"}]");
        c.setId(5L);
        when(canvasMapper.selectOne(any())).thenReturn(c);

        CanvasDto dto = canvasService.getByProject(1L);

        assertThat(dto.id()).isEqualTo(5L);
        assertThat(dto.nodes()).isEqualTo("[{\"id\":\"n1\"}]");
    }

    @Test
    void saveInsertsWhenNoExistingCanvas() {
        when(canvasMapper.selectOne(any())).thenReturn(null);
        ArgumentCaptor<Canvas> captor = ArgumentCaptor.forClass(Canvas.class);
        when(canvasMapper.insert(captor.capture())).thenAnswer(inv -> {
            captor.getValue().setId(1L);
            return 1;
        });

        CanvasDto dto = canvasService.save(1L,
                new SaveCanvasRequest("{\"zoom\":1}", "[{\"id\":\"n1\"}]"));

        assertThat(dto.id()).isEqualTo(1L);
        assertThat(captor.getValue().getProjectId()).isEqualTo(1L);
        verify(canvasMapper, never()).updateById(any(Canvas.class));
    }

    @Test
    void saveUpdatesWhenExistingCanvas() {
        Canvas existing = new Canvas()
                .setProjectId(1L)
                .setViewportJson("{\"zoom\":1}")
                .setNodesJson("[]");
        existing.setId(5L);
        when(canvasMapper.selectOne(any())).thenReturn(existing);
        when(canvasMapper.updateById(any(Canvas.class))).thenReturn(1);

        CanvasDto dto = canvasService.save(1L,
                new SaveCanvasRequest("{\"zoom\":2}", "[{\"id\":\"n2\"}]"));

        assertThat(dto.id()).isEqualTo(5L);
        assertThat(dto.nodes()).isEqualTo("[{\"id\":\"n2\"}]");
        verify(canvasMapper, never()).insert(any(Canvas.class));
        verify(canvasMapper).updateById(argThat((Canvas saved) ->
                "[{\"id\":\"n2\"}]".equals(saved.getNodesJson())));
    }
}
