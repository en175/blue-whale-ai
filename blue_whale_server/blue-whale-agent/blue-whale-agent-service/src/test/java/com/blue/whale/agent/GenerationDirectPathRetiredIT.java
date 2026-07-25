package com.blue.whale.agent;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.Project;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 旧图片直连通道退役契约（IK21O9）：POST /api/generation/image 不再存在（404），
 * 模型能力查询与 JobController（列表/单查）保持可用。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.agent-orchestrator.engine=fake",
        "blue-whale.agent-orchestrator.engine-version=1",
        "blue-whale.agent-orchestrator.adapter-schema-version=1"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GenerationDirectPathRetiredIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void cleanFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM audit_records",
                "DELETE FROM cost_reservations",
                "DELETE FROM cost_budget_locks",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM generation_jobs",
                "DELETE FROM assets",
                "DELETE FROM project");
    }

    @Test
    void legacyImageEndpointReturns404() throws Exception {
        // 直连通道已退役：Spring 无 handler，无论是否带身份/合法 body 一律 404
        mockMvc.perform(post("/api/generation/image")
                        .header("X-User-Id", "10")
                        .contentType("application/json")
                        .content("{\"project_id\":1,\"model_id\":\"doubao-seedream-5.0-lite\","
                                + "\"prompt\":\"蓝鲸\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void modelCapabilityQueryStaysAvailableWithSeededModel() throws Exception {
        // 能力查询保留：H2 种子模型 doubao-seedream-5.0-lite 可被发现
        mockMvc.perform(get("/api/generation/models").param("capability", "image"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[0].model_id").value("doubao-seedream-5.0-lite"))
                .andExpect(jsonPath("$.data[0].provider_id").value("volcengine"));
    }

    @Test
    void jobListAndStatusStayAvailable() throws Exception {
        // JobController 保留：造一条 generation_jobs 行，列表与单查均 200
        Project project = new Project().setOwnerId(10L).setName("retired-direct-path");
        projectMapper.insert(project);
        jdbcTemplate.update("INSERT INTO generation_jobs (project_id, user_id, type, source, status) "
                + "VALUES (?, 10, 'image', 'agent_run', 'queued')", project.getId());
        Long jobId = jdbcTemplate.queryForObject(
                "SELECT id FROM generation_jobs WHERE project_id = ?", Long.class, project.getId());

        mockMvc.perform(get("/api/jobs").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.records[0].job_id").value(jobId))
                .andExpect(jsonPath("$.data.records[0].status").value("queued"));

        mockMvc.perform(get("/api/jobs/{id}", jobId).header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.job_id").value(jobId))
                .andExpect(jsonPath("$.data.status").value("queued"));

        // 越权与不存在维持既有 404 语义
        mockMvc.perform(get("/api/jobs/{id}", jobId).header("X-User-Id", "11"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/jobs/{id}", jobId + 1000).header("X-User-Id", "10"))
                .andExpect(status().isNotFound());
    }
}
