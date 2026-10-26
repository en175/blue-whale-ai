package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.ProjectEventEntity;
import com.bluewhale.worker.infrastructure.persistence.mapper.ProjectEventMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProjectEventPublisherTest {

    private static final long PROJECT_ID = 42L;

    @Test
    @DisplayName("游标冲突后重新取号并写入成功")
    void retriesWithFreshCursorOnDuplicateKey() {
        ProjectEventMapper mapper = mock(ProjectEventMapper.class);
        List<Long> cursors = new ArrayList<>();
        when(mapper.nextCursor(PROJECT_ID)).thenReturn(1L, 2L);
        when(mapper.insert(any(ProjectEventEntity.class))).thenAnswer(invocation -> {
            ProjectEventEntity event = invocation.getArgument(0);
            cursors.add(event.getCursor());
            if (cursors.size() == 1) {
                throw new DuplicateKeyException("uk_project_cursor");
            }
            return 1;
        });

        new ProjectEventPublisher(mapper).publish(PROJECT_ID, "generation_job.status_changed",
                "generation_job", "7", 0, "job_7", Map.of("status", "cancelled"));

        assertThat(cursors).containsExactly(1L, 2L);
        verify(mapper, times(2)).insert(any(ProjectEventEntity.class));
    }

    @Test
    @DisplayName("连续三次游标冲突后抛出唯一键异常")
    void givesUpAfterMaxAttempts() {
        ProjectEventMapper mapper = mock(ProjectEventMapper.class);
        when(mapper.nextCursor(PROJECT_ID)).thenReturn(1L);
        when(mapper.insert(any(ProjectEventEntity.class)))
                .thenThrow(new DuplicateKeyException("uk_project_cursor"));

        ProjectEventPublisher publisher = new ProjectEventPublisher(mapper);
        assertThatThrownBy(() -> publisher.publish(PROJECT_ID, "generation_job.status_changed",
                "generation_job", "7", 0, "job_7", Map.of("status", "cancelled")))
                .isInstanceOf(DuplicateKeyException.class);
        verify(mapper, times(3)).insert(any(ProjectEventEntity.class));
    }
}
