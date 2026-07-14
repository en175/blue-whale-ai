package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.OutboxMessageMapper;
import com.blue.whale.agent.model.entity.OutboxMessage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OutboxPublisherTest {

    @Mock
    private OutboxMessageMapper outboxMapper;
    @Mock
    private ProjectEventNotifier notifier;

    @Test
    void retryPublishesTheSameProductFactIdentity() {
        OutboxMessage message = new OutboxMessage()
                .setMessageId("evt_1")
                .setProjectId(7L)
                .setCursor(11L)
                .setStatus(OutboxMessage.STATUS_PENDING)
                .setAttemptCount(0);
        when(outboxMapper.selectList(any())).thenReturn(List.of(message));
        doThrow(new IllegalStateException("redis unavailable"))
                .doNothing()
                .when(notifier).publish(any(ProjectEventNotification.class));

        OutboxPublisher publisher = new OutboxPublisher(outboxMapper, notifier);
        publisher.publishDue();
        publisher.publishDue();

        ArgumentCaptor<ProjectEventNotification> notification =
                ArgumentCaptor.forClass(ProjectEventNotification.class);
        verify(notifier, times(2)).publish(notification.capture());
        assertThat(notification.getAllValues())
                .containsOnly(new ProjectEventNotification("evt_1", 7L, 11L));
        assertThat(message.getStatus()).isEqualTo(OutboxMessage.STATUS_PUBLISHED);
        assertThat(message.getAttemptCount()).isEqualTo(1);
        verify(outboxMapper, times(2)).updateById(message);
    }
}
