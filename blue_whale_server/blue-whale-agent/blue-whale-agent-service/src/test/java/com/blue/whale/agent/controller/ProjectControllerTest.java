package com.blue.whale.agent.controller;

import com.blue.whale.agent.model.dto.CreateProjectRequest;
import com.blue.whale.agent.model.dto.ProjectDto;
import com.blue.whale.agent.model.dto.RenameProjectRequest;
import com.blue.whale.agent.model.dto.SnapshotResponse;
import com.blue.whale.agent.service.ProjectService;
import com.blue.whale.agent.service.ProjectSseService;
import com.blue.whale.agent.service.SnapshotService;
import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import javax.servlet.http.HttpServletResponse;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.when;

/**
 * {@link ProjectController} 单测：直调方法（非 @WebMvcTest），验证 {@code X-User-Id} 缺失时的 401
 * 与 {@link Result} 包装，不起 web 容器。Service 全 mock。
 */
@ExtendWith(MockitoExtension.class)
class ProjectControllerTest {

    @Mock
    private ProjectService projectService;
    @Mock
    private SnapshotService snapshotService;
    @Mock
    private ProjectSseService projectSseService;
    @Mock
    private HttpServletResponse response;

    private ProjectController controller;

    @BeforeEach
    void setUp() {
        controller = new ProjectController(projectService, snapshotService, projectSseService);
    }

    @Test
    void createThrowsWhenMissingUserId() {
        assertThatThrownBy(() -> controller.create(null, new CreateProjectRequest("A")))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.UNAUTHORIZED_CODE);
    }

    @Test
    void createReturnsOkResult() {
        ProjectDto dto = new ProjectDto(1L, "A", null, LocalDateTime.now(), "canvas");
        when(projectService.create(10L, new CreateProjectRequest("A"))).thenReturn(dto);

        Result<ProjectDto> result = controller.create(10L, new CreateProjectRequest("A"));

        assertThat(result.isSuccess()).isTrue();
        assertThat(result.getData().name()).isEqualTo("A");
    }

    @Test
    void listThrowsWhenMissingUserId() {
        assertThatThrownBy(() -> controller.list(null))
                .isInstanceOf(GlobalException.class);
    }

    @Test
    void listReturnsOkResult() {
        ProjectDto dto = new ProjectDto(1L, "A", null, LocalDateTime.now(), "canvas");
        when(projectService.list(10L)).thenReturn(List.of(dto));

        Result<List<ProjectDto>> result = controller.list(10L);

        assertThat(result.getData()).hasSize(1);
    }

    @Test
    void getThrowsWhenMissingUserId() {
        assertThatThrownBy(() -> controller.get(null, 1L))
                .isInstanceOf(GlobalException.class);
    }

    @Test
    void renameThrowsWhenMissingUserId() {
        assertThatThrownBy(() -> controller.rename(null, 1L, new RenameProjectRequest("B")))
                .isInstanceOf(GlobalException.class);
    }

    @Test
    void deleteThrowsWhenMissingUserId() {
        assertThatThrownBy(() -> controller.delete(null, 1L))
                .isInstanceOf(GlobalException.class);
    }

    @Test
    void deleteReturnsOkResult() {
        Result<Void> result = controller.delete(10L, 1L);

        assertThat(result.isSuccess()).isTrue();
    }

    @Test
    void snapshotThrowsWhenMissingUserId() {
        assertThatThrownBy(() -> controller.snapshot(null, 1L))
                .isInstanceOf(GlobalException.class);
    }

    @Test
    void snapshotReturnsOkResult() {
        SnapshotResponse snap = new SnapshotResponse(
                new ProjectDto(1L, "A", null, LocalDateTime.now(), "canvas"),
                null, List.of(), List.of(), List.of(), Map.of(), 5L);
        when(snapshotService.getSnapshot(1L, 10L)).thenReturn(snap);

        Result<SnapshotResponse> result = controller.snapshot(10L, 1L);

        assertThat(result.isSuccess()).isTrue();
        assertThat(result.getData().highWatermarkCursor()).isEqualTo(5L);
    }

    @Test
    void eventsThrowsWhenMissingUserId() {
        assertThatThrownBy(() -> controller.events(null, 1L, 0L, response))
                .isInstanceOf(GlobalException.class);
    }

    @Test
    void eventsReturnsSseEmitterWhenCursorValid() {
        doNothing().when(projectSseService).requireOwned(1L, 10L);
        when(projectSseService.isCursorExpired(1L, 0L)).thenReturn(false);
        SseEmitter emitter = new SseEmitter();
        when(projectSseService.subscribe(1L, 0L)).thenReturn(emitter);

        Object result = controller.events(10L, 1L, 0L, response);

        assertThat(result).isSameAs(emitter);
    }

    @Test
    void eventsReturnsExplicitGoneWhenCursorExpired() {
        doNothing().when(projectSseService).requireOwned(1L, 10L);
        when(projectSseService.isCursorExpired(1L, 4L)).thenReturn(true);

        assertThatThrownBy(() -> controller.events(10L, 1L, 4L, response))
                .isInstanceOf(GlobalException.class)
                .extracting(error -> ((GlobalException) error).getCode())
                .isEqualTo(SystemCode.CURSOR_EXPIRED_CODE);
    }
}
