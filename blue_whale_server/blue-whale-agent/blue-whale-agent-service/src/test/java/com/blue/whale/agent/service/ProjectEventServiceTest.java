package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.OutboxMessageMapper;
import com.blue.whale.agent.mapper.ProjectEventMapper;
import com.blue.whale.agent.mapper.ProjectEventStreamMapper;
import com.blue.whale.agent.model.entity.ProjectEvent;
import com.blue.whale.agent.model.entity.ProjectEventStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * {@link ProjectEventService} 单测：游标分配递增、event_id 生成、事件与 Outbox 同事务写入。
 * 事务原子性与回滚语义由 H2 集成测试覆盖。
 */
@ExtendWith(MockitoExtension.class)
class ProjectEventServiceTest {

    @Mock
    private ProjectEventStreamMapper eventStreamMapper;
    @Mock
    private ProjectEventMapper eventMapper;
    @Mock
    private OutboxMessageMapper outboxMapper;

    @InjectMocks
    private ProjectEventService projectEventService;

    @Test
    void appendEventIncrementsCursorAndPersistsEventAndOutbox() {
        ProjectEventStream stream = new ProjectEventStream().setProjectId(1L).setHighWatermark(5L);
        when(eventStreamMapper.selectForUpdate(1L)).thenReturn(stream);
        when(eventMapper.insert(any())).thenAnswer(inv -> {
            ((ProjectEvent) inv.getArgument(0)).setId(100L);
            return 1;
        });

        ProjectEvent event = projectEventService.appendEvent(1L, "project.created", "project",
                "1", 0, Map.of("name", "A"), null, null);

        assertThat(event.getCursor()).isEqualTo(6L);
        assertThat(event.getEventId()).startsWith("evt_");
        assertThat(event.getProjectId()).isEqualTo(1L);
        // 高水位递增到 6
        assertThat(stream.getHighWatermark()).isEqualTo(6L);
        verify(eventStreamMapper).updateById(stream);
        verify(eventMapper).insert(any());
        verify(outboxMapper).insert(any());
    }

    @Test
    void appendEventInitializesStreamWhenAbsent() {
        when(eventStreamMapper.selectForUpdate(1L)).thenReturn(null);
        when(eventMapper.insert(any())).thenAnswer(inv -> {
            ((ProjectEvent) inv.getArgument(0)).setId(1L);
            return 1;
        });

        ProjectEvent event = projectEventService.appendEvent(1L, "project.created", "project",
                "1", 0, Map.of("name", "A"), null, null);

        // 首次初始化：插入高水位行（0），第一个事件游标=1
        ArgumentCaptor<ProjectEventStream> captor = ArgumentCaptor.forClass(ProjectEventStream.class);
        verify(eventStreamMapper).insert(captor.capture());
        assertThat(captor.getValue().getHighWatermark()).isEqualTo(0L);
        assertThat(event.getCursor()).isEqualTo(1L);
    }

    @Test
    void highWatermarkReturnsZeroWhenStreamAbsent() {
        when(eventStreamMapper.selectById(1L)).thenReturn(null);

        assertThat(projectEventService.highWatermark(1L)).isEqualTo(0L);
    }
}
