package com.blue.whale.agent;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.RenameProjectRequest;
import com.blue.whale.agent.model.dto.SnapshotResponse;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.ProjectEventService;
import com.blue.whale.agent.service.ProjectService;
import com.blue.whale.agent.service.SnapshotService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Connection;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;

/**
 * H2 环境只验证 Snapshot 的 Spring 事务属性及事务横跨并发提交的边界。
 * H2 的 REPEATABLE_READ 不等同于 MySQL/InnoDB 一致读；真实一致视图由
 * {@link SnapshotMySqlConsistencyIT} 在外部 MySQL 测试库上验证。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid"
})
@ActiveProfiles("test")
class SnapshotTransactionBoundaryIT {

    @Autowired
    private SnapshotService snapshotService;
    @Autowired
    private ProjectService projectService;
    @SpyBean
    private ProjectEventService projectEventService;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private PlatformTransactionManager transactionManager;

    @Test
    void snapshotUsesReadOnlyRepeatableReadTransactionAcrossConcurrentCommit() throws Exception {
        AtomicReference<Long> projectIdRef = new AtomicReference<>();
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            Project project = new Project().setOwnerId(10L).setName("before");
            projectMapper.insert(project);
            projectIdRef.set(project.getId());
            projectEventService.appendEvent(project.getId(), EventType.PROJECT_CREATED,
                    AggregateType.PROJECT, String.valueOf(project.getId()), 0,
                    Map.of("name", "before"), null, null);
        });
        Long projectId = projectIdRef.get();

        CountDownLatch snapshotReadHighWatermark = new CountDownLatch(1);
        CountDownLatch writerCommitted = new CountDownLatch(1);
        doAnswer(invocation -> {
            assertSnapshotTransaction();
            // H2 先读取游标只用于确定事务边界，不声称验证 MySQL 一致性视图。
            long highWatermark = (long) invocation.callRealMethod();
            snapshotReadHighWatermark.countDown();
            if (!writerCommitted.await(5, TimeUnit.SECONDS)) {
                throw new AssertionError("写事务未在超时前提交");
            }
            assertSnapshotTransaction();
            return highWatermark;
        }).when(projectEventService).highWatermark(projectId);

        ExecutorService snapshotExecutor = Executors.newSingleThreadExecutor();
        SnapshotResponse snapshot;
        try {
            Future<SnapshotResponse> future = snapshotExecutor.submit(
                    () -> snapshotService.getSnapshot(projectId, 10L));
            assertThat(snapshotReadHighWatermark.await(5, TimeUnit.SECONDS))
                    .as("快照事务应在写事务提交前读完高水位")
                    .isTrue();

            projectService.rename(projectId, 10L, new RenameProjectRequest("after"));
            writerCommitted.countDown();
            snapshot = future.get(5, TimeUnit.SECONDS);
        } finally {
            writerCommitted.countDown();
            snapshotExecutor.shutdownNow();
        }

        assertThat(snapshot.project().name()).isEqualTo("before");
        assertThat(snapshot.highWatermarkCursor()).isEqualTo(1L);

        SnapshotResponse latest = snapshotService.getSnapshot(projectId, 10L);
        assertThat(latest.project().name()).isEqualTo("after");
        assertThat(latest.highWatermarkCursor()).isEqualTo(2L);
    }

    private void assertSnapshotTransaction() {
        assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
        assertThat(TransactionSynchronizationManager.isCurrentTransactionReadOnly()).isTrue();
        assertThat(TransactionSynchronizationManager.getCurrentTransactionIsolationLevel())
                .isEqualTo(Connection.TRANSACTION_REPEATABLE_READ);
    }
}
