package com.blue.whale.agent.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.redisson.api.RTopic;
import org.redisson.api.RedissonClient;
import org.redisson.api.listener.MessageListener;
import org.redisson.client.codec.Codec;

import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RedisProjectEventNotifierTest {

    @Test
    void publishesAndConsumesStableWakeupNotification() throws Exception {
        RedissonClient redisson = mock(RedissonClient.class);
        RTopic topic = mock(RTopic.class);
        when(redisson.getTopic(eq("project-events"), any(Codec.class))).thenReturn(topic);
        ObjectMapper objectMapper = new ObjectMapper();

        RedisProjectEventNotifier notifier =
                new RedisProjectEventNotifier(redisson, objectMapper, "project-events");
        @SuppressWarnings("unchecked")
        Consumer<ProjectEventNotification> subscriber = mock(Consumer.class);
        notifier.subscribe(subscriber);
        ProjectEventNotification notification = new ProjectEventNotification("9", 3L, 17L);

        notifier.publish(notification);

        ArgumentCaptor<String> published = ArgumentCaptor.forClass(String.class);
        verify(topic).publish(published.capture());
        assertThat(objectMapper.readValue(published.getValue(), ProjectEventNotification.class))
                .isEqualTo(notification);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<MessageListener<String>> listener =
                ArgumentCaptor.forClass(MessageListener.class);
        verify(topic).addListener(eq(String.class), listener.capture());
        listener.getValue().onMessage("project-events", published.getValue());
        verify(subscriber).accept(notification);
    }
}
