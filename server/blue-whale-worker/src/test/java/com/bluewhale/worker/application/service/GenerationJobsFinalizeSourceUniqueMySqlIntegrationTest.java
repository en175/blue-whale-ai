package com.bluewhale.worker.application.service;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * IKIZQC（金标 G05/G08）：generation_jobs 成片来源唯一约束的真库并发验证。
 *
 * <p>「同一来源样片的双击/两页并发至多一条成片任务与一笔预扣」由
 * {@code uk_generation_jobs__source_sample_job_id} 在数据库层原子裁决：本测试对
 * bluewhale-schema.sql 的真 MySQL 容器并发 INSERT 断言——
 * <ol>
 *   <li>同 source 并发插入：恰一条成功，其余以重复键失败（预扣在真实链路里发生在
 *       插入之后，输家根本走不到 Hold —— 一笔回扣由此保证）；</li>
 *   <li>多条 source 为 NULL 的行（普通视频/样片）互不冲突（MySQL 唯一索引不去重 NULL）；</li>
 *   <li>失败的成片行**保留占位**（G08）：其后的再次插入仍被拒。</li>
 * </ol>
 */
@Testcontainers(disabledWithoutDocker = true)
@DisplayName("成片来源唯一约束真库并发（IKIZQC G05/G08）")
class GenerationJobsFinalizeSourceUniqueMySqlIntegrationTest {

    @Container
    static final MySQLContainer<?> mysql = new MySQLContainer<>(DockerImageName.parse("mysql:8.0"))
            .withDatabaseName("bluewhale_test")
            .withUsername("test")
            .withPassword("test")
            .withCommand("--default-time-zone=+00:00")
            .withCopyFileToContainer(
                    MountableFile.forClasspathResource("db/bluewhale-schema.sql"),
                    "/docker-entrypoint-initdb.d/init.sql")
            .withStartupTimeout(Duration.ofMinutes(5))
            .withReuse(true);

    // IKJCOE：video_stage / charge_state 已搬进 generation_job_extras，expected_output_count 列已删；
    // 本用例唯一裁决点是 uk_generation_jobs__source_sample_job_id，扩展位不参与该约束。
    static final String INSERT_FINAL =
            "INSERT INTO generation_jobs (project_id, user_id, type, source, status, input, "
                    + "source_sample_job_id) "
                    + "VALUES (1, 42, 'video', 'bottom_dock', 'queued', '{}', ?)";

    static String url() {
        return mysql.getJdbcUrl();
    }

    @BeforeAll
    static void seedSampleRow() throws Exception {
        // 来源样片任务行（成功终态、source 为 NULL 不受唯一索引影响）。
        try (Connection conn = DriverManager.getConnection(url(), "test", "test");
             Statement st = conn.createStatement()) {
            st.executeUpdate(
                    "INSERT INTO generation_jobs (id, project_id, user_id, type, source, status, input, "
                            + "output_asset_ids) "
                            + "VALUES (302, 1, 42, 'video', 'bottom_dock', 'succeeded', '{}', '[901]')");
            st.executeUpdate(
                    "INSERT INTO generation_job_extras "
                            + "(generation_job_id, extra_key, value_type, value_text) "
                            + "VALUES (302, 'video_stage', 'string', 'sample'), "
                            + "(302, 'charge_state', 'string', 'settled')");
        }
    }

    @AfterAll
    static void cleanup() throws Exception {
        try (Connection conn = DriverManager.getConnection(url(), "test", "test");
             Statement st = conn.createStatement()) {
            st.executeUpdate("DELETE FROM generation_job_extras");
            st.executeUpdate("DELETE FROM generation_jobs");
        }
    }

    @Test
    @DisplayName("G05: 两页并发插入同一 source → 恰一条成片任务落库（一笔预扣的 DB 面）")
    void concurrentInsertsOfSameSourceLeaveExactlyOneFinalRow() throws Exception {
        int contenders = 6;
        ExecutorService pool = Executors.newFixedThreadPool(contenders);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Boolean>> results = new CopyOnWriteArrayList<>();
        for (int i = 0; i < contenders; i++) {
            results.add(pool.submit(() -> {
                try (Connection conn = DriverManager.getConnection(url(), "test", "test");
                     PreparedStatement ps = conn.prepareStatement(INSERT_FINAL)) {
                    ps.setLong(1, 302L);
                    start.await();
                    return ps.executeUpdate() == 1;
                } catch (SQLException e) {
                    // 重复键 = 并发输家（预期路径）；其它 SQL 错误原样抛，让测试红。
                    if (e.getMessage() != null && e.getMessage().contains("Duplicate entry")) {
                        return false;
                    }
                    throw new IllegalStateException(e);
                }
            }));
        }
        start.countDown();
        int winners = 0;
        for (Future<Boolean> result : results) {
            winners += result.get(30, TimeUnit.SECONDS) ? 1 : 0;
        }
        pool.shutdownNow();

        assertThat(winners).as("并发赢家数（=真实链路的成片任务数与预扣笔数）").isEqualTo(1);

        try (Connection conn = DriverManager.getConnection(url(), "test", "test");
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT COUNT(*) FROM generation_jobs WHERE source_sample_job_id = 302")) {
            ResultSet rs = ps.executeQuery();
            rs.next();
            assertThat(rs.getInt(1)).as("source=302 的成片任务行数").isEqualTo(1);
        }
    }

    @Test
    @DisplayName("G08: 失败成片行保留占位——其后的再次提交仍被唯一索引拒绝")
    void failedFinalRowKeepsSourceSlotOccupied() throws Exception {
        // 先落一条失败占位行（真实链路 = 已发往上游后失败，charge_state=released 在扩展位）。
        try (Connection conn = DriverManager.getConnection(url(), "test", "test");
             PreparedStatement ps = conn.prepareStatement(
                     "INSERT INTO generation_jobs (project_id, user_id, type, source, status, input, "
                             + "source_sample_job_id, error) "
                             + "VALUES (1, 42, 'video', 'bottom_dock', 'failed', '{}', 303, '{}')")) {
            ps.executeUpdate();
        }
        try (Connection conn = DriverManager.getConnection(url(), "test", "test");
             Statement st = conn.createStatement()) {
            st.executeUpdate(
                    "INSERT INTO generation_job_extras "
                            + "(generation_job_id, extra_key, value_type, value_text) "
                            + "VALUES (303, 'video_stage', 'string', 'final'), "
                            + "(303, 'charge_state', 'string', 'released')");
        }
        // 再次提交（新 Idempotency-Key 的另一条成片任务）→ 重复键被拒：首版不复用同 Draft ID 重试。
        try (Connection conn = DriverManager.getConnection(url(), "test", "test");
             PreparedStatement ps = conn.prepareStatement(INSERT_FINAL)) {
            ps.setLong(1, 303L);
            ps.executeUpdate();
            org.assertj.core.api.Assertions.failBecauseExceptionWasNotThrown(SQLException.class);
        } catch (SQLException e) {
            assertThat(e.getMessage()).contains("Duplicate entry");
        }
    }

    @Test
    @DisplayName("G12 回归: source 为 NULL 的普通/样片行不受唯一索引影响（可多条并存）")
    void nullSourceRowsCoexist() throws Exception {
        for (int i = 0; i < 3; i++) {
            try (Connection conn = DriverManager.getConnection(url(), "test", "test");
                 PreparedStatement ps = conn.prepareStatement(
                         "INSERT INTO generation_jobs (project_id, user_id, type, source, status, input) "
                                 + "VALUES (1, 42, 'video', 'bottom_dock', 'queued', '{}')")) {
                ps.executeUpdate();
                // IKJCOE：样片身份在扩展位（i=0 为普通视频：缺键即缺省，与旧 NULL 列同义）。
                if (i != 0) {
                    try (PreparedStatement extra = conn.prepareStatement(
                            "INSERT INTO generation_job_extras "
                                    + "(generation_job_id, extra_key, value_type, value_text) "
                                    + "VALUES (LAST_INSERT_ID(), 'video_stage', 'string', 'sample')")) {
                        extra.executeUpdate();
                    }
                }
            }
        }
    }
}
