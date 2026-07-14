package com.blue.whale.agent.controller;

import com.blue.whale.agent.model.dto.CanvasDto;
import com.blue.whale.agent.model.dto.SaveCanvasRequest;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.CanvasService;
import com.blue.whale.agent.service.ProjectService;
import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

/**
 * {@link CanvasController} 单测：读取先校验归属；写入把 userId 交给事务内的 CanvasService 校验。
 */
@ExtendWith(MockitoExtension.class)
class CanvasControllerTest {

    @Mock
    private CanvasService canvasService;

    @Mock
    private ProjectService projectService;

    private CanvasController controller;

    @BeforeEach
    void setUp() {
        controller = new CanvasController(canvasService, projectService);
    }

    @Test
    void getThrowsWhenMissingUserId() {
        assertThatThrownBy(() -> controller.get(null, 1L))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.UNAUTHORIZED_CODE);
        verifyNoInteractions(canvasService);
    }

    @Test
    void getThrowsWhenProjectNotOwned() {
        when(projectService.requireOwned(1L, 10L))
                .thenThrow(new GlobalException(SystemCode.DATA_NO_PERMISSION_OPERATE_CODE, "无权限操作该项目"));

        assertThatThrownBy(() -> controller.get(10L, 1L))
                .isInstanceOf(GlobalException.class);
        verifyNoInteractions(canvasService);
    }

    @Test
    void getReturnsCanvasWhenOwned() {
        Project p = new Project().setOwnerId(10L);
        p.setId(1L);
        when(projectService.requireOwned(1L, 10L)).thenReturn(p);
        CanvasDto dto = new CanvasDto(5L, 1L, "{}", "[]");
        when(canvasService.getByProject(1L)).thenReturn(dto);

        Result<CanvasDto> result = controller.get(10L, 1L);

        assertThat(result.isSuccess()).isTrue();
        assertThat(result.getData().projectId()).isEqualTo(1L);
    }

    @Test
    void saveThrowsWhenProjectNotOwned() {
        SaveCanvasRequest req = new SaveCanvasRequest("{}", "[]");
        when(canvasService.save(1L, 10L, req))
                .thenThrow(new GlobalException(SystemCode.DATA_NO_PERMISSION_OPERATE_CODE, "无权限操作该项目"));

        assertThatThrownBy(() -> controller.save(10L, 1L, req))
                .isInstanceOf(GlobalException.class);
        verify(canvasService).save(1L, 10L, req);
    }

    @Test
    void saveReturnsCanvasWhenOwned() {
        SaveCanvasRequest req = new SaveCanvasRequest("{\"zoom\":1}", "[{\"id\":\"n1\"}]");
        CanvasDto dto = new CanvasDto(5L, 1L, req.viewport(), req.nodes());
        when(canvasService.save(1L, 10L, req)).thenReturn(dto);

        Result<CanvasDto> result = controller.save(10L, 1L, req);

        assertThat(result.getData().nodes()).isEqualTo("[{\"id\":\"n1\"}]");
        verify(canvasService).save(1L, 10L, req);
    }
}
