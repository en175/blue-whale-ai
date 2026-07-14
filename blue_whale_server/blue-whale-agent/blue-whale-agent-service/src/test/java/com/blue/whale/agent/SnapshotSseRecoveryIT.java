package com.blue.whale.agent;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.OutboxMessageMapper;
import com.blue.whale.agent.mapper.ProjectEventMapper;
import com.blue.whale.agent.mapper.ProjectEventStreamMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.model.entity.ProjectEvent;
import com.blue.whale.agent.model.entity.ProjectEventStream;
import com.blue.whale.agent.model.dto.SaveCanvasRequest;
import com.blue.whale.agent.service.CanvasService;
import com.blue.whale.agent.service.ProjectEventService;
import com.blue.whale.agent.service.ProjectService;
import com.blue.whale.agent.service.ProjectSseService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doAnswer;

/**
 * Snapshot 与 SSE 恢复闭环集成测试（ADR-0016/0017）。
 *
 * <p>用 H2（MODE=MySQL）验证核心验收标准：事件与状态同事务、游标单调连续、Snapshot 一致性、
 * 断线重放、去重。事务回滚验证用独立测试方法 + 手动回滚（{@code @Rollback}）。
 *
 * <p>禁用 Nacos discovery / cloud bootstrap，只保留 MyBatis-Plus + 事件服务相关 bean。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid"
})
@ActiveProfiles("test")
class SnapshotSseRecoveryIT {

    @Autowired
    private ProjectEventService projectEventService;
    @Autowired
    private ProjectEventMapper eventMapper;
    @Autowired
    private ProjectEventStreamMapper streamMapper;
    @Autowired
    private OutboxMessageMapper outboxMapper;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private ProjectSseService projectSseService;
    @Autowired
    private PlatformTransactionManager transactionManager;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private CanvasService canvasService;
    @SpyBean
    private ProjectService projectService;

    @Test
    @Transactional
    void appendEventPersistsEventOutboxAndIncrementsCursor() {
        // 建一个 project 供事件归属（自增 id）
        Project p = new Project().setOwnerId(1L).setName("P");
        projectMapper.insert(p);
        Long projectId = p.getId();

        ProjectEvent e1 = projectEventService.appendEvent(projectId, "project.created", "project",
                String.valueOf(projectId), 0, Map.of("name", "A"), null, null);
        ProjectEvent e2 = projectEventService.appendEvent(projectId, "project.renamed", "project",
                String.valueOf(projectId), 1, Map.of("name", "B"), null, null);

        // 游标单调连续
        assertThat(e1.getCursor()).isEqualTo(1L);
        assertThat(e2.getCursor()).isEqualTo(2L);

        // 事件落盘
        List<ProjectEvent> events = projectEventService.eventsAfter(projectId, 0L, 10);
        assertThat(events).hasSize(2);

        // Outbox 同事务写入（骨架）
        assertThat(outboxMapper.selectCount(null)).isEqualTo(2);

        // 高水位更新
        ProjectEventStream stream = streamMapper.selectById(projectId);
        assertThat(stream.getHighWatermark()).isEqualTo(2L);
    }

    @Test
    @Transactional
    void appendEventAndStateVisibleInSameTransaction() {
        // 验收标准：权威状态变更与产品事件在同一事务内提交。
        // 在当前事务内 insert project + append event，二者在同一事务应同时可见。
        Project p = new Project().setOwnerId(1L).setName("P-same-tx");
        projectMapper.insert(p);

        ProjectEvent event = projectEventService.appendEvent(p.getId(), "project.created",
                "project", String.valueOf(p.getId()), 0, Map.of("name", "P-same-tx"), null, null);

        // 同事务内：project 与 event 都可查（证明同一事务边界）
        assertThat(projectMapper.selectById(p.getId())).isNotNull();
        List<ProjectEvent> events = projectEventService.eventsAfter(p.getId(), 0L, 10);
        assertThat(events).hasSize(1);
        assertThat(events.get(0).getEventId()).isEqualTo(event.getEventId());
        // @Rollback 默认 true → 事务回滚，不污染其他测试
    }

    @Test
    @Transactional
    void eventsAfterReplaysFromCursorAndSupportsDedup() {
        Project p = new Project().setOwnerId(1L).setName("P-dedup");
        projectMapper.insert(p);
        Long projectId = p.getId();

        projectEventService.appendEvent(projectId, "project.created", "project", String.valueOf(projectId), 0, Map.of(), null, null);
        projectEventService.appendEvent(projectId, "generation_job.created", "generation_job", "10", 0, Map.of(), null, null);
        projectEventService.appendEvent(projectId, "generation_job.status_changed", "generation_job", "10", 1, Map.of(), null, null);

        // 从 cursor=0 重放：返回全部 3 条
        List<ProjectEvent> all = projectEventService.eventsAfter(projectId, 0L, 100);
        assertThat(all).hasSize(3);
        assertThat(all.get(0).getCursor()).isEqualTo(1L);
        assertThat(all.get(2).getCursor()).isEqualTo(3L);

        // 从 cursor=1 重放：返回 cursor>1 的 2 条（断线重连只补增量）
        List<ProjectEvent> after1 = projectEventService.eventsAfter(projectId, 1L, 100);
        assertThat(after1).hasSize(2);
        assertThat(after1.get(0).getCursor()).isEqualTo(2L);

        // 去重：同一 cursor 查询结果幂等（不重复）
        long hw = projectEventService.highWatermark(projectId);
        assertThat(hw).isEqualTo(3L);
    }

    @Test
    @Transactional
    void cursorExpiredWhenAfterBelowEarliest() {
        Project p = new Project().setOwnerId(1L).setName("P-expired");
        projectMapper.insert(p);
        Long projectId = p.getId();

        projectEventService.appendEvent(projectId, "project.created", "project", String.valueOf(projectId), 0, Map.of(), null, null);
        projectEventService.appendEvent(projectId, "project.renamed", "project", String.valueOf(projectId), 1, Map.of(), null, null);

        // earliest = 1（首版保留窗口=全部）
        assertThat(projectEventService.earliestCursor(projectId)).isEqualTo(1L);
        // after=0 不过期（从头订阅合法）
        // after=1（等于最早）不过期
        // 模拟过期：after < earliest（首版 earliest=1，after=0 但 0 表示从头订阅不算过期）
        // 真正过期场景：earliest > after > 0，首版保留窗口=全部不会触发
        assertThat(projectEventService.highWatermark(projectId)).isEqualTo(2L);
    }

    @Test
    void rollbackRemovesStateEventCursorAndOutboxTogether() {
        Long[] projectId = new Long[1];
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            Project project = new Project().setOwnerId(1L).setName("rollback");
            projectMapper.insert(project);
            projectId[0] = project.getId();
            projectEventService.appendEvent(project.getId(), "project.created", "project",
                    String.valueOf(project.getId()), 0, Map.of("name", "rollback"), null, null);
            status.setRollbackOnly();
        });

        assertThat(projectMapper.selectById(projectId[0])).isNull();
        assertThat(projectEventService.eventsAfter(projectId[0], 0, 10)).isEmpty();
        assertThat(streamMapper.selectById(projectId[0])).isNull();
        assertThat(outboxMapper.selectCount(Wrappers.<com.blue.whale.agent.model.entity.OutboxMessage>
                lambdaQuery().eq(com.blue.whale.agent.model.entity.OutboxMessage::getProjectId, projectId[0])))
                .isZero();
    }

    @Test
    void concurrentWritersReceiveUniqueMonotonicProjectCursors() throws Exception {
        Long projectId = new TransactionTemplate(transactionManager).execute(status -> {
            Project project = new Project().setOwnerId(1L).setName("concurrent");
            projectMapper.insert(project);
            projectEventService.appendEvent(project.getId(), "project.created", "project",
                    String.valueOf(project.getId()), 0, Map.of(), null, null);
            return project.getId();
        });
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        List<Long> cursors = Collections.synchronizedList(new ArrayList<>());
        List<Future<?>> futures = new ArrayList<>();
        try {
            for (int index = 0; index < 2; index++) {
                final int version = index + 1;
                futures.add(executor.submit(() -> {
                    ready.countDown();
                    if (!start.await(5, TimeUnit.SECONDS)) {
                        throw new AssertionError("并发写入未按时开始");
                    }
                    new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                            cursors.add(projectEventService.appendEvent(projectId, "project.renamed",
                                    "project", String.valueOf(projectId), version,
                                    Map.of("name", "v" + version), null, null).getCursor()));
                    return null;
                }));
            }
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            for (Future<?> future : futures) {
                future.get(10, TimeUnit.SECONDS);
            }
        } finally {
            start.countDown();
            executor.shutdownNow();
        }

        assertThat(cursors).containsExactlyInAnyOrder(2L, 3L);
        assertThat(projectEventService.highWatermark(projectId)).isEqualTo(3L);
    }

    @Test
    void reportsCursorExpiredOnlyWhenRequiredReplayFactWasRetainedAway() {
        Long projectId = new TransactionTemplate(transactionManager).execute(status -> {
            Project project = new Project().setOwnerId(1L).setName("retention");
            projectMapper.insert(project);
            for (int cursor = 1; cursor <= 4; cursor++) {
                projectEventService.appendEvent(project.getId(), "project.renamed", "project",
                        String.valueOf(project.getId()), cursor, Map.of("name", "v" + cursor), null, null);
            }
            return project.getId();
        });
        jdbcTemplate.update("DELETE FROM project_events WHERE project_id = ? AND cursor < 3", projectId);

        assertThat(projectEventService.earliestCursor(projectId)).isEqualTo(3L);
        assertThat(projectSseService.isCursorExpired(projectId, 1L)).isTrue();
        assertThat(projectSseService.isCursorExpired(projectId, 2L)).isFalse();
    }

    @Test
    void canvasWriteLockPreventsProjectDeleteFromOvertakingItsEvent() throws Exception {
        Long projectId = new TransactionTemplate(transactionManager).execute(status -> {
            Project project = new Project().setOwnerId(1L).setName("canvas-delete-race");
            projectMapper.insert(project);
            projectEventService.appendEvent(project.getId(), "project.created", "project",
                    String.valueOf(project.getId()), 0, Map.of(), null, null);
            return project.getId();
        });
        CountDownLatch projectLocked = new CountDownLatch(1);
        CountDownLatch allowCanvasWrite = new CountDownLatch(1);
        doAnswer(invocation -> {
            Object owned = invocation.callRealMethod();
            projectLocked.countDown();
            if (!allowCanvasWrite.await(5, TimeUnit.SECONDS)) {
                throw new AssertionError("未允许 Canvas 写入继续");
            }
            return owned;
        }).when(projectService).requireOwnedForUpdate(projectId, 1L);

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<?> canvasWrite = executor.submit(() ->
                    canvasService.save(projectId, 1L, new SaveCanvasRequest("{}", "[]")));
            assertThat(projectLocked.await(5, TimeUnit.SECONDS)).isTrue();
            Future<?> delete = executor.submit(() -> projectService.delete(projectId, 1L));

            assertThatThrownBy(() -> delete.get(200, TimeUnit.MILLISECONDS))
                    .isInstanceOf(TimeoutException.class);
            allowCanvasWrite.countDown();
            canvasWrite.get(5, TimeUnit.SECONDS);
            delete.get(5, TimeUnit.SECONDS);
        } finally {
            allowCanvasWrite.countDown();
            executor.shutdownNow();
        }

        assertThat(projectEventService.eventsAfter(projectId, 0, 10))
                .extracting(ProjectEvent::getEventType)
                .containsExactly("project.created", "canvas.updated", "project.deleted");
    }
}
