package com.blue.whale.agent.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.RTopic;
import org.redisson.api.RedissonClient;
import org.redisson.client.codec.StringCodec;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/** Redis 跨实例唤醒器；消息仅触发各实例从数据库追平，不承载产品事实。 */
@Slf4j
public class RedisProjectEventNotifier implements ProjectEventNotifier {

    private final RTopic topic;
    private final ObjectMapper objectMapper;
    private final List<Consumer<ProjectEventNotification>> subscribers = new CopyOnWriteArrayList<>();

    public RedisProjectEventNotifier(RedissonClient redisson,
                                     ObjectMapper objectMapper,
                                     String channel) {
        this.topic = redisson.getTopic(channel, StringCodec.INSTANCE);
        this.objectMapper = objectMapper;
        this.topic.addListener(String.class, (ignored, message) -> {
            try {
                notifySubscribers(deserialize(message));
            } catch (IllegalArgumentException exception) {
                log.warn("ignored invalid Project event notification", exception);
            }
        });
    }

    @Override
    public void publish(ProjectEventNotification notification) {
        try {
            topic.publish(objectMapper.writeValueAsString(notification));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize Project event notification", e);
        }
    }

    @Override
    public void subscribe(Consumer<ProjectEventNotification> subscriber) {
        subscribers.add(subscriber);
    }

    private ProjectEventNotification deserialize(String message) {
        try {
            return objectMapper.readValue(message, ProjectEventNotification.class);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Invalid Project event notification", e);
        }
    }

    private void notifySubscribers(ProjectEventNotification notification) {
        subscribers.forEach(subscriber -> subscriber.accept(notification));
    }
}
