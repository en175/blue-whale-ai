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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;

/**
 * MySQL/InnoDB 一致读验收测试。仅在显式提供专用测试库连接时运行；默认环境明确跳过。
 */
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_URL", matches = "jdbc:mysql://.+")
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_USERNAME", matches = ".+")
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_PASSWORD", matches = ".*")
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "spring.sql.init.mode=always",
        "spring.sql.init.schema-locations=classpath:db/schema-mysql-snapshot.sql",
        "volcengine.ark.base-url=https://ark.test.invalid"
})
@ActiveProfiles("test")
class SnapshotMySqlConsistencyIT {

    private static final String MYSQL_DRIVER = "com.mysql.cj.jdbc.Driver";

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
    @Autowired
    private DataSource dataSource;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    private Long projectId;

    @DynamicPropertySource
    static void mysqlProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.dynamic.datasource.master.url",
                () -> System.getenv("BLUE_WHALE_TEST_MYSQL_URL"));
        registry.add("spring.datasource.dynamic.datasource.master.username",
                () -> System.getenv("BLUE_WHALE_TEST_MYSQL_USERNAME"));
        registry.add("spring.datasource.dynamic.datasource.master.password",
                () -> System.getenv("BLUE_WHALE_TEST_MYSQL_PASSWORD"));
        registry.add("spring.datasource.dynamic.datasource.master.driver-class-name", () -> MYSQL_DRIVER);
        registry.add("spring.datasource.driver-class-name", () -> MYSQL_DRIVER);
    }

    @AfterEach
    void cleanUp() {
        if (projectId == null) {
            return;
        }
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            jdbcTemplate.update("DELETE FROM outbox_messages WHERE project_id = ?", projectId);
            jdbcTemplate.update("DELETE FROM project_events WHERE project_id = ?", projectId);
            jdbcTemplate.update("DELETE FROM project_event_stream WHERE project_id = ?", projectId);
            jdbcTemplate.update("DELETE FROM project WHERE id = ?", projectId);
        });
    }

    @Test
    void snapshotStateAndHighWatermarkUseSameMySqlConsistentRead() throws Exception {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            Project project = new Project()
                    .setOwnerId(10L)
                    .setName("before-" + UUID.randomUUID());
            projectMapper.insert(project);
            projectId = project.getId();
            projectEventService.appendEvent(projectId, EventType.PROJECT_CREATED,
                    AggregateType.PROJECT, String.valueOf(projectId), 0,
                    Map.of("name", project.getName()), null, null);
        });

        CountDownLatch snapshotReachedHighWatermark = new CountDownLatch(1);
        CountDownLatch writerCommitted = new CountDownLatch(1);
        doAnswer(invocation -> {
            assertMySqlSnapshotTransaction();
            snapshotReachedHighWatermark.countDown();
            if (!writerCommitted.await(10, TimeUnit.SECONDS)) {
                throw new AssertionError("MySQL 写事务未在超时前提交");
            }
            // 写事务已提交后才查询；MySQL RR 应继续读取 Snapshot 首次一致读创建的旧视图。
            return invocation.callRealMethod();
        }).when(projectEventService).highWatermark(projectId);

        ExecutorService snapshotExecutor = Executors.newSingleThreadExecutor();
        SnapshotResponse snapshot;
        try {
            Future<SnapshotResponse> future = snapshotExecutor.submit(
                    () -> snapshotService.getSnapshot(projectId, 10L));
            assertThat(snapshotReachedHighWatermark.await(10, TimeUnit.SECONDS))
                    .as("MySQL Snapshot 应在状态读取后到达高水位查询")
                    .isTrue();

            projectService.rename(projectId, 10L, new RenameProjectRequest("after"));
            writerCommitted.countDown();
            snapshot = future.get(10, TimeUnit.SECONDS);
        } finally {
            writerCommitted.countDown();
            snapshotExecutor.shutdownNow();
        }

        assertThat(snapshot.project().name()).startsWith("before-");
        assertThat(snapshot.highWatermarkCursor()).isEqualTo(1L);

        SnapshotResponse latest = snapshotService.getSnapshot(projectId, 10L);
        assertThat(latest.project().name()).isEqualTo("after");
        assertThat(latest.highWatermarkCursor()).isEqualTo(2L);
    }

    private void assertMySqlSnapshotTransaction() throws Exception {
        assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
        assertThat(TransactionSynchronizationManager.isCurrentTransactionReadOnly()).isTrue();
        assertThat(TransactionSynchronizationManager.getCurrentTransactionIsolationLevel())
                .isEqualTo(Connection.TRANSACTION_REPEATABLE_READ);
        Connection connection = DataSourceUtils.getConnection(dataSource);
        assertThat(connection.getMetaData().getDatabaseProductName()).containsIgnoringCase("mysql");
    }
}
