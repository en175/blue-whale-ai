package com.blue.whale.agent;

import com.blue.whale.agent.service.governance.CostControlProperties;
import com.blue.whale.agent.service.generation.GenerationWorker;
import com.blue.whale.agent.support.ExpectedMigrationVersions;
import com.blue.whale.agent.support.FakeGenerationConfiguration;
import com.blue.whale.agent.support.FakeGenerationStorage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 旧库升级后公开生成链路的真实 MySQL 验收（IK1W1L）。
 *
 * <p>仅在显式提供专用测试库连接时运行（与 SnapshotMySqlConsistencyIT 同约定）。
 *
 * <p>上下文启动前（{@link DynamicPropertySource}）用 JDBC 造出受支持旧库：
 * 先落地 V1 全量基线，再把 GenerationJob/Asset 域回退到 pre-ik10i6 历史形态
 * （jobs/assets 缺后加列、其余域表缺失），并预置既有 Project/Canvas/Job/Asset 关联数据。
 * 上下文启动时 {@code blue-whale.schema-migration.enabled=true} 触发迁移器补记 V1、
 * 跑 V2、V3 与 V4 收敛升级；随后测试用公开 HTTP 链路验证创建、Worker 接纳、单资源查询
 * 与 Snapshot 恢复在升级后的库上全部可用，且既有事实保留。
 */
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_URL", matches = "jdbc:mysql://.+")
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_USERNAME", matches = ".+")
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_PASSWORD", matches = ".*")
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "spring.sql.init.mode=never",
        "blue-whale.schema-migration.enabled=true",
        "volcengine.ark.base-url=https://ark.test.invalid"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(FakeGenerationConfiguration.class)
class GenerationOnUpgradedSchemaMySqlIT {

    private static final String MYSQL_DRIVER = "com.mysql.cj.jdbc.Driver";

    /** V1 基线的全部业务表（造旧库前清场用） */
    private static final List<String> V1_TABLES = List.of(
            "template_card", "template_card_image", "skill", "user_skill",
            "project", "canvas", "project_event_stream", "project_events", "outbox_messages",
            "conversations", "agent_runs", "runtime_checkpoints", "run_commits",
            "user_input_requests", "conversation_messages", "command_idempotency",
            "generation_job_outputs", "asset_storage_objects", "asset_object_transfers",
            "generation_result_conflicts", "generation_provider_tasks",
            "seedance_callback_inbox", "seedance_callback_security_audits",
            "cost_budget_locks", "cost_reservations", "audit_records",
            "generation_jobs", "assets", "content_reviews");

    /** 回退到历史形态的域表：V4 应重建缺失表、为 jobs/assets 补列 */
    private static final List<String> LEGACY_DROPPED_TABLES = List.of(
            "generation_job_outputs", "generation_provider_tasks",
            "asset_storage_objects", "asset_object_transfers",
            "generation_result_conflicts", "seedance_callback_inbox",
            "seedance_callback_security_audits", "cost_budget_locks",
            "cost_reservations", "audit_records", "content_reviews");

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private GenerationWorker generationWorker;
    @Autowired
    private FakeGenerationStorage storage;
    @Autowired
    private CostControlProperties costControlProperties;

    @DynamicPropertySource
    static void mysqlPropertiesAndLegacyFixture(DynamicPropertyRegistry registry) throws Exception {
        String url = System.getenv("BLUE_WHALE_TEST_MYSQL_URL");
        String username = System.getenv("BLUE_WHALE_TEST_MYSQL_USERNAME");
        String password = System.getenv("BLUE_WHALE_TEST_MYSQL_PASSWORD");
        registry.add("spring.datasource.dynamic.datasource.master.url", () -> url);
        registry.add("spring.datasource.dynamic.datasource.master.username", () -> username);
        registry.add("spring.datasource.dynamic.datasource.master.password", () -> password);
        registry.add("spring.datasource.dynamic.datasource.master.driver-class-name", () -> MYSQL_DRIVER);
        registry.add("spring.datasource.driver-class-name", () -> MYSQL_DRIVER);

        createLegacyDatabase(url, username, password);
    }

    /**
     * 造受支持旧库：V1 全量基线 → generation 域回退 pre-ik10i6 形态 → 预置关联数据。
     * 在上下文启动前执行，随后迁移器在启动时完成 V1 补记与 V2/V3/V4/V5 升级。
     */
    private static void createLegacyDatabase(String url, String username, String password) throws Exception {
        Class.forName(MYSQL_DRIVER);
        try (Connection conn = DriverManager.getConnection(url, username, password);
             Statement st = conn.createStatement()) {
            st.execute("DROP TABLE IF EXISTS schema_migrations");
            for (String table : V1_TABLES) {
                st.execute("DROP TABLE IF EXISTS " + table);
            }
            String v1;
            try (InputStream in = new ClassPathResource("db/migrations/V1__baseline.sql").getInputStream()) {
                v1 = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
            for (String stmt : splitStatements(v1)) {
                if (!stmt.isBlank()) {
                    st.execute(stmt);
                }
            }
            // generation 域回退：缺失表由 V4 重建；jobs/assets 建成初始形态由 V4 补列
            for (String table : LEGACY_DROPPED_TABLES) {
                st.execute("DROP TABLE IF EXISTS " + table);
            }
            st.execute("DROP TABLE IF EXISTS generation_jobs");
            st.execute("DROP TABLE IF EXISTS assets");
            for (String stmt : splitStatements(LEGACY_GENERATION_DDL)) {
                if (!stmt.isBlank()) {
                    st.execute(stmt);
                }
            }
        }
    }

    /** pre-ik10i6 历史形态：generation_jobs/assets 初始结构 + 既有 Project/Canvas/Job/Asset 关联数据 */
    private static final String LEGACY_GENERATION_DDL = """
            CREATE TABLE generation_jobs
            (
                id               BIGINT PRIMARY KEY AUTO_INCREMENT,
                project_id       BIGINT NULL,
                user_id          BIGINT NOT NULL,
                agent_run_id     BIGINT NULL,
                action_identity  VARCHAR(128) NULL,
                type             VARCHAR(32) NOT NULL,
                source           VARCHAR(32) NOT NULL,
                input            JSON NULL,
                status           VARCHAR(32) NOT NULL,
                progress         INT NULL,
                output_asset_ids JSON NULL,
                provider         VARCHAR(64) NULL,
                provider_task_id VARCHAR(128) NULL,
                poll_count       INT NULL,
                next_poll_at     DATETIME NULL,
                retry_count      INT NULL,
                last_polled_at   DATETIME NULL,
                error            TEXT NULL,
                stage_id         VARCHAR(64) NULL,
                gmt_create       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                gmt_modified     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                version          INT      NOT NULL DEFAULT 0,
                is_delete        TINYINT  NOT NULL DEFAULT 0,
                UNIQUE KEY uk_agent_run_action (agent_run_id, action_identity)
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
            CREATE TABLE assets
            (
                id                BIGINT PRIMARY KEY AUTO_INCREMENT,
                user_id           BIGINT NOT NULL,
                type              VARCHAR(16) NOT NULL,
                storage_key       VARCHAR(512) NULL,
                url               VARCHAR(1024) NULL,
                mime              VARCHAR(128) NULL,
                size              BIGINT NULL,
                width             INT NULL,
                height            INT NULL,
                duration          INT NULL,
                source            VARCHAR(32) NOT NULL,
                status            VARCHAR(32) NOT NULL,
                gmt_create        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                gmt_modified      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                version           INT NOT NULL DEFAULT 0,
                is_delete         TINYINT NOT NULL DEFAULT 0
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
            INSERT INTO project (id, owner_id, name) VALUES (9001, 1001, 'legacy-svc-A');
            INSERT INTO canvas (id, project_id, nodes_json) VALUES
                (8001, 9001, '[{"id":"n1","type":"image","data":{"assetId":7001}}]');
            INSERT INTO generation_jobs
                (id, project_id, user_id, type, source, status, progress, output_asset_ids, version)
                VALUES (6001, 9001, 1001, 'image', 'bottom_dock', 'succeeded', 100, '[7001]', 3);
            INSERT INTO assets (id, user_id, type, storage_key, url, source, status, version)
                VALUES (7001, 1001, 'image', 'legacy/svc-7001.png', 'https://example.com/7001.png',
                        'generated', 'normal', 2);
            """;

    /**
     * 与迁移器一致的按分号拆分（夹具 SQL 无存储过程，简单拆分足够）。
     * 与 SchemaMigrationService.splitStatements 同逻辑；该方法是 package-private，
     * 本类在 com.blue.whale.agent 包（与其他全栈 IT 同层），为 20 行测试辅助
     * 放宽生产可见性不值得，故保留私有副本。
     */
    private static List<String> splitStatements(String sql) {
        List<String> stmts = new java.util.ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inSingleQuote = false;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            cur.append(c);
            if (c == '\'') {
                inSingleQuote = !inSingleQuote;
            } else if (c == ';' && !inSingleQuote) {
                stmts.add(cur.toString());
                cur.setLength(0);
            }
        }
        if (!cur.isEmpty()) {
            stmts.add(cur.toString());
        }
        return stmts;
    }

    @BeforeEach
    void setUp() {
        costControlProperties.setImageReservationFen(25L);
        storage.clear();
    }

    @Test
    void publicGenerationChainWorksOnUpgradedLegacyDatabase() throws Exception {
        // 迁移器已在启动时完成升级：记账本记录全部已应用版本（V1 补记，其余正常应用）
        assertThat(jdbcTemplate.queryForObject(
                "SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations", String.class))
                .isEqualTo(ExpectedMigrationVersions.APPLIED_CSV);

        // 公开生成命令：创建 GenerationJob（升级后的库上接纳事务全链路写入）
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";
        MvcResult accepted = mockMvc.perform(post("/api/projects/{id}/generation-jobs", 9001L)
                        .header("X-User-Id", "1001")
                        .header("Idempotency-Key", "legacy-upgraded-create")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isAccepted())
                .andReturn();
        long jobId = objectMapper.readTree(accepted.getResponse().getContentAsString())
                .path("data").path("generation_job_id").asLong();

        // Generation Worker 接纳成功结果：创建 Asset、绑定输出槽位并更新 Job
        assertThat(generationWorker.runOnce("legacy-upgraded-worker")).isTrue();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("succeeded");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM assets WHERE generation_job_id = ?", Long.class, jobId))
                .isEqualTo(1L);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_job_outputs WHERE generation_job_id = ? AND asset_id IS NOT NULL",
                Long.class, jobId)).isEqualTo(1L);
        // 成本预留与审计辅助结构在升级后的库上可用
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM cost_reservations WHERE generation_job_id = ?", Long.class, jobId))
                .isEqualTo(1L);

        // 单资源查询链路
        mockMvc.perform(get("/api/jobs/{id}", jobId).header("X-User-Id", "1001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.job_id").value(jobId))
                .andExpect(jsonPath("$.data.status").value("succeeded"));

        // Snapshot 恢复链路：新 Job 与既有 Job 同时可恢复
        mockMvc.perform(get("/api/projects/{id}/snapshot", 9001L)
                        .header("X-User-Id", "1001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_jobs[0].job_id").value(jobId))
                .andExpect(jsonPath("$.data.generation_jobs[0].status").value("succeeded"))
                .andExpect(jsonPath("$.data.generation_jobs[0].outputs[0].asset_id").isNumber());
    }

    @Test
    void preExistingJobAssetAndCanvasLinksSurviveUpgrade() throws Exception {
        // 既有 GenerationJob：主键、聚合版本、状态、归属不变，单资源查询可用
        mockMvc.perform(get("/api/jobs/{id}", 6001L).header("X-User-Id", "1001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.job_id").value(6001))
                .andExpect(jsonPath("$.data.status").value("succeeded"));
        assertThat(jdbcTemplate.queryForObject(
                "SELECT version FROM generation_jobs WHERE id = 6001", Long.class))
                .isEqualTo(3L);

        // 既有 Asset：内容身份与归属不变
        assertThat(jdbcTemplate.queryForObject(
                "SELECT storage_key FROM assets WHERE id = 7001", String.class))
                .isEqualTo("legacy/svc-7001.png");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT version FROM assets WHERE id = 7001", Long.class))
                .isEqualTo(2L);

        // 既有 Canvas→Asset 引用保持，Snapshot 恢复可观察到既有 Job
        assertThat(jdbcTemplate.queryForObject(
                "SELECT nodes_json FROM canvas WHERE id = 8001", String.class))
                .contains("7001");
        MvcResult snapshot = mockMvc.perform(get("/api/projects/{id}/snapshot", 9001L)
                        .header("X-User-Id", "1001"))
                .andExpect(status().isOk())
                .andReturn();
        com.fasterxml.jackson.databind.JsonNode jobs = objectMapper
                .readTree(snapshot.getResponse().getContentAsString())
                .path("data").path("generation_jobs");
        com.fasterxml.jackson.databind.JsonNode legacyJob = null;
        for (com.fasterxml.jackson.databind.JsonNode job : jobs) {
            if (job.path("job_id").asLong() == 6001L) {
                legacyJob = job;
            }
        }
        assertThat(legacyJob).as("Snapshot 应能恢复既有 Job 6001").isNotNull();
        // pre-ik10i6 形态下 assets 无 generation_job_id 归属，回填的输出槽
        // 与 ik10id 历史行为一致：状态按 Job 终态置 succeeded，asset_id 保持未绑定
        assertThat(legacyJob.path("outputs").get(0).path("status").asText()).isEqualTo("succeeded");
        assertThat(legacyJob.path("outputs").get(0).path("asset_id").isNull()).isTrue();
    }
}
