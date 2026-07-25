package com.blue.whale.agent.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

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
 * <p>本服务先向 {@link ProjectEventBus} 注册连接，再由 EventBus 从 DB 追平 {@code after} 之后的事件，
 * 并启动带补漏查询的心跳。注册优先于查询，消除“重放结束到注册之间”的竞态窗口。
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

        if (!eventBus.subscribe(projectId, after, emitter)) {
            return emitter;
        }
        var future = heartbeatScheduler.scheduleAtFixedRate(
                () -> eventBus.heartbeat(projectId, emitter), HEARTBEAT_INTERVAL_SECONDS,
                HEARTBEAT_INTERVAL_SECONDS, TimeUnit.SECONDS);
        emitter.onCompletion(() -> future.cancel(false));
        emitter.onTimeout(() -> future.cancel(false));
        emitter.onError(t -> future.cancel(false));

        log.debug("subscribe projectId={} after={}", projectId, after);
        return emitter;
    }

    /**
     * 判断 {@code after} 游标是否在保留窗口内。超过窗口返回 true（Controller 应返回 410）。
     *
     * <p>若最早保留事件为 N，则 {@code after=N-1} 仍可完整接续；只有
     * {@code 0 < after < N-1} 才表示恢复所需事实已被清理。{@code after=0} 始终允许从头订阅。
     */
    public boolean isCursorExpired(Long projectId, long after) {
        if (after <= 0) {
            return false;
        }
        long earliest = projectEventService.earliestCursor(projectId);
        return earliest > 0 && after < earliest - 1;
    }

    /** 校验归属，不通过抛 GlobalException（供 Controller 复用）。 */
    public void requireOwned(Long projectId, Long userId) {
        projectService.requireOwned(projectId, userId);
    }

}
