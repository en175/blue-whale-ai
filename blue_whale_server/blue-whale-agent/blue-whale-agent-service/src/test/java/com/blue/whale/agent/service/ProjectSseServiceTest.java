package com.blue.whale.agent.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ProjectSseServiceTest {

    @Test
    void cursorExpiresOnlyWhenTheNextRequiredEventWasAlreadyRemoved() {
        ProjectService projectService = mock(ProjectService.class);
        ProjectEventService eventService = mock(ProjectEventService.class);
        ProjectEventBus eventBus = mock(ProjectEventBus.class);
        when(eventService.earliestCursor(1L)).thenReturn(5L);
        ProjectSseService service = new ProjectSseService(projectService, eventService, eventBus);

        assertThat(service.isCursorExpired(1L, 0L)).isFalse();
        assertThat(service.isCursorExpired(1L, 4L)).isFalse();
        assertThat(service.isCursorExpired(1L, 3L)).isTrue();
    }
}
