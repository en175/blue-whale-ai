package com.blue.whale.agent.service;

import com.blue.whale.agent.model.dto.ProductEventDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Project 级进程内事件总线（ADR-0016 §3）。
 *
 * <p>维度是 {@code projectId}：产生产品事件的 Service 在事务 {@code afterCommit} 调 {@link #publish}
 * 推送给该 Project 的在线 SSE 订阅者。**不保留内存 history**——断线重连统一由 SSE 端点从 DB
 * 按 {@code after=cursor} 重放（ADR-0016 §3）。
 *
 * <p>SSE 帧格式：{@code id=<cursor>}、{@code event=<event_type>}、{@code data=<ProductEventDto>}。
 * 单个订阅者发送失败不影响其他订阅者。多实例部署时需替换为 Redis pub/sub（首版单实例不引入）。
 */
@Slf4j
@Component
public class ProjectEventBus {

    private final Map<Long, Set<SseEmitter>> subscribers = new ConcurrentHashMap<>();

    /**
     * 向该 Project 的所有在线订阅者推送一个事件。仅在事务提交后调用（afterCommit）。
     */
    public void publish(Long projectId, ProductEventDto event) {
        Set<SseEmitter> emitters = subscribers.get(projectId);
        if (emitters == null || emitters.isEmpty()) {
            return;
        }
        for (SseEmitter emitter : emitters) {
            send(emitter, event);
        }
    }

    /**
     * 注册一个 SSE 订阅者。emitter 结束（完成/超时/异常）时自动注销。
     */
    public void subscribe(Long projectId, SseEmitter emitter) {
        subscribers.computeIfAbsent(projectId, k -> ConcurrentHashMap.newKeySet()).add(emitter);
        emitter.onCompletion(() -> unsubscribe(projectId, emitter));
        emitter.onTimeout(() -> {
            emitter.complete();
            unsubscribe(projectId, emitter);
        });
        emitter.onError(t -> unsubscribe(projectId, emitter));
    }

    /** 发送心跳注释帧（不占游标，不写事件表，ADR-0016 §3）。 */
    public void sendHeartbeat(Long projectId) {
        Set<SseEmitter> emitters = subscribers.get(projectId);
        if (emitters == null || emitters.isEmpty()) {
            return;
        }
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().comment("keepalive"));
            } catch (IOException | IllegalStateException e) {
                log.debug("heartbeat send failed projectId={}: {}", projectId, e.getMessage());
                emitter.completeWithError(e);
            }
        }
    }

    private void send(SseEmitter emitter, ProductEventDto event) {
        try {
            emitter.send(SseEmitter.event()
                    .id(String.valueOf(event.cursor()))
                    .name(event.eventType())
                    .data(event, MediaType.APPLICATION_JSON));
        } catch (IOException | IllegalStateException e) {
            log.debug("event send failed cursor={}: {}", event.cursor(), e.getMessage());
            emitter.completeWithError(e);
        }
    }

    private void unsubscribe(Long projectId, SseEmitter emitter) {
        Set<SseEmitter> emitters = subscribers.get(projectId);
        if (emitters != null) {
            emitters.remove(emitter);
        }
    }
}
