package com.blue.whale.agent.service;

import com.blue.whale.agent.model.dto.ProductEventDto;
import com.blue.whale.agent.model.entity.ProjectEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Project SSE 订阅服务（ADR-0016 §3）。
 *
 * <p>断线重连协议：客户端从最后已应用游标重连（{@code GET /events?after={cursor}}）。
 * 若游标已超过保留窗口，由 Controller 返回 {@code 410 CURSOR_EXPIRED}，客户端必须重新获取快照，
 * 不允许静默跳到最新位置（ADR-0016 §3）。
 *
 * <p>本服务负责：从 DB 重放历史事件（{@code after} 之后）→ 注册 {@link ProjectEventBus} 接收实时事件
 * → 启动心跳注释帧。重放与订阅注册之间再做一次 DB 查询兜底，避免重放结束到订阅注册之间的事件丢失。
 *
 * <p>交付语义为至少一次；客户端按 SSE {@code id}（等于 cursor）或 {@code event_id} 去重，
 * 并用 {@code aggregate_version} 拒绝旧状态（ADR-0016 §3）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectSseService {

    /** SSE 超时（30 分钟，长连接）。 */
    private static final long SSE_TIMEOUT_MS = 30 * 60 * 1000L;
    /** 心跳间隔（15 秒，注释帧不占游标）。 */
    private static final long HEARTBEAT_INTERVAL_SECONDS = 15;
    /** 单次重放上限。 */
    private static final int REPLAY_LIMIT = 500;

    private final ProjectService projectService;
    private final ProjectEventService projectEventService;
    private final ProjectEventBus eventBus;

    /** 心跳调度器（daemon 线程，进程内单实例）。 */
    private final ScheduledExecutorService heartbeatScheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "project-sse-heartbeat");
                t.setDaemon(true);
                return t;
            });

    /**
     * 创建并初始化一个 Project SSE 订阅。调用前必须已完成归属校验与游标过期检查。
     *
     * @param projectId 项目 ID
     * @param after     客户端最后已应用游标（从该游标之后重放）
     * @return 已注册订阅的 SseEmitter
     */
    public SseEmitter subscribe(Long projectId, long after) {
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);

        // 1. 重放 after 之后的历史事件
        long lastReplayed = replayHistory(projectId, after, emitter);
        if (lastReplayed < 0) {
            // 重放过程中连接已断，不再注册
            return emitter;
        }

        // 2. 注册实时订阅
        eventBus.subscribe(projectId, emitter);

        // 3. 兜底：重放结束到订阅注册之间可能产生新事件，再查一次补发
        long lastCursor = lastReplayed > after ? lastReplayed : after;
        long catchUpLast = replayHistory(projectId, lastCursor, emitter);
        if (catchUpLast > lastCursor) {
            lastCursor = catchUpLast;
        }

        // 4. 启动心跳（注释帧，不占游标）
        var future = heartbeatScheduler.scheduleAtFixedRate(
                () -> eventBus.sendHeartbeat(projectId), HEARTBEAT_INTERVAL_SECONDS,
                HEARTBEAT_INTERVAL_SECONDS, TimeUnit.SECONDS);
        emitter.onCompletion(() -> future.cancel(false));
        emitter.onTimeout(() -> future.cancel(false));
        emitter.onError(t -> future.cancel(false));

        log.debug("subscribe projectId={} after={} lastCursor={}", projectId, after, lastCursor);
        return emitter;
    }

    /**
     * 判断 {@code after} 游标是否在保留窗口内。超过窗口返回 true（Controller 应返回 410）。
     *
     * <p>首版保留窗口 = 全部（不 GC），只要 after 大于等于最早可用游标即有效；
     * after 小于最早游标（请求了已不存在的旧位置）判为过期。
     */
    public boolean isCursorExpired(Long projectId, long after) {
        if (after <= 0) {
            return false;
        }
        long earliest = projectEventService.earliestCursor(projectId);
        return earliest > 0 && after < earliest;
    }

    /** 校验归属，不通过抛 GlobalException（供 Controller 复用）。 */
    public void requireOwned(Long projectId, Long userId) {
        projectService.requireOwned(projectId, userId);
    }

    /**
     * 重放 {@code after} 之后的历史事件到 emitter。返回最后成功发送的游标（无事件返回 after，连接断返回 -1）。
     */
    private long replayHistory(Long projectId, long after, SseEmitter emitter) {
        List<ProjectEvent> events = projectEventService.eventsAfter(projectId, after, REPLAY_LIMIT);
        long last = after;
        for (ProjectEvent e : events) {
            if (!send(emitter, ProductEventDto.from(e))) {
                return -1;
            }
            last = e.getCursor();
        }
        return last;
    }

    private boolean send(SseEmitter emitter, ProductEventDto event) {
        try {
            emitter.send(SseEmitter.event()
                    .id(String.valueOf(event.cursor()))
                    .name(event.eventType())
                    .data(event, org.springframework.http.MediaType.APPLICATION_JSON));
            return true;
        } catch (IOException | IllegalStateException e) {
            log.debug("sse replay send failed cursor={}: {}", event.cursor(), e.getMessage());
            emitter.completeWithError(e);
            return false;
        }
    }
}
