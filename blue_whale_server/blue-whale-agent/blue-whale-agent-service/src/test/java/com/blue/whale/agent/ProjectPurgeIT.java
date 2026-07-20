package com.blue.whale.agent;

import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.AssetStorageObjectMapper;
import com.blue.whale.agent.mapper.ConversationMapper;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.mapper.CostReservationMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.dto.AcceptConversationMessageRequest;
import com.blue.whale.agent.model.dto.GenerationResultCommand;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.AssetStorageObject;
import com.blue.whale.agent.model.entity.CostReservation;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.ConversationCommandService;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import com.blue.whale.agent.service.governance.CostReservationCommand;
import com.blue.whale.agent.service.governance.CostReservationService;
import com.blue.whale.agent.service.governance.PriceQuote;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.sql.Timestamp;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 项目永久删除集成测试（IK25EG）：普通 Canvas Project 经 {@code DELETE /api/projects/{id}}
 * 物理级联删除全部内容；在途任务成本面尽力终结；迟到结果与迟到写入不得复活内容；
 * 跨项目独立作品副本与共享存储对象不受影响；审计记录按既有策略保留。
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
class ProjectPurgeIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private ConversationMapper conversationMapper;
    @Autowired
    private ConversationMessageMapper messageMapper;
    @Autowired
    private AgentRunMapper agentRunMapper;
    @Autowired
    private GenerationJobMapper generationJobMapper;
    @Autowired
    private AssetMapper assetMapper;
    @Autowired
    private AssetStorageObjectMapper storageObjectMapper;
    @Autowired
    private CostReservationMapper costReservationMapper;
    @Autowired
    private CostReservationService costReservationService;
    @Autowired
    private GenerationResultAcceptanceService acceptanceService;
    @Autowired
    private ConversationCommandService conversationCommandService;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void cleanProjectFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM audit_records",
                "DELETE FROM cost_reservations",
                "DELETE FROM cost_budget_locks",
                "DELETE FROM user_input_requests",
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM command_idempotency",
                "DELETE FROM conversation_messages",
                "DELETE FROM generation_result_conflicts",
                "DELETE FROM generation_provider_tasks",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM generation_jobs",
                "DELETE FROM asset_storage_objects",
                "DELETE FROM assets",
                "DELETE FROM agent_runs",
                "DELETE FROM conversations",
                "DELETE FROM canvas",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void deletePermanentlyRemovesCanvasProjectContentsButKeepsAuditEvents() throws Exception {
        // ac-7：确认后永久移除该 Project 的画布、对话、生成记录和作品，不提供恢复入口
        long projectId = createProject("海报项目");
        jdbcTemplate.update("INSERT INTO canvas (project_id, viewport_json, nodes_json) "
                + "VALUES (?, '{}', '[]')", projectId);
        jdbcTemplate.update("INSERT INTO conversations (project_id) VALUES (?)", projectId);
        Long conversationId = jdbcTemplate.queryForObject(
                "SELECT id FROM conversations WHERE project_id = ?", Long.class, projectId);
        jdbcTemplate.update("INSERT INTO conversation_messages "
                        + "(conversation_id, project_id, role, content, sequence_no) VALUES (?, ?, 'user', '画海报', 1)",
                conversationId, projectId);
        Long messageId = jdbcTemplate.queryForObject(
                "SELECT id FROM conversation_messages WHERE project_id = ?", Long.class, projectId);
        jdbcTemplate.update("INSERT INTO agent_runs "
                        + "(project_id, conversation_id, user_id, status, engine, engine_version, adapter_schema_version) "
                        + "VALUES (?, ?, 10, 'queued', 'fake', '1', 1)", projectId, conversationId);
        Long runId = jdbcTemplate.queryForObject(
                "SELECT id FROM agent_runs WHERE project_id = ?", Long.class, projectId);
        jdbcTemplate.update("INSERT INTO runtime_checkpoints "
                + "(agent_run_id, sequence_no, run_version, engine, engine_version, adapter_schema_version, "
                + "payload_digest, opaque_payload) VALUES (?, 1, 1, 'fake', '1', 1, 'digest', '{}')", runId);
        Long checkpointId = jdbcTemplate.queryForObject(
                "SELECT id FROM runtime_checkpoints WHERE agent_run_id = ?", Long.class, runId);
        jdbcTemplate.update("INSERT INTO run_commits "
                + "(agent_run_id, commit_id, request_hash, checkpoint_id, committed_cursor) "
                + "VALUES (?, 'commit-1', 'hash', ?, 1)", runId, checkpointId);
        jdbcTemplate.update("INSERT INTO user_input_requests "
                + "(project_id, user_id, conversation_id, source_agent_run_id, action_identity, action_type, "
                + "arguments_digest, status, expires_at) "
                + "VALUES (?, 10, ?, ?, 'action-1', 'generate_image', 'digest', 'answered', CURRENT_TIMESTAMP)",
                projectId, conversationId, runId);
        jdbcTemplate.update("INSERT INTO generation_jobs (project_id, user_id, agent_run_id, type, source, status) "
                + "VALUES (?, 10, ?, 'image', 'agent_run', 'succeeded')", projectId, runId);
        Long jobId = jdbcTemplate.queryForObject(
                "SELECT id FROM generation_jobs WHERE project_id = ?", Long.class, projectId);
        jdbcTemplate.update("INSERT INTO generation_job_outputs (generation_job_id, slot_index, status) "
                + "VALUES (?, 0, 'succeeded')", jobId);
        jdbcTemplate.update("INSERT INTO generation_provider_tasks "
                + "(generation_job_id, slot_index, provider, account_id, submission_state, "
                + "callback_capability_digest) VALUES (?, 0, 'volcengine', 'acct', 'succeeded', 'digest')", jobId);
        jdbcTemplate.update("INSERT INTO generation_result_conflicts "
                + "(generation_job_id, slot_index, attempted_delivery_id, expected_content_sha256, "
                + "actual_content_sha256, reason) VALUES (?, 0, 'delivery-1', 'a', 'b', 'mismatch')", jobId);
        Asset asset = new Asset()
                .setProjectId(projectId)
                .setUserId(10L)
                .setGenerationJobId(jobId)
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey("purge/poster.png")
                .setMime("image/png")
                .setSize(128L)
                .setSource(Asset.SOURCE_GENERATED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(asset);

        mockMvc.perform(delete("/api/projects/{id}", projectId).header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200));

        assertThat(messageMapper.selectById(messageId)).isNull();
        assertThat(conversationMapper.selectById(conversationId)).isNull();
        assertThat(agentRunMapper.selectById(runId)).isNull();
        assertThat(generationJobMapper.selectById(jobId)).isNull();
        assertThat(assetMapper.selectById(asset.getId())).isNull();
        assertThat(projectMapper.selectById(projectId)).isNull();
        assertThat(count("canvas", "project_id", projectId)).isZero();
        assertThat(count("runtime_checkpoints", "agent_run_id", runId)).isZero();
        assertThat(count("run_commits", "agent_run_id", runId)).isZero();
        assertThat(count("user_input_requests", "project_id", projectId)).isZero();
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isZero();
        assertThat(count("generation_provider_tasks", "generation_job_id", jobId)).isZero();
        assertThat(count("generation_result_conflicts", "generation_job_id", jobId)).isZero();
        // 最小审计：project.deleted 事件与 outbox 保留，其余事件不携带可恢复作品内容
        assertThat(count("project_events", "project_id", projectId)).isGreaterThan(0);
        assertThat(countWhere("project_events", "project_id = " + projectId
                + " AND event_type = 'project.deleted'")).isEqualTo(1);
        assertThat(count("outbox_messages", "project_id", projectId)).isGreaterThan(0);

        mockMvc.perform(get("/api/projects/{id}", projectId).header("X-User-Id", "10"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100301));
        mockMvc.perform(get("/api/projects").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    void deleteReleasesQueuedReservationAndMarksProcessingJobForReconciliation() throws Exception {
        // ac-8：删除时排队任务释放成本预留（供应商未被调用），在途任务预留转对账（供应商结果未知）
        long projectId = createProject("成本项目");
        jdbcTemplate.update("INSERT INTO generation_jobs (project_id, user_id, type, source, status) "
                + "VALUES (?, 10, 'image', 'agent_run', 'queued')", projectId);
        Long queuedJobId = jdbcTemplate.queryForObject(
                "SELECT id FROM generation_jobs WHERE project_id = ? AND status = 'queued'",
                Long.class, projectId);
        costReservationService.reserve(new CostReservationCommand(
                10L, projectId, queuedJobId, "action-queued", "generate_image",
                new PriceQuote(25L, "image-sync", "price-test", "cny-test", "model-policy-test")));

        jdbcTemplate.update("INSERT INTO generation_jobs "
                        + "(project_id, user_id, type, source, status, lease_owner, lease_expires_at, fencing_token) "
                        + "VALUES (?, 10, 'image', 'agent_run', 'processing', 'worker-1', ?, 7)",
                projectId, Timestamp.valueOf(LocalDateTime.now().plusMinutes(10)));
        Long processingJobId = jdbcTemplate.queryForObject(
                "SELECT id FROM generation_jobs WHERE project_id = ? AND status = 'processing'",
                Long.class, projectId);
        costReservationService.reserve(new CostReservationCommand(
                10L, projectId, processingJobId, "action-processing", "generate_image",
                new PriceQuote(25L, "image-sync", "price-test", "cny-test", "model-policy-test")));

        // 无成本预留的排队任务：尽力终结路径跳过，不阻断删除
        jdbcTemplate.update("INSERT INTO generation_jobs (project_id, user_id, type, source, status) "
                + "VALUES (?, 10, 'image', 'agent_run', 'queued')", projectId);

        mockMvc.perform(delete("/api/projects/{id}", projectId).header("X-User-Id", "10"))
                .andExpect(status().isOk());

        CostReservation queued = costReservationMapper.selectByJob(queuedJobId);
        assertThat(queued.getStatus()).isEqualTo("RELEASED");
        assertThat(queued.getActualAmountFen()).isEqualTo(0L);
        CostReservation processing = costReservationMapper.selectByJob(processingJobId);
        assertThat(processing.getStatus()).isEqualTo("PENDING_RECONCILIATION");
        assertThat(count("generation_jobs", "project_id", projectId)).isZero();
        // 成本状态迁移留有审计轨迹（reason code 区分释放与对账）
        assertThat(countWhere("audit_records", "project_id = " + projectId
                + " AND reason_code = 'CANCELLED_BEFORE_PROVIDER'")).isEqualTo(1);
        assertThat(countWhere("audit_records", "project_id = " + projectId
                + " AND reason_code = 'PROJECT_PURGED'")).isEqualTo(1);
    }

    @Test
    void lateGenerationResultAfterDeleteCannotResurrectContent() throws Exception {
        // ac-8：删除后迟到的任务结果按资源不存在拒绝，不能重新创建 Project、Asset 或其他可见内容
        long projectId = createProject("迟到结果项目");
        jdbcTemplate.update("INSERT INTO generation_jobs "
                        + "(project_id, user_id, type, source, status, lease_owner, lease_expires_at, fencing_token) "
                        + "VALUES (?, 10, 'image', 'agent_run', 'processing', 'worker-1', ?, 7)",
                projectId, Timestamp.valueOf(LocalDateTime.now().plusMinutes(10)));
        Long jobId = jdbcTemplate.queryForObject(
                "SELECT id FROM generation_jobs WHERE project_id = ?", Long.class, projectId);
        jdbcTemplate.update("INSERT INTO generation_job_outputs (generation_job_id, slot_index, status) "
                + "VALUES (?, 0, 'pending')", jobId);

        mockMvc.perform(delete("/api/projects/{id}", projectId).header("X-User-Id", "10"))
                .andExpect(status().isOk());

        assertThatThrownBy(() -> acceptanceService.acceptSuccess(new GenerationResultCommand(
                jobId, 0, 0, 7L, "worker-1", "delivery-late", "late/result.png",
                "a".repeat(64), "image/png", 128L)))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.RESOURCE_NOT_FOUND_CODE);
        assertThat(count("assets", "project_id", projectId)).isZero();
        assertThat(count("generation_jobs", "project_id", projectId)).isZero();
        assertThat(projectMapper.selectById(projectId)).isNull();
    }

    @Test
    void lateConversationMessageAfterDeleteIsRejected() throws Exception {
        // ac-8：删除后迟到的对话写入按资源不存在拒绝（purge 锁项目行与写入方串行）
        long projectId = createProject("迟到消息项目");
        jdbcTemplate.update("INSERT INTO conversations (project_id) VALUES (?)", projectId);
        Long conversationId = jdbcTemplate.queryForObject(
                "SELECT id FROM conversations WHERE project_id = ?", Long.class, projectId);

        mockMvc.perform(delete("/api/projects/{id}", projectId).header("X-User-Id", "10"))
                .andExpect(status().isOk());

        assertThatThrownBy(() -> conversationCommandService.accept(projectId, 10L, "late-key",
                new AcceptConversationMessageRequest("client-late", "迟到消息", null, conversationId)))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.RESOURCE_NOT_FOUND_CODE);
        assertThat(count("conversation_messages", "project_id", projectId)).isZero();
    }

    @Test
    void deleteDoesNotAffectCopiedAssetsInOtherProjects() throws Exception {
        // ac-9：删除来源 Project 不删除其他 Project 的独立作品副本；共享存储对象不进入待回收
        long sourceProjectId = createProject("来源项目");
        long copyProjectId = createProject("副本项目");
        insertStorageObject("shared/copied.png");
        insertStorageObject("solo/source-only.png");
        Asset sourceAsset = insertAsset(sourceProjectId, "shared/copied.png", null);
        insertAsset(sourceProjectId, "solo/source-only.png", null);
        Asset copiedAsset = insertAsset(copyProjectId, "shared/copied.png", sourceAsset.getId());

        mockMvc.perform(delete("/api/projects/{id}", sourceProjectId).header("X-User-Id", "10"))
                .andExpect(status().isOk());

        assertThat(assetMapper.selectById(sourceAsset.getId())).isNull();
        assertThat(assetMapper.selectById(copiedAsset.getId())).isNotNull();
        assertThat(projectMapper.selectById(copyProjectId)).isNotNull();
        assertThat(storageObjectMapper.selectOne(com.baomidou.mybatisplus.core.toolkit.Wrappers
                .<AssetStorageObject>lambdaQuery()
                .eq(AssetStorageObject::getStorageKey, "shared/copied.png"))
                .getFirstUnreferencedAt()).isNull();
        assertThat(storageObjectMapper.selectOne(com.baomidou.mybatisplus.core.toolkit.Wrappers
                .<AssetStorageObject>lambdaQuery()
                .eq(AssetStorageObject::getStorageKey, "solo/source-only.png"))
                .getFirstUnreferencedAt()).isNotNull();
    }

    private long createProject(String name) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/projects")
                        .header("X-User-Id", "10")
                        .contentType("application/json")
                        .content("{\"name\":\"" + name + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andReturn();
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return data.path("id").asLong();
    }

    private void insertStorageObject(String storageKey) {
        storageObjectMapper.insert(new AssetStorageObject()
                .setStorageKey(storageKey)
                .setSource(Asset.SOURCE_UPLOADED)
                .setState(AssetStorageObject.STATE_AVAILABLE)
                .setActiveTransferCount(0));
    }

    private Asset insertAsset(Long projectId, String storageKey, Long sourceAssetId) {
        Asset asset = new Asset()
                .setProjectId(projectId)
                .setUserId(10L)
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey(storageKey)
                .setMime("image/png")
                .setSize(128L)
                .setSource(Asset.SOURCE_UPLOADED)
                .setStatus(Asset.STATUS_NORMAL)
                .setSourceAssetId(sourceAssetId);
        assetMapper.insert(asset);
        return asset;
    }

    private long count(String table, String column, Long value) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return result == null ? 0L : result;
    }

    private long countWhere(String table, String whereClause) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + whereClause, Long.class);
        return result == null ? 0L : result;
    }
}
