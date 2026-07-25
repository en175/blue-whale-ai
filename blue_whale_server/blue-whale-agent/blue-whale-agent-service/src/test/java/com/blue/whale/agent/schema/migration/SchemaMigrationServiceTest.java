package com.blue.whale.agent.schema.migration;

import org.h2.jdbcx.JdbcConnectionPool;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link SchemaMigrationService} 单元测试（IK1W1E）。
 *
 * <p>用 H2 内存库（MODE=MySQL）+ 测试专用迁移目录 {@code db/migrations-test/}，
 * 覆盖四个核心场景：空库初始化、旧库补记 V1、重复启动幂等、失败 fail-closed。
 * 不依赖 Spring 上下文，直接构造服务实例。
 */
class SchemaMigrationServiceTest {

    private static final String TEST_MIGRATION_LOCATION = "classpath:db/migrations-test/V*__*.sql";

    private JdbcConnectionPool db;

    @BeforeEach
    void setUp() {
        // MODE=MySQL 让 H2 兼容 INSERT IGNORE / AUTO_INCREMENT 等 MySQL 方言
        String url = "jdbc:h2:mem:migration_test_" + System.nanoTime()
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE";
        db = JdbcConnectionPool.create(url, "sa", "");
    }

    @AfterEach
    void tearDown() {
        if (db != null) {
            db.dispose();
        }
    }

    @Test
    void emptyDatabaseAppliesAllVersionsInOrder() {
        SchemaMigrationService service = new SchemaMigrationService(db, TEST_MIGRATION_LOCATION);

        List<Integer> applied = service.migrate();

        // V1（baseline）+ V2（seed）都应被应用
        assertThat(applied).containsExactly(1, 2);
        assertThat(appliedVersions(db)).containsExactly(1, 2);
        assertThat(tableExists(db, "project")).isTrue();
        assertThat(tableExists(db, "canvas")).isTrue();
        // V2 seed 数据
        assertThat(rowCount(db, "project")).isEqualTo(1);
    }

    @Test
    void oldDatabaseWithBaselineTableBackfillsV1WithoutRerunning() {
        // 模拟旧库：手动建出 project 表（旧字段），记账本为空
        try (Connection conn = db.getConnection();
             Statement st = conn.createStatement()) {
            st.execute("CREATE TABLE project (id BIGINT PRIMARY KEY, owner_id BIGINT, name VARCHAR(128))");
            st.execute("INSERT INTO project VALUES (42, 99, 'pre-existing-legacy')");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }

        SchemaMigrationService service = new SchemaMigrationService(db, TEST_MIGRATION_LOCATION);
        List<Integer> applied = service.migrate();

        // V1 被补记（不重跑 DDL，project 表的旧数据保留），V2 正常应用
        assertThat(applied).containsExactly(1, 2);
        assertThat(appliedVersions(db)).containsExactly(1, 2);
        // 旧库的预置数据（id=42）保留；V2 的 seed（id=1）追加
        assertThat(rowCount(db, "project")).isEqualTo(2);
        assertThat(idExists(db, "project", 42)).isTrue();
        assertThat(idExists(db, "project", 1)).isTrue();
    }

    @Test
    void repeatedRunIsIdempotent() {
        SchemaMigrationService service = new SchemaMigrationService(db, TEST_MIGRATION_LOCATION);

        service.migrate();
        // 第二次启动：所有版本已应用，应全部跳过
        List<Integer> secondRun = service.migrate();

        assertThat(secondRun).isEmpty();
        assertThat(appliedVersions(db)).containsExactly(1, 2);
        // seed 数据不重复插入（INSERT IGNORE）
        assertThat(rowCount(db, "project")).isEqualTo(1);
    }

    @Test
    void checksumMismatchOnAppliedVersionFailsClosed() {
        // IK1W1E Acceptance #3：已应用版本的 checksum 与当前文件不一致 → fail-closed
        SchemaMigrationService service = new SchemaMigrationService(db, TEST_MIGRATION_LOCATION);
        service.migrate();

        // 篡改记账本里 V1 的 checksum（模拟迁移文件被改动或记账本与代码不匹配）
        try (Connection conn = db.getConnection();
             Statement st = conn.createStatement()) {
            st.execute("UPDATE schema_migrations SET checksum='tampered-checksum' WHERE version=1");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }

        assertThatThrownBy(service::migrate)
                .isInstanceOf(SchemaMigrationService.MigrationException.class)
                .hasMessageContaining("校验不一致");

        // 记账本未被破坏（篡改只影响跳过判定，不修改记录）
        assertThat(appliedVersions(db)).containsExactly(1, 2);
    }

    @Test
    void failedMigrationRecordsFailedStatusAndThrows() {
        // 用一个故意会失败的迁移文件目录（V3 引用不存在的列）
        SchemaMigrationService service = new SchemaMigrationService(
                db, "classpath:db/migrations-fail/V*__*.sql");

        assertThatThrownBy(service::migrate)
                .isInstanceOf(SchemaMigrationService.MigrationException.class)
                .hasMessageContaining("执行失败");

        // 失败的版本被记 status=0（failed）
        assertThat(failedVersions(db)).contains(3);
        // 成功应用的 V1 仍在
        assertThat(appliedVersions(db)).contains(1);
    }

    @Test
    void noMigrationFilesFails() {
        SchemaMigrationService service = new SchemaMigrationService(
                db, "classpath:db/migrations-empty/V*__*.sql");

        assertThatThrownBy(service::migrate)
                .isInstanceOf(SchemaMigrationService.MigrationException.class)
                .hasMessageContaining("未发现任何迁移文件");
    }

    @Test
    void duplicateVersionNumberFails() {
        SchemaMigrationService service = new SchemaMigrationService(
                db, "classpath:db/migrations-duplicate/V*__*.sql");

        assertThatThrownBy(service::migrate)
                .isInstanceOf(SchemaMigrationService.MigrationException.class)
                .hasMessageContaining("重复的迁移版本号");
    }

    // ===== 工具方法 =====

    private static List<Integer> appliedVersions(DataSource ds) {
        return queryVersions(ds, 1);
    }

    private static List<Integer> failedVersions(DataSource ds) {
        return queryVersions(ds, 0);
    }

    private static List<Integer> queryVersions(DataSource ds, int status) {
        try (Connection conn = ds.getConnection();
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT version FROM schema_migrations WHERE status=" + status
                             + " ORDER BY version")) {
            java.util.List<Integer> out = new java.util.ArrayList<>();
            while (rs.next()) {
                out.add(rs.getInt(1));
            }
            return out;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static boolean tableExists(DataSource ds, String name) {
        try (Connection conn = ds.getConnection()) {
            try (ResultSet rs = conn.getMetaData().getTables(
                    conn.getCatalog(), null, name, new String[]{"TABLE"})) {
                return rs.next();
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static int rowCount(DataSource ds, String table) {
        try (Connection conn = ds.getConnection();
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM " + table)) {
            return rs.next() ? rs.getInt(1) : 0;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static boolean idExists(DataSource ds, String table, long id) {
        try (Connection conn = ds.getConnection();
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT 1 FROM " + table + " WHERE id=" + id)) {
            return rs.next();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
