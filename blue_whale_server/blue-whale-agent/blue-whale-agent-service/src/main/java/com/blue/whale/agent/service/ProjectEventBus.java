package com.blue.whale.agent.service;

import com.blue.whale.agent.model.dto.ProductEventDto;
import com.blue.whale.agent.model.entity.ProjectEvent;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * 本机 Project SSE 连接注册表。连接只保存最后已发送游标，产品事实始终从数据库分批追平。
 */
@Slf4j
@Component
public class ProjectEventBus {

    static final int REPLAY_BATCH_SIZE = 500;

    private final ProjectEventService eventService;
    private final Map<Long, ConcurrentMap<SseEmitter, Subscription>> subscribers = new ConcurrentHashMap<>();

    public ProjectEventBus(ProjectEventService eventService, ProjectEventNotifier notifier) {
        this.eventService = eventService;
        notifier.subscribe(notification -> notifyProject(notification.projectId()));
    }

    /** 先注册连接，再从持久事件表追平，消除“重放完成到注册之间”的竞态窗口。 */
    public boolean subscribe(Long projectId, long after, SseEmitter emitter) {
        Subscription subscription = new Subscription(projectId, after, emitter);
        subscribers.computeIfAbsent(projectId, ignored -> new ConcurrentHashMap<>())
                .put(emitter, subscription);
        emitter.onCompletion(() -> unsubscribe(subscription));
        emitter.onTimeout(() -> {
            unsubscribe(subscription);
            emitter.complete();
        });
        emitter.onError(ignored -> unsubscribe(subscription));
        return drain(subscription);
    }

    /** 通知只负责唤醒；每个连接从自己的最后游标查询数据库。 */
    public void notifyProject(Long projectId) {
        ConcurrentMap<SseEmitter, Subscription> projectSubscribers = subscribers.get(projectId);
        if (projectSubscribers == null) {
            return;
        }
        List.copyOf(projectSubscribers.values()).forEach(this::drain);
    }

    /** 心跳前先补漏，Redis 信号丢失或跨实例时仍能从数据库最终追平。 */
    public void heartbeat(Long projectId, SseEmitter emitter) {
        ConcurrentMap<SseEmitter, Subscription> projectSubscribers = subscribers.get(projectId);
        Subscription subscription = projectSubscribers == null ? null : projectSubscribers.get(emitter);
        if (subscription == null || !drain(subscription)) {
            return;
        }
        try {
            emitter.send(SseEmitter.event().comment("keepalive"));
        } catch (IOException | IllegalStateException exception) {
            fail(subscription, exception);
        }
    }

    private boolean drain(Subscription subscription) {
        subscription.drainLock.lock();
        try {
            while (isSubscribed(subscription)) {
                List<ProjectEvent> events = eventService.eventsAfter(
                        subscription.projectId, subscription.lastSentCursor, REPLAY_BATCH_SIZE);
                for (ProjectEvent event : events) {
                    if (!send(subscription, event)) {
                        return false;
                    }
                    subscription.lastSentCursor = event.getCursor();
                }
                if (events.size() < REPLAY_BATCH_SIZE) {
                    return true;
                }
            }
            return false;
        } finally {
            subscription.drainLock.unlock();
        }
    }

    private boolean send(Subscription subscription, ProjectEvent event) {
        ProductEventDto dto = ProductEventDto.from(event);
        try {
            subscription.emitter.send(SseEmitter.event()
                    .id(String.valueOf(dto.cursor()))
                    .name(dto.eventType())
                    .data(dto, MediaType.APPLICATION_JSON));
            return true;
        } catch (IOException | IllegalStateException exception) {
            fail(subscription, exception);
            return false;
        }
    }

    private void fail(Subscription subscription, Exception exception) {
        unsubscribe(subscription);
        log.debug("project sse send failed projectId={} cursor={}: {}",
                subscription.projectId, subscription.lastSentCursor, exception.getMessage());
        subscription.emitter.completeWithError(exception);
    }

    private boolean isSubscribed(Subscription subscription) {
        ConcurrentMap<SseEmitter, Subscription> projectSubscribers = subscribers.get(subscription.projectId);
        return projectSubscribers != null && projectSubscribers.get(subscription.emitter) == subscription;
    }

    private void unsubscribe(Subscription subscription) {
        ConcurrentMap<SseEmitter, Subscription> projectSubscribers = subscribers.get(subscription.projectId);
        if (projectSubscribers == null) {
            return;
        }
        projectSubscribers.remove(subscription.emitter, subscription);
        if (projectSubscribers.isEmpty()) {
            subscribers.remove(subscription.projectId, projectSubscribers);
        }
    }

    private static final class Subscription {
        private final Long projectId;
        private final SseEmitter emitter;
        private final ReentrantLock drainLock = new ReentrantLock();
        private long lastSentCursor;

        private Subscription(Long projectId, long lastSentCursor, SseEmitter emitter) {
            this.projectId = projectId;
            this.lastSentCursor = lastSentCursor;
            this.emitter = emitter;
        }
    }
}
