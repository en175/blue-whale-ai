package com.blue.whale.agent;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.AgentRun;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 创作现场只读端点端到端 IT（IK2QC7）。
 *
 * 覆盖五个内部端点的鉴权与紧凑度（snake_case）、read_asset 的白名单放行（画布节点 assetId ∪
 * 本 Run 的 agent_run 来源生成任务输出）与范围限制（白名单外 / status 非 normal 拒绝）、
 * 生成任务状态读取、租约鉴权与跨 Project 拒绝。Project 范围由 run 绑定闭环。
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
class CreativeContextReadIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void cleanCreativeContextFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM generation_jobs",
                "DELETE FROM message_asset_reference",
                "DELETE FROM conversation_messages",
                "DELETE FROM agent_runs",
                "DELETE FROM assets",
                "DELETE FROM canvas",
                "DELETE FROM conversations",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void listCanvasNodesReturnsSnakeCaseSummaries() throws Exception {
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedCanvas(project.getId(),
                "[{\"id\":\"n1\",\"type\":\"asset\",\"data\":{\"assetId\":5}},"
                        + "{\"id\":\"n2\",\"type\":\"text\",\"data\":{}}]");
        mockMvc.perform(get("/internal/agent-runs/{runId}/canvas/nodes", runId)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.nodes.length()").value(2))
                .andExpect(jsonPath("$.data.nodes[0].node_id").value("n1"))
                .andExpect(jsonPath("$.data.nodes[0].type").value("asset"))
                .andExpect(jsonPath("$.data.nodes[0].asset_id").value(5))
                .andExpect(jsonPath("$.data.nodes[1].asset_id").doesNotExist());
    }

    @Test
    void readCanvasNodeReturnsDetailWithData() throws Exception {
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedCanvas(project.getId(),
                "[{\"id\":\"n1\",\"type\":\"asset\",\"data\":{\"assetId\":5,\"label\":\"蓝鲸\"}}]");
        mockMvc.perform(get("/internal/agent-runs/{runId}/canvas/nodes/{nodeId}", runId, "n1")
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.node_id").value("n1"))
                .andExpect(jsonPath("$.data.asset_id").value(5))
                .andExpect(jsonPath("$.data.data.label").value("蓝鲸"));
    }

    @Test
    void readAssetAllowsCanvasReferencedAsset() throws Exception {
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedCanvas(project.getId(),
                "[{\"id\":\"n1\",\"type\":\"asset\",\"data\":{\"assetId\":5}}]");
        seedAsset(project.getId(), 10L, 5L, "image", "normal");
        mockMvc.perform(get("/internal/agent-runs/{runId}/assets/{assetId}", runId, 5)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.asset_id").value(5))
                .andExpect(jsonPath("$.data.type").value("image"))
                .andExpect(jsonPath("$.data.status").value("normal"));
    }

    @Test
    void readAssetRejectsAssetNotInWhitelist() throws Exception {
        // assetId=99 既不在画布节点也不在本 Run 生成任务输出 → 白名单拒绝（不泄漏存在性）
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedCanvas(project.getId(), "[{\"id\":\"n1\",\"type\":\"asset\",\"data\":{\"assetId\":5}}]");
        seedAsset(project.getId(), 10L, 99L, "image", "normal");
        mockMvc.perform(get("/internal/agent-runs/{runId}/assets/{assetId}", runId, 99)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value(100301));
    }

    @Test
    void readAssetRejectsFailedStatusAsset() throws Exception {
        // 在白名单内但 status=failed → 三元组校验拒绝
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedCanvas(project.getId(),
                "[{\"id\":\"n1\",\"type\":\"asset\",\"data\":{\"assetId\":5}}]");
        seedAsset(project.getId(), 10L, 5L, "image", "failed");
        mockMvc.perform(get("/internal/agent-runs/{runId}/assets/{assetId}", runId, 5)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value(100301));
    }

    @Test
    void readAssetAllowsJobOutputAsset() throws Exception {
        // assetId=7 不在画布，但为本 Run 的 agent_run 来源生成任务输出 → 白名单 ∪ 放行
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedCanvas(project.getId(), "[]");
        seedAsset(project.getId(), 10L, 7L, "image", "normal");
        seedAgentRunJob(project.getId(), 10L, runId, "[7]");
        mockMvc.perform(get("/internal/agent-runs/{runId}/assets/{assetId}", runId, 7)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.asset_id").value(7));
    }

    @Test
    void readAssetAllowsConversationReferencedAsset() throws Exception {
        // AC2：画布空、无 Run 产物、X 只经第三源（同 Conversation @ 引用）放行
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedCanvas(project.getId(), "[]");
        Long messageId = seedMessageReturningId(conversationId, project.getId(), "user", "看这张", 1);
        seedReference(messageId, conversationId, project.getId(), 9L, 1);
        seedAsset(project.getId(), 10L, 9L, "image", "normal");
        mockMvc.perform(get("/internal/agent-runs/{runId}/assets/{assetId}", runId, 9)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.asset_id").value(9));
    }

    @Test
    void readAssetAllowsReferencedAssetFromPriorRunInSameConversation() throws Exception {
        // AC3 追问：同 Conversation 两 Run，Run A 带 @ X，Run B 不带；用 Run B 的 lease 读 X 放行
        // （第三源按 conversationId 查到 Run A 落的引用行，追问轮次放行）
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        Long runB = jdbcTemplate.queryForObject(
                "SELECT MAX(id) FROM agent_runs WHERE conversation_id = ?", Long.class, conversationId);
        seedCanvas(project.getId(), "[]");
        Long messageId = seedMessageReturningId(conversationId, project.getId(), "user", "Run A @ X", 1);
        seedReference(messageId, conversationId, project.getId(), 9L, 1);
        seedAsset(project.getId(), 10L, 9L, "image", "normal");
        mockMvc.perform(get("/internal/agent-runs/{runId}/assets/{assetId}", runB, 9)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.asset_id").value(9));
    }

    @Test
    void readAssetRejectsAssetReferencedInOtherConversation() throws Exception {
        // AC3 隔离：同 Project 两 Conversation，X 只在 conv1 @ 引用、只经第三源可达；
        // conv2 的 Run 读 X → 100301（第三源按 conversationId 隔离）
        Project project = newProject(10L);
        Long conv1 = seedConversation(project.getId());
        Long conv2 = seedConversation(project.getId());
        seedLeasedRun(project.getId(), conv1, 10L, "worker-1");
        Long run2 = seedLeasedRun(project.getId(), conv2, 10L, "worker-1");
        seedCanvas(project.getId(), "[]");
        Long message1 = seedMessageReturningId(conv1, project.getId(), "user", "conv1 @ X", 1);
        seedReference(message1, conv1, project.getId(), 9L, 1);
        seedAsset(project.getId(), 10L, 9L, "image", "normal");
        mockMvc.perform(get("/internal/agent-runs/{runId}/assets/{assetId}", run2, 9)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value(100301));
    }

    @Test
    void readAssetRejectsAssetReferencedInOtherProject() throws Exception {
        // AC4 跨 Project：X 在 projectA 引用，projectB 的 Run 读 X → 100301
        // （第三源用 projectB conv 查不到 + 三元组 projectId 兜底）
        Project projectA = newProject(10L);
        Project projectB = new Project().setOwnerId(10L).setName("ctx-read-other-proj");
        projectMapper.insert(projectB);
        Long convA = seedConversation(projectA.getId());
        Long convB = seedConversation(projectB.getId());
        Long runB = seedLeasedRun(projectB.getId(), convB, 10L, "worker-1");
        seedCanvas(projectA.getId(), "[]");
        seedCanvas(projectB.getId(), "[]");
        Long messageA = seedMessageReturningId(convA, projectA.getId(), "user", "A @ X", 1);
        seedReference(messageA, convA, projectA.getId(), 9L, 1);
        seedAsset(projectA.getId(), 10L, 9L, "image", "normal");
        mockMvc.perform(get("/internal/agent-runs/{runId}/assets/{assetId}", runB, 9)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value(100301));
    }

    @Test
    void readAssetRejectsAssetReferencedByOtherUser() throws Exception {
        // AC4 跨 User：直接 seed 越权引用行（绕过写路径 filterOwnedReferenceAssetIds），
        // asset userId=11 ≠ run userId=10；第三源 surface 后三元组 userId 拒
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedCanvas(project.getId(), "[]");
        Long messageId = seedMessageReturningId(conversationId, project.getId(), "user", "@ X", 1);
        seedReference(messageId, conversationId, project.getId(), 9L, 1);
        seedAsset(project.getId(), 11L, 9L, "image", "normal");
        mockMvc.perform(get("/internal/agent-runs/{runId}/assets/{assetId}", runId, 9)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value(100301));
    }

    @Test
    void readGenerationJobStatusReturnsStatus() throws Exception {
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        Long jobId = seedAgentRunJob(project.getId(), 10L, runId, "[7]");
        mockMvc.perform(get("/internal/agent-runs/{runId}/generation-jobs/{jobId}/status", runId, jobId)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.job_id").value(jobId.intValue()))
                .andExpect(jsonPath("$.data.type").value("image"))
                .andExpect(jsonPath("$.data.status").value("succeeded"))
                .andExpect(jsonPath("$.data.progress").value(100))
                .andExpect(jsonPath("$.data.output_asset_ids[0]").value(7));
    }

    @Test
    void readGenerationJobStatusRejectsCrossRunJob() throws Exception {
        // 同 project+user 但 job 属另一 run → agent_run_id 校验拒绝（与 read_asset 白名单同口径）
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runA = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        Long runB = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        Long jobB = seedAgentRunJob(project.getId(), 10L, runB, "[7]");
        mockMvc.perform(get("/internal/agent-runs/{runId}/generation-jobs/{jobId}/status", runA, jobB)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value(100301));
    }

    @Test
    void endpointsRejectForeignWorkerAndCrossProject() throws Exception {
        Project projectA = newProject(10L);
        Project projectB = new Project().setOwnerId(11L).setName("ctx-read-other-owner");
        projectMapper.insert(projectB);
        Long conversationA = seedConversation(projectA.getId());
        Long conversationB = seedConversation(projectB.getId());
        Long runA = seedLeasedRun(projectA.getId(), conversationA, 10L, "worker-1");
        Long runB = seedLeasedRun(projectB.getId(), conversationB, 11L, "worker-2");
        seedCanvas(projectA.getId(), "[{\"id\":\"n1\",\"type\":\"asset\",\"data\":{\"assetId\":5}}]");
        seedCanvas(projectB.getId(), "[{\"id\":\"n1\",\"type\":\"asset\",\"data\":{\"assetId\":6}}]");
        // worker-2 读 worker-1 租约的 runA → 100303
        mockMvc.perform(get("/internal/agent-runs/{runId}/canvas/nodes", runA)
                        .header("X-Worker-Id", "worker-2"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value(100303));
        // worker-1 读 projectB 的 runB（租约属 worker-2）→ 100303
        mockMvc.perform(get("/internal/agent-runs/{runId}/canvas/nodes", runB)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value(100303));
        // worker-1 读自己 runA → 正常
        mockMvc.perform(get("/internal/agent-runs/{runId}/canvas/nodes", runA)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.nodes[0].asset_id").value(5));
    }

    private Project newProject(long ownerId) {
        Project project = new Project().setOwnerId(ownerId).setName("ctx-read-" + ownerId);
        projectMapper.insert(project);
        return project;
    }

    private Long seedConversation(Long projectId) {
        jdbcTemplate.update("INSERT INTO conversations (project_id) VALUES (?)", projectId);
        return jdbcTemplate.queryForObject(
                "SELECT MAX(id) FROM conversations WHERE project_id = ?", Long.class, projectId);
    }

    private Long seedLeasedRun(Long projectId, Long conversationId, Long userId, String workerId) {
        jdbcTemplate.update(
                "INSERT INTO agent_runs (project_id, conversation_id, user_id, status, engine, engine_version, "
                        + "adapter_schema_version, lease_owner, lease_expires_at, fencing_token) "
                        + "VALUES (?,?,?,?,?,?,?,?, DATEADD('MINUTE', 5, CURRENT_TIMESTAMP), 1)",
                projectId, conversationId, userId, AgentRun.STATUS_RUNNING, "fake", "1", 1, workerId);
        return jdbcTemplate.queryForObject(
                "SELECT MAX(id) FROM agent_runs WHERE conversation_id = ?", Long.class, conversationId);
    }

    private void seedCanvas(Long projectId, String nodesJson) {
        jdbcTemplate.update(
                "INSERT INTO canvas (project_id, nodes_json) VALUES (?,?)", projectId, nodesJson);
    }

    private void seedAsset(Long projectId, Long userId, Long assetId, String type, String status) {
        jdbcTemplate.update(
                "INSERT INTO assets (id, project_id, user_id, type, source, status, url) "
                        + "VALUES (?,?,?,?,?,?,?)",
                assetId, projectId, userId, type, "generated", status, "https://cdn.test/" + assetId);
    }

    private Long seedAgentRunJob(Long projectId, Long userId, Long runId, String outputAssetIds) {
        jdbcTemplate.update(
                "INSERT INTO generation_jobs (project_id, user_id, agent_run_id, type, source, status, "
                        + "progress, output_asset_ids, expected_output_count) "
                        + "VALUES (?,?,?,?,?,?,?,?,1)",
                projectId, userId, runId, "image", "agent_run", "succeeded", 100, outputAssetIds);
        return jdbcTemplate.queryForObject(
                "SELECT MAX(id) FROM generation_jobs WHERE agent_run_id = ?", Long.class, runId);
    }

    private Long seedMessageReturningId(Long conversationId, Long projectId, String role, String content, int sequenceNo) {
        jdbcTemplate.update(
                "INSERT INTO conversation_messages (conversation_id, project_id, role, content, sequence_no) "
                        + "VALUES (?,?,?,?,?)",
                conversationId, projectId, role, content, sequenceNo);
        return jdbcTemplate.queryForObject(
                "SELECT MAX(id) FROM conversation_messages WHERE conversation_id = ?", Long.class, conversationId);
    }

    private void seedReference(Long messageId, Long conversationId, Long projectId, Long assetId, int mentionSeq) {
        jdbcTemplate.update(
                "INSERT INTO message_asset_reference (message_id, conversation_id, project_id, asset_id, mention_seq) "
                        + "VALUES (?,?,?,?,?)",
                messageId, conversationId, projectId, assetId, mentionSeq);
    }
}
