package com.blue.whale.agent;

import com.blue.whale.agent.mapper.OutboxMessageMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.SnapshotResponse;
import com.blue.whale.agent.model.entity.OutboxMessage;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.model.entity.ProjectEvent;
import com.blue.whale.agent.service.OutboxPublisher;
import com.blue.whale.agent.service.ProjectEventNotification;
import com.blue.whale.agent.service.ProjectEventNotifier;
import com.blue.whale.agent.service.ProjectEventService;
import com.blue.whale.agent.service.SnapshotService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * IK1W1M：真实 MySQL 上的产品事件持久化、Outbox 发布、Snapshot 读取与 SSE 续传路径。
 *
 * <p>物理列已去保留字（event_cursor），领域字段与公开契约仍为 cursor。
 * 物理列断言直接用裸列名 event_cursor 查询，证明不依赖保留字引用。
 * 仅在显式提供专用测试库连接时运行；默认环境明确跳过。
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
class CursorStorageMySqlIT {

    private static final String MYSQL_DRIVER = "com.mysql.cj.jdbc.Driver";
    private static final long OWNER_ID = 10L;

    @Autowired
    private ProjectEventService projectEventService;
    @Autowired
    private SnapshotService snapshotService;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private OutboxMessageMapper outboxMessageMapper;
    @Autowired
    private PlatformTransactionManager transactionManager;
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
    void appendEventPersistsEventAndPendingOutboxAtomicallyWithSameCursor() {
        List<ProjectEvent> events = new ArrayList<>();
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            insertProject();
            events.add(projectEventService.appendEvent(projectId, EventType.PROJECT_CREATED,
                    AggregateType.PROJECT, String.valueOf(projectId), 0,
                    Map.of("name", "cursor-storage"), null, null));
            events.add(projectEventService.appendEvent(projectId, EventType.PROJECT_RENAMED,
                    AggregateType.PROJECT, String.valueOf(projectId), 1,
                    Map.of("name", "cursor-storage-2"), null, null));
        });

        // 物理列为 event_cursor：裸列名查询（不依赖保留字引用），游标与领域 cursor 一致
        List<Long> physical = jdbcTemplate.queryForList(
                "SELECT event_cursor FROM project_events WHERE project_id = ? ORDER BY event_cursor",
                Long.class, projectId);
        assertThat(physical).containsExactly(1L, 2L);
        assertThat(events).extracting(ProjectEvent::getCursor).containsExactly(1L, 2L);

        // 同一事务形成可发布的 pending Outbox，message_id 复用事件身份，游标一致、顺序一致
        List<String> outbox = jdbcTemplate.query(
                "SELECT message_id, event_cursor, status FROM outbox_messages"
                        + " WHERE project_id = ? ORDER BY event_cursor",
                (rs, rowNum) -> rs.getString(1) + "|" + rs.getLong(2) + "|" + rs.getString(3),
                projectId);
        assertThat(outbox).containsExactly(
                events.get(0).getEventId() + "|1|" + OutboxMessage.STATUS_PENDING,
                events.get(1).getEventId() + "|2|" + OutboxMessage.STATUS_PENDING);
    }

    @Test
    void sseReplayAfterCursorNReturnsOnlyGreaterCursorsInOrderAndSnapshotExposesHighWatermark() {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            insertProject();
            for (int i = 0; i < 3; i++) {
                projectEventService.appendEvent(projectId, EventType.PROJECT_RENAMED,
                        AggregateType.PROJECT, String.valueOf(projectId), i,
                        Map.of("seq", i), null, null);
            }
        });

        // SSE 续传：after=1 只重放 cursor > 1 的事件，按游标升序
        List<ProjectEvent> replay = projectEventService.eventsAfter(projectId, 1L, 10);
        assertThat(replay).extracting(ProjectEvent::getCursor).containsExactly(2L, 3L);

        // Snapshot 继续公开 high_watermark_cursor
        SnapshotResponse snapshot = snapshotService.getSnapshot(projectId, OWNER_ID);
        assertThat(snapshot.highWatermarkCursor()).isEqualTo(3L);
    }

    @Test
    void outboxPublisherDeliversPendingInOrderPreservingMessageIdentityAndCursor() {
        List<ProjectEvent> events = new ArrayList<>();
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            insertProject();
            for (int i = 0; i < 2; i++) {
                events.add(projectEventService.appendEvent(projectId, EventType.PROJECT_RENAMED,
                        AggregateType.PROJECT, String.valueOf(projectId), i,
                        Map.of("seq", i), null, null));
            }
        });

        List<ProjectEventNotification> captured = new ArrayList<>();
        ProjectEventNotifier capturingNotifier = new ProjectEventNotifier() {
            @Override
            public void publish(ProjectEventNotification notification) {
                captured.add(notification);
            }

            @Override
            public void subscribe(Consumer<ProjectEventNotification> subscriber) {
                // 本测试不订阅
            }
        };
        OutboxPublisher publisher = new OutboxPublisher(outboxMessageMapper, capturingNotifier);
        publisher.publishDue();

        // 发布顺序与消息身份（messageId=eventId、projectId、cursor）保持不变
        assertThat(captured).containsExactly(
                new ProjectEventNotification(events.get(0).getEventId(), projectId, 1L),
                new ProjectEventNotification(events.get(1).getEventId(), projectId, 2L));
        List<String> statuses = jdbcTemplate.queryForList(
                "SELECT status FROM outbox_messages WHERE project_id = ? ORDER BY event_cursor",
                String.class, projectId);
        assertThat(statuses).containsExactly(OutboxMessage.STATUS_PUBLISHED, OutboxMessage.STATUS_PUBLISHED);
    }

    private void insertProject() {
        Project project = new Project()
                .setOwnerId(OWNER_ID)
                .setName("cursor-it-" + UUID.randomUUID());
        projectMapper.insert(project);
        projectId = project.getId();
    }
}
