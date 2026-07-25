package com.blue.whale.agent.controller;

import com.blue.whale.agent.common.web.RestExceptionConfig;
import com.blue.whale.agent.service.ProjectService;
import com.blue.whale.agent.service.ProjectSseService;
import com.blue.whale.agent.service.SnapshotService;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class ProjectResourceSecurityWebTest {

    private MockMvc mockMvc;
    @Mock
    private ProjectService projectService;
    @Mock
    private SnapshotService snapshotService;
    @Mock
    private ProjectSseService projectSseService;

    @BeforeEach
    void setUp() {
        ProjectController controller = new ProjectController(
                projectService, snapshotService, projectSseService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new RestExceptionConfig())
                .build();
    }

    @Test
    void snapshotWithoutUserIdReturnsUnauthorized() throws Exception {
        mockMvc.perform(get("/api/projects/1/snapshot"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void missingOrUnownedSnapshotReturnsResourceNotFound() throws Exception {
        when(snapshotService.getSnapshot(1L, 10L))
                .thenThrow(new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在"));

        mockMvc.perform(get("/api/projects/1/snapshot").header("X-User-Id", "10"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(SystemCode.RESOURCE_NOT_FOUND_CODE));
    }

    @Test
    void missingOrUnownedEventStreamReturnsResourceNotFound() throws Exception {
        doThrow(new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在"))
                .when(projectSseService).requireOwned(1L, 10L);

        mockMvc.perform(get("/api/projects/1/events").header("X-User-Id", "10"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(SystemCode.RESOURCE_NOT_FOUND_CODE));
    }

    @Test
    void otherGlobalExceptionsKeepHttpOk() throws Exception {
        when(snapshotService.getSnapshot(1L, 10L))
                .thenThrow(new GlobalException(SystemCode.DATA_NOT_EXIST_CODE, "数据不存在"));

        mockMvc.perform(get("/api/projects/1/snapshot").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(SystemCode.DATA_NOT_EXIST_CODE));
    }

    @Test
    void validEventStreamStartsServletAsyncProcessing() throws Exception {
        when(projectSseService.isCursorExpired(1L, 5L)).thenReturn(false);
        when(projectSseService.subscribe(1L, 5L)).thenReturn(new SseEmitter());

        mockMvc.perform(get("/api/projects/1/events")
                        .header("X-User-Id", "10")
                        .param("after", "5"))
                .andExpect(status().isOk())
                .andExpect(request().asyncStarted());
    }

    @Test
    void expiredEventStreamReturnsRealHttpGone() throws Exception {
        when(projectSseService.isCursorExpired(1L, 4L)).thenReturn(true);

        mockMvc.perform(get("/api/projects/1/events")
                        .header("X-User-Id", "10")
                        .param("after", "4"))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value(SystemCode.CURSOR_EXPIRED_CODE));
    }
}
