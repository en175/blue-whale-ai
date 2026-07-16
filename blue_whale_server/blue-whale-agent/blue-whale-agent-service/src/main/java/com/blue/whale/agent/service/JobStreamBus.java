package com.blue.whale.agent.service;

import com.blue.whale.agent.common.web.PublicRequestId;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Deque;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

/**
 * 流式 job 内存事件总线：后台 {@code GenerationStreamService} 发事件，
 * {@code JobController} 的 {@link SseEmitter} 订阅。
 *
 * <p>订阅时先补发 history（解决订阅晚于首张图），{@link #complete} 不清 history
 * （重订阅仍可据 history 重建终态）。history 上限 {@link #MAX_HISTORY}，超限丢最旧。
 */
@Slf4j
@Component
public class JobStreamBus {

    private static final int MAX_HISTORY = 200;

    private final Map<Long, Deque<SsePayload>> history = new ConcurrentHashMap<>();
    private final Map<Long, Set<SseSubscription>> subscribers = new ConcurrentHashMap<>();

    /** 发事件：append history（限长）+ 推给当前订阅者（单个失败不影响其他）。 */
    public void emit(Long jobId, SsePayload payload) {
        Deque<SsePayload> deque = history.computeIfAbsent(jobId, k -> new ConcurrentLinkedDeque<>());
        deque.addLast(payload);
        while (deque.size() > MAX_HISTORY) {
            deque.pollFirst();
        }
        Set<SseSubscription> subscriptions = subscribers.get(jobId);
        if (subscriptions == null) {
            return;
        }
        for (SseSubscription subscription : subscriptions) {
            send(subscription, payload);
        }
    }

    /** 订阅：先补发 history，再注册 emitter；emitter 结束回调里注销。 */
    public void subscribe(Long jobId, SseEmitter emitter) {
        SseSubscription subscription = new SseSubscription(emitter, PublicRequestId.current());
        Deque<SsePayload> deque = history.get(jobId);
        if (deque != null) {
            for (SsePayload payload : deque) {
                if (!send(subscription, payload)) {
                    return; // 补发失败（连接已断），不再注册
                }
            }
        }
        subscribers.computeIfAbsent(jobId, k -> ConcurrentHashMap.newKeySet()).add(subscription);
        emitter.onCompletion(() -> unsubscribe(jobId, subscription));
        emitter.onTimeout(() -> {
            emitter.complete();
            unsubscribe(jobId, subscription);
        });
        emitter.onError(t -> unsubscribe(jobId, subscription));
    }

    /** 流结束：complete 所有订阅者，history 保留供后续订阅重建终态。 */
    public void complete(Long jobId) {
        Set<SseSubscription> subscriptions = subscribers.remove(jobId);
        if (subscriptions == null) {
            return;
        }
        for (SseSubscription subscription : subscriptions) {
            try {
                subscription.emitter().complete();
            } catch (Exception ignored) {
                // emitter 已关闭，忽略
            }
        }
    }

    private boolean send(SseSubscription subscription, SsePayload payload) {
        SsePayload deliveryPayload = payload.withRequestId(subscription.requestId());
        try {
            // 不设 event name：全部走默认 message 通道，前端 EventSource.onmessage 统一收，按 data.type 分发。
            subscription.emitter().send(
                    SseEmitter.event().data(deliveryPayload, MediaType.APPLICATION_JSON));
            return true;
        } catch (IOException | IllegalStateException e) {
            log.debug("sse send failed, type={}: {}", payload.type(), e.getMessage());
            subscription.emitter().completeWithError(e);
            return false;
        }
    }

    private void unsubscribe(Long jobId, SseSubscription subscription) {
        Set<SseSubscription> subscriptions = subscribers.get(jobId);
        if (subscriptions != null) {
            subscriptions.remove(subscription);
        }
    }

    private record SseSubscription(SseEmitter emitter, String requestId) {

        private SseSubscription {
            if (requestId == null || requestId.isBlank()) {
                log.error("reject sse subscription without request_id");
                throw new IllegalStateException("SSE 订阅缺少 request_id");
            }
        }
    }
}
