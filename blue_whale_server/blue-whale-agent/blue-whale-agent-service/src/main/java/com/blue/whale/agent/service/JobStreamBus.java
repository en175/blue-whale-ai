package com.blue.whale.agent.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Instant;
import java.util.Deque;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

/**
 * 流式 job 内存事件总线：后台 {@code GenerationStreamService} 发事件，
 * {@code JobController} 的 {@link SseEmitter} 订阅。
 *
 * <p>订阅时先补发 history（解决订阅晚于首张图）；若 history 末尾已是终态事件（§6.8），
 * 补发完立即 complete emitter，不挂到 timeout。{@link #complete} 终态后挂一次性延迟任务
 * （§6.7）在 {@link #HISTORY_TTL_MS} 后清 history，防 Map key 维度泄漏；TTL 窗口内重订阅
 * 仍可据 history 重建终态。history 上限 {@link #MAX_HISTORY}，超限丢最旧。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JobStreamBus {

    private static final int MAX_HISTORY = 200;
    /** §6.7：job 终态后 history 保留窗口（ms），过窗清理防泄漏；留窗纯兜底重订阅重建终态。 */
    private static final long HISTORY_TTL_MS = 60_000L;
    /** 终态事件类型：补发到末尾即视为流结束（§6.8 短路 complete）。 */
    private static final Set<String> TERMINAL_TYPES = Set.of("done", "error");

    @Qualifier("streamSweeperScheduler")
    private final ThreadPoolTaskScheduler streamSweeperScheduler;

    private final Map<Long, Deque<SsePayload>> history = new ConcurrentHashMap<>();
    private final Map<Long, Set<SseEmitter>> subscribers = new ConcurrentHashMap<>();

    /** 发事件：append history（限长）+ 推给当前订阅者（单个失败不影响其他）。 */
    public void emit(Long jobId, SsePayload payload) {
        Deque<SsePayload> deque = history.computeIfAbsent(jobId, k -> new ConcurrentLinkedDeque<>());
        deque.addLast(payload);
        while (deque.size() > MAX_HISTORY) {
            deque.pollFirst();
        }
        Set<SseEmitter> emitters = subscribers.get(jobId);
        if (emitters == null) {
            return;
        }
        for (SseEmitter emitter : emitters) {
            send(emitter, payload);
        }
    }

    /** 订阅：先补发 history，再注册 emitter；emitter 结束回调里注销。 */
    public void subscribe(Long jobId, SseEmitter emitter) {
        Deque<SsePayload> deque = history.get(jobId);
        if (deque != null) {
            for (SsePayload payload : deque) {
                if (!send(emitter, payload)) {
                    return; // 补发失败（连接已断），不再注册
                }
            }
        }
        // §6.8：history 末尾已是终态事件（done/error），job 不会再产新事件——补发完立即收尾，
        // 不注册、不挂到 SseEmitter timeout，避免终态 job 重连空占连接成僵尸。
        SsePayload last = deque == null ? null : deque.peekLast();
        if (last != null && isTerminal(last)) {
            try {
                emitter.complete();
            } catch (Exception e) {
                log.debug("terminal complete failed, jobId={}", jobId, e);
            }
            return;
        }
        subscribers.computeIfAbsent(jobId, k -> ConcurrentHashMap.newKeySet()).add(emitter);
        emitter.onCompletion(() -> unsubscribe(jobId, emitter));
        emitter.onTimeout(() -> {
            emitter.complete();
            unsubscribe(jobId, emitter);
        });
        emitter.onError(t -> unsubscribe(jobId, emitter));
    }

    /**
     * 流结束：complete 所有订阅者，并挂一次性延迟任务在 {@link #HISTORY_TTL_MS} 后清 history（§6.7）。
     *
     * <p><b>不变量</b>：调用方（{@code GenerationStreamService#runImageStream}）必须保证本方法在
     * 终态事件（{@code done}/{@code error}）emit 之后调用，且终态后不再 emit 任何事件——这是
     * history TTL 清理语义正确的前提（否则 TTL 触发后迟到 emit 会写入无 TTL 守护的孤儿条目）。
     * history 在 TTL 窗口内仍可被 {@link #subscribe} 补发重建终态（配合 §6.8 终态短路立即收尾）。
     */
    public void complete(Long jobId) {
        Set<SseEmitter> emitters = subscribers.remove(jobId);
        if (emitters == null) {
            return;
        }
        for (SseEmitter emitter : emitters) {
            try {
                emitter.complete();
            } catch (Exception ignored) {
                // emitter 已关闭，忽略
            }
        }
        // §6.7：终态后挂 TTL 清 history，防 Map key 维度泄漏。保留短窗口供重订阅重建终态。
        streamSweeperScheduler.schedule(() -> {
            Deque<SsePayload> removed = history.remove(jobId);
            if (removed != null) {
                log.debug("history evicted, jobId={}, events={}", jobId, removed.size());
            }
        }, Instant.now().plusMillis(HISTORY_TTL_MS));
    }

    private boolean send(SseEmitter emitter, SsePayload payload) {
        try {
            // 不设 event name：全部走默认 message 通道，前端 EventSource.onmessage 统一收，按 data.type 分发。
            emitter.send(SseEmitter.event().data(payload, MediaType.APPLICATION_JSON));
            return true;
        } catch (IOException | IllegalStateException e) {
            log.debug("sse send failed, type={}: {}", payload.type(), e.getMessage());
            emitter.completeWithError(e);
            return false;
        }
    }

    private void unsubscribe(Long jobId, SseEmitter emitter) {
        Set<SseEmitter> emitters = subscribers.get(jobId);
        if (emitters != null) {
            emitters.remove(emitter);
        }
    }

    /** 是否终态事件（done/error）：补发到末尾即视为流结束。 */
    private boolean isTerminal(SsePayload payload) {
        return TERMINAL_TYPES.contains(payload.type());
    }
}
