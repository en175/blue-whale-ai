package com.blue.whale.agent.schema.migration;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * IK1W1M：cursor 保留字列迁移的真实 MySQL 验收（H2 不足以暴露 MySQL 方言问题）。
 *
 * <p>两条路径共用生产迁移链 {@code db/migrations/V*__*.sql}：
 * <ul>
 *   <li>全新库：迁移后 project_events/outbox_messages 物理列为非保留字 event_cursor，
 *       写入与分页查询不再需要引用保留字。</li>
 *   <li>已知旧库（V1 基线 + 既有事件/Outbox 数据）：升级后游标值、事件身份、payload、
 *       状态与重试元数据完整保留，(project_id, cursor) 顺序不变，V1 基线不被篡改（只补记）。</li>
 * </ul>
 *
 * <p>使用独立数据库（由 BLUE_WHALE_TEST_MYSQL_URL 推导，库名 bw_cursor_migration），
 * 不与其他 IT 共享表状态，可重复执行。仅在显式提供测试库连接时运行，默认环境明确跳过。
 */
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_URL", matches = "jdbc:mysql://.+")
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_USERNAME", matches = ".+")
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_PASSWORD", matches = ".*")
class CursorColumnMigrationMySqlIT {

    private static final Pattern MYSQL_URL = Pattern.compile("(jdbc:mysql://[^/]+)/([^?]+)(\\?.*)?");
    private static final String MIGRATION_DB = "bw_cursor_migration";

    private DataSource dataSource;

    @BeforeEach
    void setUp() throws Exception {
        String url = System.getenv("BLUE_WHALE_TEST_MYSQL_URL");
        Matcher m = MYSQL_URL.matcher(url);
        assertThat(m.matches()).as("BLUE_WHALE_TEST_MYSQL_URL 形如 jdbc:mysql://host:port/db?params").isTrue();
        String serverUrl = m.group(1) + "/" + (m.group(3) == null ? "" : m.group(3));
        String migrationDbUrl = m.group(1) + "/" + MIGRATION_DB + (m.group(3) == null ? "" : m.group(3));

        DriverManagerDataSource serverDs = new DriverManagerDataSource();
        serverDs.setDriverClassName("com.mysql.cj.jdbc.Driver");
        serverDs.setUrl(serverUrl);
        serverDs.setUsername(System.getenv("BLUE_WHALE_TEST_MYSQL_USERNAME"));
        serverDs.setPassword(System.getenv("BLUE_WHALE_TEST_MYSQL_PASSWORD"));
        try (Connection conn = serverDs.getConnection(); Statement st = conn.createStatement()) {
            st.execute("CREATE DATABASE IF NOT EXISTS " + MIGRATION_DB
                    + " DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci");
        }

        DriverManagerDataSource ds = new DriverManagerDataSource();
        ds.setDriverClassName("com.mysql.cj.jdbc.Driver");
        ds.setUrl(migrationDbUrl);
        ds.setUsername(System.getenv("BLUE_WHALE_TEST_MYSQL_USERNAME"));
        ds.setPassword(System.getenv("BLUE_WHALE_TEST_MYSQL_PASSWORD"));
        this.dataSource = ds;
        dropAllTables();
    }

    @Test
    void freshDatabaseMigratesToNonReservedCursorColumns() throws Exception {
        List<Integer> applied = new SchemaMigrationService(dataSource).migrate();

        assertThat(applied).containsExactly(1, 2, 3, 4);
        assertThat(columnExists("project_events", "event_cursor")).isTrue();
        assertThat(columnExists("project_events", "cursor")).isFalse();
        assertThat(columnExists("outbox_messages", "event_cursor")).isTrue();
        assertThat(columnExists("outbox_messages", "cursor")).isFalse();
        assertThat(appliedVersions()).containsExactly(1, 2, 3, 4);

        // 建表后写入与分页查询不再依赖保留字引用：裸列名直接可用
        try (Connection conn = dataSource.getConnection(); Statement st = conn.createStatement()) {
            st.execute("INSERT INTO project_events (project_id, event_cursor, event_id, event_type,"
                    + " aggregate_type, aggregate_id, occurred_at) VALUES"
                    + " (1, 2, 'evt_fresh_2', 'project.renamed', 'project', '1', NOW()),"
                    + " (1, 1, 'evt_fresh_1', 'project.created', 'project', '1', NOW())");
            st.execute("INSERT INTO outbox_messages (message_id, project_id, event_cursor,"
                    + " aggregate_type, aggregate_id, event_type) VALUES"
                    + " ('evt_fresh_1', 1, 1, 'project', '1', 'project.created')");
            try (ResultSet rs = st.executeQuery(
                    "SELECT event_cursor FROM project_events WHERE project_id = 1"
                            + " ORDER BY event_cursor LIMIT 10")) {
                List<Long> cursors = new ArrayList<>();
                while (rs.next()) {
                    cursors.add(rs.getLong(1));
                }
                assertThat(cursors).containsExactly(1L, 2L);
            }
        }
    }

    @Test
    void knownOldSchemaUpgradePreservesCursorValuesAndOrder() throws Exception {
        // 模拟迁移器引入前的已知旧库：直接执行 V1 基线 DDL（含带反引号的 `cursor` 列），不记账
        executeMigrationFile("classpath:db/migrations/V1__baseline.sql");
        insertLegacyRows();

        List<Integer> applied = new SchemaMigrationService(dataSource).migrate();

        // 旧库：补记 V1（不重跑 DDL），随后应用 V2、V3、V4
        assertThat(applied).containsExactly(1, 2, 3, 4);
        assertThat(columnExists("project_events", "event_cursor")).isTrue();
        assertThat(columnExists("project_events", "cursor")).isFalse();
        assertThat(columnExists("outbox_messages", "event_cursor")).isTrue();
        assertThat(columnExists("outbox_messages", "cursor")).isFalse();

        // 事件游标值、事件身份、payload 与 (project_id, cursor) 顺序完整保留
        try (Connection conn = dataSource.getConnection(); Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT event_id, event_cursor, aggregate_version, correlation_id,"
                             + " JSON_UNQUOTE(JSON_EXTRACT(payload, '$.seq'))"
                             + " FROM project_events WHERE project_id = 42"
                             + " ORDER BY project_id, event_cursor")) {
            List<String> rows = new ArrayList<>();
            while (rs.next()) {
                rows.add(rs.getString(1) + "|" + rs.getLong(2) + "|" + rs.getInt(3)
                        + "|" + rs.getString(4) + "|" + rs.getString(5));
            }
            assertThat(rows).containsExactly(
                    "evt_old_1|1|0|corr-1|1",
                    "evt_old_2|2|1|corr-1|2",
                    "evt_old_3|3|2|corr-2|3");
        }

        // Outbox 消息身份、游标、状态与重试元数据完整保留，顺序不变
        try (Connection conn = dataSource.getConnection(); Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT message_id, event_cursor, status, attempt_count, next_attempt_at"
                             + " FROM outbox_messages WHERE project_id = 42"
                             + " ORDER BY project_id, event_cursor")) {
            List<String> rows = new ArrayList<>();
            while (rs.next()) {
                rows.add(rs.getString(1) + "|" + rs.getLong(2) + "|" + rs.getString(3)
                        + "|" + rs.getInt(4) + "|" + rs.getString(5));
            }
            assertThat(rows).containsExactly(
                    "evt_old_1|1|pending|2|2030-01-02 03:04:05",
                    "evt_old_2|2|published|0|null",
                    "evt_old_3|3|pending|1|2030-02-03 04:05:06");
        }
    }

    // ===== 工具方法 =====

    private void dropAllTables() {
        try (Connection conn = dataSource.getConnection(); Statement st = conn.createStatement()) {
            st.execute("SET FOREIGN_KEY_CHECKS=0");
            List<String> tables = new ArrayList<>();
            try (ResultSet rs = st.executeQuery(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()")) {
                while (rs.next()) {
                    tables.add(rs.getString(1));
                }
            }
            for (String table : tables) {
                st.execute("DROP TABLE IF EXISTS `" + table + "`");
            }
            st.execute("SET FOREIGN_KEY_CHECKS=1");
        } catch (Exception e) {
            throw new IllegalStateException("清空迁移测试库失败", e);
        }
    }

    private boolean columnExists(String table, String column) throws Exception {
        try (Connection conn = dataSource.getConnection();
             var ps = conn.prepareStatement(
                     "SELECT COUNT(*) FROM information_schema.columns"
                             + " WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?")) {
            ps.setString(1, table);
            ps.setString(2, column);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && rs.getInt(1) > 0;
            }
        }
    }

    private List<Integer> appliedVersions() throws Exception {
        try (Connection conn = dataSource.getConnection(); Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT version FROM schema_migrations WHERE status = 1 ORDER BY version")) {
            List<Integer> versions = new ArrayList<>();
            while (rs.next()) {
                versions.add(rs.getInt(1));
            }
            return versions;
        }
    }

    /** 直接执行迁移文件 SQL（不经迁移器，不记账），用于构造已知旧库 */
    private void executeMigrationFile(String location) throws Exception {
        String content;
        try (InputStream in = new PathMatchingResourcePatternResolver()
                .getResource(location).getInputStream()) {
            content = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        try (Connection conn = dataSource.getConnection()) {
            for (String stmt : SchemaMigrationService.splitStatements(content)) {
                if (stmt.isBlank()) {
                    continue;
                }
                try (Statement st = conn.createStatement()) {
                    st.execute(stmt);
                }
            }
        }
    }

    /** 旧库既有数据：3 条事件 + 3 条 Outbox，覆盖不同状态与重试元数据 */
    private void insertLegacyRows() throws Exception {
        try (Connection conn = dataSource.getConnection(); Statement st = conn.createStatement()) {
            st.execute("INSERT INTO project (id, owner_id, name) VALUES (42, 7, '旧库事件项目')");
            st.execute("INSERT INTO project_event_stream (project_id, high_watermark) VALUES (42, 3)");
            st.execute("INSERT INTO project_events"
                    + " (project_id, `cursor`, event_id, event_type, aggregate_type, aggregate_id,"
                    + " aggregate_version, correlation_id, causation_id, occurred_at, payload) VALUES"
                    + " (42, 1, 'evt_old_1', 'project.created', 'project', '42', 0, 'corr-1', NULL,"
                    + "  '2026-07-01 10:00:00', JSON_OBJECT('seq', 1)),"
                    + " (42, 2, 'evt_old_2', 'project.renamed', 'project', '42', 1, 'corr-1', 'evt_old_1',"
                    + "  '2026-07-01 10:01:00', JSON_OBJECT('seq', 2)),"
                    + " (42, 3, 'evt_old_3', 'job.created', 'generation_job', '99', 2, 'corr-2', 'evt_old_2',"
                    + "  '2026-07-01 10:02:00', JSON_OBJECT('seq', 3))");
            st.execute("INSERT INTO outbox_messages"
                    + " (message_id, project_id, `cursor`, aggregate_type, aggregate_id, event_type,"
                    + " payload, status, next_attempt_at, attempt_count) VALUES"
                    + " ('evt_old_1', 42, 1, 'project', '42', 'project.created',"
                    + "  JSON_OBJECT('seq', 1), 'pending', '2030-01-02 03:04:05', 2),"
                    + " ('evt_old_2', 42, 2, 'project', '42', 'project.renamed',"
                    + "  JSON_OBJECT('seq', 2), 'published', NULL, 0),"
                    + " ('evt_old_3', 42, 3, 'generation_job', '99', 'job.created',"
                    + "  JSON_OBJECT('seq', 3), 'pending', '2030-02-03 04:05:06', 1)");
        }
    }
}
