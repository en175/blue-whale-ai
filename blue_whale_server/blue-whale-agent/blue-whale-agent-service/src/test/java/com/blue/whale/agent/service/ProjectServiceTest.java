package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.dto.CreateProjectRequest;
import com.blue.whale.agent.model.dto.ProjectDto;
import com.blue.whale.agent.model.dto.RenameProjectRequest;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.model.entity.ProjectEvent;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * {@link ProjectService} 单测：workspace 根 CRUD + 归属校验（ADR-0011 D1）+ 事件追加（ADR-0016）。
 * 全 mock {@link ProjectMapper}、{@link ProjectEventService}、{@link ProjectEventBus}，不连数据库。
 */
@ExtendWith(MockitoExtension.class)
class ProjectServiceTest {

    @Mock
    private ProjectMapper projectMapper;
    @Mock
    private ProjectEventService projectEventService;
    @Mock
    private ProjectEventBus eventBus;

    private ProjectService projectService;

    @BeforeEach
    void setUp() {
        projectService = new ProjectService(projectMapper, projectEventService, eventBus);
    }

    @Test
    void createInsertsWithOwnerId() {
        ArgumentCaptor<Project> captor = ArgumentCaptor.forClass(Project.class);
        when(projectMapper.insert(captor.capture())).thenAnswer(inv -> {
            captor.getValue().setId(1L);
            return 1;
        });
        when(projectEventService.appendEvent(anyLong(), anyString(), anyString(), anyString(),
                any(), any(), any(), any())).thenReturn(new ProjectEvent().setProjectId(1L).setCursor(1L));

        ProjectDto dto = projectService.create(10L, new CreateProjectRequest("我的项目"));

        assertThat(dto.id()).isEqualTo(1L);
        assertThat(dto.name()).isEqualTo("我的项目");
        assertThat(captor.getValue().getOwnerId()).isEqualTo(10L);
        verify(projectEventService).appendEvent(eq(1L), anyString(), anyString(), anyString(), any(), any(), any(), any());
    }

    @Test
    void listReturnsOnlyOwnerProjects() {
        Project p1 = new Project().setOwnerId(10L).setName("A");
        p1.setId(1L);
        when(projectMapper.selectList(any())).thenReturn(List.of(p1));

        List<ProjectDto> result = projectService.list(10L);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).name()).isEqualTo("A");
    }

    @Test
    void getReturnsDtoWhenOwned() {
        Project p = new Project().setOwnerId(10L).setName("A");
        p.setId(1L);
        when(projectMapper.selectById(1L)).thenReturn(p);

        ProjectDto dto = projectService.get(1L, 10L);

        assertThat(dto.id()).isEqualTo(1L);
    }

    @Test
    void getThrowsWhenNotExist() {
        when(projectMapper.selectById(99L)).thenReturn(null);

        assertThatThrownBy(() -> projectService.get(99L, 10L))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.DATA_NOT_EXIST_CODE);
    }

    @Test
    void getThrowsWhenNotOwned() {
        Project p = new Project().setOwnerId(10L).setName("A");
        p.setId(1L);
        when(projectMapper.selectById(1L)).thenReturn(p);

        assertThatThrownBy(() -> projectService.get(1L, 999L))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.DATA_NO_PERMISSION_OPERATE_CODE);
    }

    @Test
    void renameUpdatesNameWhenOwned() {
        Project p = new Project().setOwnerId(10L).setName("旧名");
        p.setId(1L);
        when(projectMapper.selectById(1L)).thenReturn(p);
        when(projectMapper.updateById(any(Project.class))).thenReturn(1);
        when(projectEventService.appendEvent(anyLong(), anyString(), anyString(), anyString(),
                any(), any(), any(), any())).thenReturn(new ProjectEvent().setProjectId(1L).setCursor(2L));

        ProjectDto dto = projectService.rename(1L, 10L, new RenameProjectRequest("新名"));

        assertThat(dto.name()).isEqualTo("新名");
        verify(projectMapper).updateById(argThat((Project saved) -> "新名".equals(saved.getName())));
        verify(projectEventService).appendEvent(eq(1L), anyString(), anyString(), anyString(), any(), any(), any(), any());
    }

    @Test
    void renameThrowsWhenNotOwned() {
        Project p = new Project().setOwnerId(10L).setName("旧名");
        p.setId(1L);
        when(projectMapper.selectById(1L)).thenReturn(p);

        assertThatThrownBy(() -> projectService.rename(1L, 999L, new RenameProjectRequest("新名")))
                .isInstanceOf(GlobalException.class);
        verify(projectMapper, never()).updateById(any(Project.class));
    }

    @Test
    void deleteRemovesWhenOwned() {
        Project p = new Project().setOwnerId(10L).setName("A");
        p.setId(1L);
        when(projectMapper.selectById(1L)).thenReturn(p);

        projectService.delete(1L, 10L);

        verify(projectMapper).deleteById(1L);
    }

    @Test
    void deleteThrowsWhenNotOwned() {
        Project p = new Project().setOwnerId(10L).setName("A");
        p.setId(1L);
        when(projectMapper.selectById(1L)).thenReturn(p);

        assertThatThrownBy(() -> projectService.delete(1L, 999L))
                .isInstanceOf(GlobalException.class);
        verify(projectMapper, never()).deleteById(any(Long.class));
    }

    @Test
    void requireOwnedReturnsProjectWhenOwned() {
        Project p = new Project().setOwnerId(10L).setName("A");
        p.setId(1L);
        when(projectMapper.selectById(1L)).thenReturn(p);

        Project result = projectService.requireOwned(1L, 10L);

        assertThat(result.getId()).isEqualTo(1L);
    }
}
