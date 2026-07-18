package com.blue.whale.agent;

import com.blue.whale.agent.service.governance.CostControlProperties;
import com.blue.whale.agent.service.generation.GenerationWorker;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

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
 * 空库初始化后公开生成链路的真实 MySQL 验收（IK1W1L 验收标准第 1 条）。
 *
 * <p>仅在显式提供专用测试库连接时运行（与 SnapshotMySqlConsistencyIT 同约定）。
 *
 * <p>上下文启动前（{@link DynamicPropertySource}）清空测试库全部业务表；
 * 上下文启动时 {@code blue-whale.schema-migration.enabled=true} 触发迁移器在空库上
 * 完整执行 V1+V2+V3+V4+V5；随后验证公开生成命令创建并查询 GenerationJob、Worker 接纳成功
 * 结果创建关联 Asset，并能通过 Project 级 Snapshot 查询恢复。
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
class GenerationOnEmptySchemaMySqlIT {

    private static final String MYSQL_DRIVER = "com.mysql.cj.jdbc.Driver";

    /** V1 基线的全部业务表（清空库用） */
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
    static void mysqlPropertiesAndEmptyFixture(DynamicPropertyRegistry registry) throws Exception {
        String url = System.getenv("BLUE_WHALE_TEST_MYSQL_URL");
        String username = System.getenv("BLUE_WHALE_TEST_MYSQL_USERNAME");
        String password = System.getenv("BLUE_WHALE_TEST_MYSQL_PASSWORD");
        registry.add("spring.datasource.dynamic.datasource.master.url", () -> url);
        registry.add("spring.datasource.dynamic.datasource.master.username", () -> username);
        registry.add("spring.datasource.dynamic.datasource.master.password", () -> password);
        registry.add("spring.datasource.dynamic.datasource.master.driver-class-name", () -> MYSQL_DRIVER);
        registry.add("spring.datasource.driver-class-name", () -> MYSQL_DRIVER);

        Class.forName(MYSQL_DRIVER);
        try (Connection conn = DriverManager.getConnection(url, username, password);
             Statement st = conn.createStatement()) {
            st.execute("DROP TABLE IF EXISTS schema_migrations");
            for (String table : V1_TABLES) {
                st.execute("DROP TABLE IF EXISTS " + table);
            }
        }
    }

    @BeforeEach
    void setUp() {
        costControlProperties.setImageReservationFen(25L);
        storage.clear();
    }

    @Test
    void publicGenerationChainWorksOnFreshlyMigratedEmptyDatabase() throws Exception {
        // 空库迁移链完整执行：记账本记录 1,2,3,4
        assertThat(jdbcTemplate.queryForObject(
                "SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations", String.class))
                .isEqualTo("1,2,3,4,5");

        // 预置 Project（迁移链不管业务数据，测试直接写）
        jdbcTemplate.update("INSERT INTO project (id, owner_id, name) VALUES (9101, 1001, 'empty-db-gen')");

        // 公开生成命令：创建 GenerationJob
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";
        MvcResult accepted = mockMvc.perform(post("/api/projects/{id}/generation-jobs", 9101L)
                        .header("X-User-Id", "1001")
                        .header("Idempotency-Key", "empty-db-create")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isAccepted())
                .andReturn();
        long jobId = objectMapper.readTree(accepted.getResponse().getContentAsString())
                .path("data").path("generation_job_id").asLong();

        // Worker 接纳成功结果：创建 Asset、绑定输出槽位并更新 Job
        assertThat(generationWorker.runOnce("empty-db-worker")).isTrue();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("succeeded");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM assets WHERE generation_job_id = ?", Long.class, jobId))
                .isEqualTo(1L);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_job_outputs WHERE generation_job_id = ? AND asset_id IS NOT NULL",
                Long.class, jobId)).isEqualTo(1L);

        // 单资源查询链路
        mockMvc.perform(get("/api/jobs/{id}", jobId).header("X-User-Id", "1001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.job_id").value(jobId))
                .andExpect(jsonPath("$.data.status").value("succeeded"));

        // Snapshot 恢复链路
        mockMvc.perform(get("/api/projects/{id}/snapshot", 9101L)
                        .header("X-User-Id", "1001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_jobs[0].job_id").value(jobId))
                .andExpect(jsonPath("$.data.generation_jobs[0].status").value("succeeded"))
                .andExpect(jsonPath("$.data.generation_jobs[0].outputs[0].asset_id").isNumber());
    }
}
