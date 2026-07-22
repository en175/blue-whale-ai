package com.blue.whale.agent;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.Project;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
class ConversationAgentRunIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private AssetMapper assetMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void cleanAgentRunFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM audit_records",
                "DELETE FROM cost_reservations",
                "DELETE FROM cost_budget_locks",
                "DELETE FROM user_input_requests",
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM command_idempotency",
                "DELETE FROM message_asset_reference",
                "DELETE FROM conversation_messages",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM generation_jobs",
                "DELETE FROM assets",
                "DELETE FROM agent_runs",
                "DELETE FROM conversations",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void repeatedMessageReturnsFirstAcceptanceWithoutDuplicatingFacts() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("agent-run-idempotency");
        projectMapper.insert(project);
        String body = "{\"client_message_id\":\"client-1\",\"content\":\"生成一张蓝鲸海报\"}";

        MvcResult first = mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "message-key-1")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.message_id").isNumber())
                .andExpect(jsonPath("$.data.agent_run_id").isNumber())
                .andReturn();

        MvcResult repeated = mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "message-key-1")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isAccepted())
                .andReturn();

        JsonNode firstData = objectMapper.readTree(first.getResponse().getContentAsString()).path("data");
        JsonNode repeatedData = objectMapper.readTree(repeated.getResponse().getContentAsString()).path("data");
        assertThat(repeatedData).isEqualTo(firstData);
        assertThat(count("conversation_messages", "project_id", project.getId())).isEqualTo(1);
        assertThat(count("agent_runs", "project_id", project.getId())).isEqualTo(1);
        assertThat(count("project_events", "project_id", project.getId())).isEqualTo(2);
        assertThat(count("outbox_messages", "project_id", project.getId())).isEqualTo(2);
    }

    @Test
    void sameIdempotencyKeyWithDifferentRequestIsRejectedWithoutSideEffects() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("agent-run-conflict");
        projectMapper.insert(project);

        mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "conflicting-key")
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"client-a\",\"content\":\"生成蓝鲸\"}"))
                .andExpect(status().isAccepted());

        mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "conflicting-key")
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"client-b\",\"content\":\"生成白鲸\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100302));

        assertThat(count("conversation_messages", "project_id", project.getId())).isEqualTo(1);
        assertThat(count("agent_runs", "project_id", project.getId())).isEqualTo(1);
        assertThat(count("project_events", "project_id", project.getId())).isEqualTo(2);
    }

    @Test
    void messageRequiresAuthenticationAndProjectOwnership() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("owned-project");
        projectMapper.insert(project);
        String body = "{\"client_message_id\":\"client-auth\",\"content\":\"生成蓝鲸\"}";

        mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("Idempotency-Key", "missing-user")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "11")
                        .header("Idempotency-Key", "wrong-user")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isNotFound());

        assertThat(count("conversation_messages", "project_id", project.getId())).isZero();
        assertThat(count("agent_runs", "project_id", project.getId())).isZero();
        assertThat(count("project_events", "project_id", project.getId())).isZero();
    }

    @Test
    void fakeRunCommitCreatesOneCheckpointMessageAndQueuedGenerationJob() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("fake-run-commit");
        projectMapper.insert(project);
        JsonNode accepted = postMessage(project.getId(), "run-message-key", "生成一张蓝鲸海报");
        long runId = accepted.path("agent_run_id").asLong();

        MvcResult claimed = mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", "fake-worker-1")
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.agent_run_id").value(runId))
                .andExpect(jsonPath("$.data.engine").value("fake"))
                .andReturn();
        JsonNode work = objectMapper.readTree(claimed.getResponse().getContentAsString()).path("data");
        String commitBody = "{" +
                "\"commit_id\":\"commit-1\"," +
                "\"project_id\":" + project.getId() + "," +
                "\"user_id\":10," +
                "\"expected_run_version\":" + work.path("run_version").asInt() + "," +
                "\"fencing_token\":" + work.path("fencing_token").asLong() + "," +
                "\"engine\":\"fake\"," +
                "\"engine_version\":\"1\"," +
                "\"adapter_schema_version\":1," +
                "\"visible_text\":\"已接纳，正在生成图片。\"," +
                "\"checkpoint\":{\"opaque_payload\":{\"step\":\"proposed\"}}," +
                "\"actions\":[{\"action_id\":\"action-1\",\"tool_id\":\"create_image_generation_job\",\"registry_version\":1," +
                "\"arguments\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}}]}";

        MvcResult firstCommit = postCommit(runId, commitBody)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_job_id").isNumber())
                .andExpect(jsonPath("$.data.checkpoint_id").isNumber())
                .andReturn();
        MvcResult repeatedCommit = postCommit(runId, commitBody)
                .andExpect(status().isOk())
                .andReturn();
        MvcResult reorderedCommit = postCommit(runId, commitBody.replace(
                        "\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"",
                        "\"aspect_ratio\":\"1:1\",\"prompt\":\"蓝鲸海报\""))
                .andExpect(status().isOk())
                .andReturn();
        postCommit(runId, commitBody.replace("正在生成图片", "准备生成图片"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100302));

        JsonNode firstData = objectMapper.readTree(firstCommit.getResponse().getContentAsString()).path("data");
        JsonNode repeatedData = objectMapper.readTree(repeatedCommit.getResponse().getContentAsString()).path("data");
        JsonNode reorderedData = objectMapper.readTree(reorderedCommit.getResponse().getContentAsString()).path("data");
        assertThat(repeatedData).isEqualTo(firstData);
        assertThat(reorderedData).isEqualTo(firstData);
        assertThat(count("runtime_checkpoints", "agent_run_id", runId)).isEqualTo(1);
        assertThat(count("run_commits", "agent_run_id", runId)).isEqualTo(1);
        assertThat(count("conversation_messages", "project_id", project.getId())).isEqualTo(2);
        assertThat(count("generation_jobs", "agent_run_id", runId)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT source FROM generation_jobs WHERE agent_run_id = ?", String.class, runId))
                .isEqualTo("agent_run");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE agent_run_id = ?", String.class, runId))
                .isEqualTo("queued");
        assertThat(count("project_events", "project_id", project.getId())).isEqualTo(6);
        assertThat(count("outbox_messages", "project_id", project.getId())).isEqualTo(6);

        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages.length()").value(2))
                .andExpect(jsonPath("$.data.conversation_messages[1].content")
                        .value("已接纳，正在生成图片。"))
                .andExpect(jsonPath("$.data.agent_runs[0].agent_run_id").value(runId))
                .andExpect(jsonPath("$.data.agent_runs[0].status").value("awaiting_job"))
                .andExpect(jsonPath("$.data.generation_jobs[0].source").value("agent_run"))
                .andExpect(jsonPath("$.data.generation_jobs[0].agent_run_id").value(runId));
    }

    @Test
    void bundleEvidenceEntersCommitIdempotency() throws Exception {
        // IK2QBQ：资源读取证据随 commit 回传 Java（契约 §6 第 4 条），与 usage 同通道——
        // 证据经 requestDigest 纳入幂等键，不改变既有 commit 语义。带证据的提交被接纳，
        // 同 commit_id 证据漂移或缺失则判 IDEMPOTENCY_KEY_REUSED。
        Project project = new Project().setOwnerId(10L).setName("bundle-evidence-commit");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "evidence-message-key", "生成一张蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String evidenceA = "\"bundle_evidence\":[{\"resource_id\":\"skill_root\",\"revision\":1,"
                + "\"content_digest\":\"sha256:aaaa\",\"token_estimate\":32,\"origin\":\"on_demand\"}]";
        String evidenceB = "\"bundle_evidence\":[{\"resource_id\":\"skill_root\",\"revision\":1,"
                + "\"content_digest\":\"sha256:bbbb\",\"token_estimate\":32,\"origin\":\"history\"}]";
        String bodyA = commitBodyWithEvidence(project.getId(), work, evidenceA);

        // 带证据的 commit 被 Java 接收并正常推进生图动作
        postCommit(runId, bodyA)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_job_id").isNumber());
        // 同 commit_id 同证据 → 幂等成功
        postCommit(runId, bodyA).andExpect(status().isOk());
        // 同 commit_id 证据内容变 → 冲突：证据纳入 requestDigest 幂等键
        postCommit(runId, commitBodyWithEvidence(project.getId(), work, evidenceB))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100302));
        // 同 commit_id 去掉证据 → 冲突：证据有无同样影响摘要
        postCommit(runId, commitBodyWithEvidence(project.getId(), work, null))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100302));
        assertThat(count("run_commits", "agent_run_id", runId)).isEqualTo(1);
    }

    @Test
    void bundleEvidencePersistedToMainAuditRecords() throws Exception {
        // IK3AH2（契约 §6.4）：ReadEvidence 逐条落主 audit_records（action=bundle.read_evidence /
        // decision=observed），兑现「只读访问可追溯」承诺；空证据不落证据审计行。
        Project project = new Project().setOwnerId(10L).setName("bundle-evidence-audit");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "evidence-audit-key", "生成一张蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String evidence = "\"bundle_evidence\":["
                + "{\"resource_id\":\"skill_root\",\"revision\":2,\"content_digest\":\"sha256:aaa\","
                + "\"token_estimate\":32,\"origin\":\"on_demand\"},"
                + "{\"resource_id\":\"skill_node_1\",\"revision\":1,\"content_digest\":\"sha256:bbb\","
                + "\"token_estimate\":64,\"origin\":\"history\"}]";
        postCommit(runId, commitBodyWithEvidence(project.getId(), work, evidence))
                .andExpect(status().isOk());

        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM audit_records WHERE action = 'bundle.read_evidence'",
                Long.class)).isEqualTo(2L);
        String details = jdbcTemplate.queryForObject(
                "SELECT details FROM audit_records WHERE action = 'bundle.read_evidence' "
                        + "AND target_id = 'skill_root'", String.class);
        assertThat(details).contains("\"revision\":2").contains("sha256:aaa").contains("token_estimate");

        // 空证据 commit 不写证据审计行（数量仍为 2）。
        long emptyRunId = postMessage(project.getId(), "evidence-empty-key", "生成一张白鲸海报")
                .path("agent_run_id").asLong();
        JsonNode emptyWork = claim(emptyRunId);
        // 用独立 action_id 避免与带证据 run 的 action-1 撞项目级 GenerationJob 去重。
        postCommit(emptyRunId, commitBodyWithEvidence(project.getId(), emptyWork, null)
                        .replace("\"action_id\":\"action-1\"", "\"action_id\":\"action-empty\""))
                .andExpect(status().isOk());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM audit_records WHERE action = 'bundle.read_evidence'",
                Long.class)).isEqualTo(2L);
    }

    private String commitBodyWithEvidence(Long projectId, JsonNode work, String bundleEvidenceJson) {
        // 复用 validCommitBody：仅替换 commit_id，并在 actions 数组后追加可选证据段。
        String base = validCommitBody(projectId, work)
                .replace("\"commit_id\":\"commit-1\"", "\"commit_id\":\"commit-evidence\"");
        if (bundleEvidenceJson == null || bundleEvidenceJson.isBlank()) {
            return base;
        }
        return base.replace("]}", "]," + bundleEvidenceJson + "}");
    }

    @Test
    void staleRunVersionIsRejectedBeforeWritingCommitFacts() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("stale-run");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "stale-key", "生成一张蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String body = validCommitBody(project.getId(), work)
                .replace("\"expected_run_version\":" + work.path("run_version").asInt(),
                        "\"expected_run_version\":" + (work.path("run_version").asInt() + 1));

        postCommit(runId, body)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));

        assertNoCommitFacts(project.getId(), runId);
    }

    @Test
    void wrongEngineAndAdapterSchemaAreRejectedBeforeWritingCommitFacts() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("wrong-runtime-binding");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "binding-key", "生成一张蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String valid = validCommitBody(project.getId(), work);

        postCommit(runId, valid.replace("\"engine\":\"fake\"", "\"engine\":\"pydantic\""))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
        postCommit(runId, valid.replace("\"adapter_schema_version\":1",
                        "\"adapter_schema_version\":2"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
        postCommit(runId, valid.replace("\"engine_version\":\"1\"",
                        "\"engine_version\":\"2\""))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
        postCommit(runId, valid.replace("\"user_id\":10", "\"user_id\":11"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));

        assertNoCommitFacts(project.getId(), runId);
    }

    @Test
    void illegalOrFrameworkShapedActionIsRejectedBeforeWritingCommitFacts() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("illegal-action");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "action-key", "生成一张蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String body = validCommitBody(project.getId(), work)
                .replace("\"aspect_ratio\":\"1:1\"",
                        "\"aspect_ratio\":\"1:1\",\"framework_type\":\"pydantic_ai.RunContext\"");

        postCommit(runId, body)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));
        postCommit(runId, validCommitBody(project.getId(), work)
                        .replace("\"actions\":", "\"error\":{\"reason\":\"failed\"},\"actions\":"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));
        postCommit(runId, validCommitBody(project.getId(), work)
                        .replace("\"aspect_ratio\":\"1:1\"", "\"aspect_ratio\":123"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));
        postCommit(runId, validCommitBody(project.getId(), work)
                        .replace("\"action_id\":\"action-1\"",
                                "\"action_id\":\"" + "a".repeat(129) + "\""))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));
        // IK3AH2：schema 驱动校验——注册表 inputSchema/constraints 单一事实源生效。
        // constraints prompt.maxLength:2000 违约（超长 prompt）。
        postCommit(runId, validCommitBody(project.getId(), work)
                        .replace("\"蓝鲸海报\"", "\"" + "鲸".repeat(2001) + "\""))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));
        // enum 违约：aspect_ratio 非法值。
        postCommit(runId, validCommitBody(project.getId(), work)
                        .replace("\"aspect_ratio\":\"1:1\"", "\"aspect_ratio\":\"5:4\""))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));
        // maxItems 违约：reference_asset_ids 超 image 上限 4。
        postCommit(runId, validCommitBody(project.getId(), work)
                        .replace("\"aspect_ratio\":\"1:1\"",
                                "\"aspect_ratio\":\"1:1\",\"reference_asset_ids\":[1,2,3,4,5]"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));

        assertNoCommitFacts(project.getId(), runId);
    }

    @Test
    void videoActionValidatedBySchema() throws Exception {
        // IK3AH2：video tool schema 校验——duration 违反 minimum:4 拒，合法 video commit 不误伤。
        Project project = new Project().setOwnerId(10L).setName("video-schema");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "video-schema-key", "生成一段蓝鲸视频")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        // duration=3 违反注册表 minimum:4（schema 驱动，替代原 validVideoDuration）。
        postCommit(runId, videoCommitBody(project.getId(), work).replace("\"duration\":5", "\"duration\":3"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));
        assertNoCommitFacts(project.getId(), runId);

        // 合法 video commit→200 不误伤（另起 run 避开 action_id 项目级去重）。
        long okRunId = postMessage(project.getId(), "video-ok-key", "生成一段蓝鲸视频")
                .path("agent_run_id").asLong();
        JsonNode okWork = claim(okRunId);
        postCommit(okRunId, videoCommitBody(project.getId(), okWork))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_job_id").isNumber());
    }

    @Test
    void imageActionInjectsCapabilityDefaultModelId() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("default-model-injection");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "default-model-key", "生成一张小猫")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);

        postCommit(runId, validCommitBody(project.getId(), work)).andExpect(status().isOk());

        // IK21O7：Agent 不暴露模型选择，Job input 注入能力表默认 image 模型；
        // size 缺省时不记录 size 键（IK21O5 已知瑕疵），执行按能力表 defaultSize(2K)。
        JsonNode input = objectMapper.readTree(jdbcTemplate.queryForObject(
                "SELECT input FROM generation_jobs WHERE agent_run_id = ?", String.class, runId));
        assertThat(input.path("model_id").asText()).isEqualTo("doubao-seedream-5.0-lite");
        assertThat(input.path("expected_output_count").asInt()).isEqualTo(1);
        assertThat(input.has("size")).isFalse();
    }

    @Test
    void imageActionNormalizesSizeAndPassesWebSearch() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("size-web-search-action");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "size-web-search-key", "联网生成一张 2K 小猫")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String body = validCommitBody(project.getId(), work).replace(
                "\"aspect_ratio\":\"1:1\"",
                "\"aspect_ratio\":\"1:1\",\"size\":\"2K\",\"web_search\":true");

        postCommit(runId, body).andExpect(status().isOk());

        // 能力表 size 白名单大小写不敏感命中后规范化为种子 size_id；web_search 原样透传。
        JsonNode input = objectMapper.readTree(jdbcTemplate.queryForObject(
                "SELECT input FROM generation_jobs WHERE agent_run_id = ?", String.class, runId));
        assertThat(input.path("model_id").asText()).isEqualTo("doubao-seedream-5.0-lite");
        assertThat(input.path("size").asText()).isEqualTo("2k");
        assertThat(input.path("web_search").asBoolean()).isTrue();
    }

    @Test
    void invalidSizeOrWebSearchIsRejectedBeforeCostReservation() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("invalid-size-web-search");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "invalid-size-key", "生成一张小猫")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);

        postCommit(runId, validCommitBody(project.getId(), work).replace(
                        "\"aspect_ratio\":\"1:1\"",
                        "\"aspect_ratio\":\"1:1\",\"size\":\"8K\""))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));
        postCommit(runId, validCommitBody(project.getId(), work).replace(
                        "\"aspect_ratio\":\"1:1\"",
                        "\"aspect_ratio\":\"1:1\",\"web_search\":\"yes\""))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));

        // fail-early：非法 size/web_search 不落 Job、不产生 cost 预留（reserveAuthorized 之前）。
        assertNoCommitFacts(project.getId(), runId);
        assertThat(count("cost_reservations", "project_id", project.getId())).isZero();
    }

    @Test
    void nonStringSizeIsRejectedBeforeCostReservation() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("non-string-size");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "non-string-size-key", "生成一张小猫")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);

        // size 非 String 在 validateAction 结构校验即拒（不经过能力表），fail-early 零副作用。
        postCommit(runId, validCommitBody(project.getId(), work).replace(
                        "\"aspect_ratio\":\"1:1\"",
                        "\"aspect_ratio\":\"1:1\",\"size\":123"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));

        assertNoCommitFacts(project.getId(), runId);
        assertThat(count("cost_reservations", "project_id", project.getId())).isZero();
    }

    @Test
    void imageActionIsRejectedWhenNoImageCapabilityEnabled() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("capability-disabled");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "capability-disabled-key", "生成一张小猫")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);

        // 能力表无 enabled image 模型时 resolveAgentImageCapability fail-closed 拒绝；
        // 用 enabled=0 模拟空表结果，finally 恢复避免污染共享 H2 种子。
        jdbcTemplate.update("UPDATE generation_model_capability SET enabled = 0 WHERE capability_type = 'image'");
        try {
            postCommit(runId, validCommitBody(project.getId(), work))
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.code").value(100304));
        } finally {
            jdbcTemplate.update("UPDATE generation_model_capability SET enabled = 1 WHERE capability_type = 'image'");
        }

        assertNoCommitFacts(project.getId(), runId);
        assertThat(count("cost_reservations", "project_id", project.getId())).isZero();
    }

    @Test
    void imageActionPersistsValidatedReferenceAssetIds() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("reference-image-action");
        projectMapper.insert(project);
        Asset first = referenceAsset(project.getId(), "reference/first.png");
        Asset second = referenceAsset(project.getId(), "reference/second.png");
        long runId = postMessage(project.getId(), "reference-image-key", "参考素材生成海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String body = validCommitBody(project.getId(), work).replace(
                "\"aspect_ratio\":\"1:1\"",
                "\"aspect_ratio\":\"1:1\",\"reference_asset_ids\":["
                        + first.getId() + "," + second.getId() + "]");

        postCommit(runId, body).andExpect(status().isOk());

        String inputJson = jdbcTemplate.queryForObject(
                "SELECT input FROM generation_jobs WHERE agent_run_id = ?", String.class, runId);
        assertThat(objectMapper.readTree(inputJson).path("reference_asset_ids"))
                .extracting(JsonNode::asLong)
                .containsExactly(first.getId(), second.getId());
    }

    @Test
    void imageActionCannotReferenceAssetOutsideTheOwnedProject() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("owned-action-project");
        projectMapper.insert(project);
        Project other = new Project().setOwnerId(11L).setName("other-action-project");
        projectMapper.insert(other);
        Asset foreign = new Asset()
                .setProjectId(other.getId())
                .setUserId(11L)
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey("reference/foreign.png")
                .setMime("image/png")
                .setSize(128L)
                .setSource(Asset.SOURCE_UPLOADED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(foreign);
        long runId = postMessage(project.getId(), "foreign-reference-key", "参考素材生成海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String body = validCommitBody(project.getId(), work).replace(
                "\"aspect_ratio\":\"1:1\"",
                "\"aspect_ratio\":\"1:1\",\"reference_asset_ids\":[" + foreign.getId() + "]");

        postCommit(runId, body)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));

        assertNoCommitFacts(project.getId(), runId);
    }

    @Test
    void imageActionCannotReferenceAnOwnedVideoAsset() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("wrong-reference-type");
        projectMapper.insert(project);
        Asset video = new Asset()
                .setProjectId(project.getId())
                .setUserId(10L)
                .setType(Asset.TYPE_VIDEO)
                .setStorageKey("reference/video.mp4")
                .setMime("video/mp4")
                .setSize(128L)
                .setSource(Asset.SOURCE_UPLOADED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(video);
        long runId = postMessage(project.getId(), "video-reference-key", "参考素材生成海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String body = validCommitBody(project.getId(), work).replace(
                "\"aspect_ratio\":\"1:1\"",
                "\"aspect_ratio\":\"1:1\",\"reference_asset_ids\":[" + video.getId() + "]");

        postCommit(runId, body)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));
        assertNoCommitFacts(project.getId(), runId);
    }

    private Asset referenceAsset(Long projectId, String storageKey) {
        Asset asset = new Asset()
                .setProjectId(projectId)
                .setUserId(10L)
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey(storageKey)
                .setMime("image/png")
                .setSize(128L)
                .setSource(Asset.SOURCE_UPLOADED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(asset);
        return asset;
    }

    @Test
    void fakeRunCannotUseThePydanticNoActionCompletionPath() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("fake-no-action");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "fake-no-action-key", "生成一张蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String body = validCommitBody(project.getId(), work).replace(
                "\"actions\":[{\"action_id\":\"action-1\",\"tool_id\":\"create_image_generation_job\",\"registry_version\":1,"
                        + "\"arguments\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}}]",
                "\"actions\":[]");

        postCommit(runId, body)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(100304));

        assertNoCommitFacts(project.getId(), runId);
    }

    @Test
    void expiredLeaseRejectsOldWorkerAndAllowsFencedReclaim() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("expired-lease");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "lease-key", "生成一张蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode firstWork = claim(runId, "fake-worker-1");
        jdbcTemplate.update("UPDATE agent_runs SET lease_expires_at = ? WHERE id = ?",
                Timestamp.valueOf(LocalDateTime.now().minusMinutes(1)), runId);

        postCommit(runId, validCommitBody(project.getId(), firstWork), "fake-worker-1")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
        assertNoCommitFacts(project.getId(), runId);

        JsonNode reclaimed = claim(runId, "fake-worker-2");
        assertThat(reclaimed.path("fencing_token").asLong())
                .isGreaterThan(firstWork.path("fencing_token").asLong());
        postCommit(runId, validCommitBody(project.getId(), reclaimed), "fake-worker-2")
                .andExpect(status().isOk());

        assertThat(count("runtime_checkpoints", "agent_run_id", runId)).isEqualTo(1);
        assertThat(count("generation_jobs", "agent_run_id", runId)).isEqualTo(1);
    }

    @Test
    void corruptCheckpointIsRejectedBeforeReclaimSideEffects() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("corrupt-checkpoint");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "checkpoint-key", "生成一张蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        postCommit(runId, validCommitBody(project.getId(), work))
                .andExpect(status().isOk());
        Long fencingToken = jdbcTemplate.queryForObject(
                "SELECT fencing_token FROM agent_runs WHERE id = ?", Long.class, runId);
        jdbcTemplate.update("UPDATE agent_runs SET status = 'queued' WHERE id = ?", runId);
        jdbcTemplate.update("UPDATE runtime_checkpoints SET payload_digest = 'corrupt' WHERE agent_run_id = ?",
                runId);
        Project healthyProject = new Project().setOwnerId(10L).setName("healthy-after-corrupt");
        projectMapper.insert(healthyProject);
        long healthyRunId = postMessage(healthyProject.getId(), "healthy-key", "生成一张健康海报")
                .path("agent_run_id").asLong();

        JsonNode healthyWork = claim(healthyRunId, "fake-worker-2");

        assertThat(jdbcTemplate.queryForObject(
                "SELECT fencing_token FROM agent_runs WHERE id = ?", Long.class, runId))
                .isEqualTo(fencingToken);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM agent_runs WHERE id = ?", String.class, runId))
                .isEqualTo("recovery_failed");
        assertThat(count("project_events", "project_id", project.getId())).isEqualTo(7);
        assertThat(count("outbox_messages", "project_id", project.getId())).isEqualTo(7);
        assertThat(healthyWork.path("agent_run_id").asLong()).isEqualTo(healthyRunId);
    }

    @Test
    void validCheckpointSurvivesVersionedWakeAndRepeatedLeaseRecovery() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("checkpoint-recovery");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "checkpoint-recovery-key", "生成一张蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode initialWork = claim(runId);
        JsonNode committed = objectMapper.readTree(postCommit(
                        runId, validCommitBody(project.getId(), initialWork))
                        .andExpect(status().isOk())
                        .andReturn().getResponse().getContentAsString()).path("data");
        jdbcTemplate.update("UPDATE agent_runs SET status = 'queued', version = version + 1 WHERE id = ?", runId);

        JsonNode resumed = claim(runId, "fake-worker-2");
        assertThat(resumed.path("checkpoint").path("checkpoint_id").asLong())
                .isEqualTo(committed.path("checkpoint_id").asLong());
        jdbcTemplate.update("UPDATE agent_runs SET lease_expires_at = ? WHERE id = ?",
                Timestamp.valueOf(LocalDateTime.now().minusMinutes(1)), runId);

        JsonNode recoveredAgain = claim(runId, "fake-worker-3");
        assertThat(recoveredAgain.path("checkpoint")).isEqualTo(resumed.path("checkpoint"));
        assertThat(recoveredAgain.path("fencing_token").asLong())
                .isGreaterThan(resumed.path("fencing_token").asLong());
    }

    @Test
    void corruptCheckpointRemainsQuarantinedWhenQueueBecomesEmpty() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("quarantine-only-run");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "quarantine-only-key", "生成一张蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        postCommit(runId, validCommitBody(project.getId(), work))
                .andExpect(status().isOk());
        jdbcTemplate.update("UPDATE agent_runs SET status = 'queued' WHERE id = ?", runId);
        jdbcTemplate.update("UPDATE runtime_checkpoints SET payload_digest = 'corrupt' WHERE agent_run_id = ?",
                runId);

        mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", "fake-worker-2")
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isNotFound());

        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM agent_runs WHERE id = ?", String.class, runId))
                .isEqualTo("recovery_failed");
        assertThat(count("project_events", "project_id", project.getId())).isEqualTo(7);
        assertThat(count("outbox_messages", "project_id", project.getId())).isEqualTo(7);
    }

    @Test
    void generationInboxIsHiddenFromProjectList() throws Exception {
        // 生成收件箱（purpose=generation_inbox）不出现在 GET /api/projects（IK21O9 ac）
        Project canvas = new Project().setOwnerId(10L).setName("canvas-project");
        projectMapper.insert(canvas);
        Project inbox = new Project().setOwnerId(10L).setName("生成收件箱")
                .setPurpose(Project.PURPOSE_GENERATION_INBOX);
        projectMapper.insert(inbox);

        mockMvc.perform(get("/api/projects").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(canvas.getId()))
                .andExpect(jsonPath("$.data[0].purpose").value("canvas"));
    }

    @Test
    void messageWithoutConversationIdLandsInLatestConversation() throws Exception {
        // 生成收件箱允许多段对话：不传 conversation_id 时落到最新一条（IK21O9）
        Project project = new Project().setOwnerId(10L).setName("multi-conversation-latest");
        projectMapper.insert(project);
        jdbcTemplate.update("INSERT INTO conversations (project_id) VALUES (?)", project.getId());
        jdbcTemplate.update("INSERT INTO conversations (project_id) VALUES (?)", project.getId());
        Long latestConversationId = jdbcTemplate.queryForObject(
                "SELECT MAX(id) FROM conversations WHERE project_id = ?", Long.class, project.getId());

        JsonNode accepted = postMessage(project.getId(), "multi-latest-key", "生成一张蓝鲸海报");

        assertThat(latestConversationId).isNotNull();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT conversation_id FROM conversation_messages WHERE id = ?", Long.class,
                accepted.path("message_id").asLong())).isEqualTo(latestConversationId);
    }

    @Test
    void messageWithConversationIdLandsInSpecifiedConversation() throws Exception {
        // 显式传 conversation_id 时落到指定对话，而不是最新一条（IK21O9）
        Project project = new Project().setOwnerId(10L).setName("multi-conversation-specified");
        projectMapper.insert(project);
        jdbcTemplate.update("INSERT INTO conversations (project_id) VALUES (?)", project.getId());
        Long firstConversationId = jdbcTemplate.queryForObject(
                "SELECT MIN(id) FROM conversations WHERE project_id = ?", Long.class, project.getId());
        jdbcTemplate.update("INSERT INTO conversations (project_id) VALUES (?)", project.getId());

        MvcResult result = mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "multi-specified-key")
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"client-multi-specified\","
                                + "\"content\":\"生成一张蓝鲸海报\","
                                + "\"conversation_id\":" + firstConversationId + "}"))
                .andExpect(status().isAccepted())
                .andReturn();
        JsonNode accepted = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");

        assertThat(jdbcTemplate.queryForObject(
                "SELECT conversation_id FROM conversation_messages WHERE id = ?", Long.class,
                accepted.path("message_id").asLong())).isEqualTo(firstConversationId);
    }

    @Test
    void messageWithConversationIdOfOtherProjectIsRejected() throws Exception {
        // conversation_id 不属于本 project 时按资源不存在拒绝，不产生任何事实（IK21O9）
        Project project = new Project().setOwnerId(10L).setName("multi-conversation-owner");
        projectMapper.insert(project);
        Project other = new Project().setOwnerId(10L).setName("multi-conversation-other");
        projectMapper.insert(other);
        jdbcTemplate.update("INSERT INTO conversations (project_id) VALUES (?)", other.getId());
        Long otherConversationId = jdbcTemplate.queryForObject(
                "SELECT MIN(id) FROM conversations WHERE project_id = ?", Long.class, other.getId());

        mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "multi-foreign-key")
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"client-multi-foreign\","
                                + "\"content\":\"生成一张蓝鲸海报\","
                                + "\"conversation_id\":" + otherConversationId + "}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100301));

        assertThat(count("conversation_messages", "project_id", project.getId())).isZero();
        assertThat(count("agent_runs", "project_id", project.getId())).isZero();
    }

    @Test
    void claimDeliversCompactInitialContextWithBoundedMessageWindow() throws Exception {
        // IK2QC8：claim 下发紧凑三段（契约 §6.1）——Conversation 摘要 + 画布媒体节点 + 有界最近窗口，
        // 不再整段全量消息。其余历史由 read_conversation_history 按需读取。
        Project project = new Project().setOwnerId(10L).setName("compact-initial-context");
        projectMapper.insert(project);
        Asset canvasAsset = referenceAsset(project.getId(), "reference/canvas.png");
        long assetId = canvasAsset.getId();
        // 画布挂一个携带 assetId 的媒体节点；无 assetId 的纯文本节点不在 claim 下发。
        jdbcTemplate.update(
                "INSERT INTO canvas (project_id, nodes_json) VALUES (?,?)",
                project.getId(),
                "[{\"id\":\"node-1\",\"type\":\"image\",\"data\":{\"assetId\":" + assetId + "}},"
                        + "{\"id\":\"node-2\",\"type\":\"text\",\"data\":{}}]");
        // 发 1 条消息建 run + conversation（sequenceNo=1, role=user, content=「msg-1」）
        JsonNode accepted = postMessage(project.getId(), "compact-context-key", "msg-1");
        long runId = accepted.path("agent_run_id").asLong();
        long conversationId = jdbcTemplate.queryForObject(
                "SELECT conversation_id FROM conversation_messages WHERE id = ?", Long.class,
                accepted.path("message_id").asLong());
        // 向同一 conversation 追加 9 条消息（sequenceNo 2..10，user/assistant 混角）→ 共 10 条
        for (int i = 2; i <= 10; i++) {
            jdbcTemplate.update(
                    "INSERT INTO conversation_messages (conversation_id, project_id, role, content, sequence_no) "
                            + "VALUES (?,?,?,?,?)",
                    conversationId, project.getId(),
                    i % 2 == 0 ? "assistant" : "user", "msg-" + i, i);
        }

        JsonNode work = claim(runId);

        // messages 为有界最近窗口（末尾 6 条，时间升序），非全量 10 条
        JsonNode messages = work.path("messages");
        assertThat(messages.isArray()).isTrue();
        assertThat(messages.size()).isEqualTo(6);
        assertThat(messages.get(0).path("content").asText()).isEqualTo("msg-5");
        assertThat(messages.get(5).path("content").asText()).isEqualTo("msg-10");
        // conversation_summary.message_count 为全量消息数 10（窗口有界但摘要统计全量）
        assertThat(work.path("conversation_summary").path("message_count").asInt()).isEqualTo(10);
        // canvas_nodes 仅含携带 assetId 的媒体节点（node-1）；纯文本 node-2 不在
        JsonNode canvasNodes = work.path("canvas_nodes");
        assertThat(canvasNodes.isArray()).isTrue();
        assertThat(canvasNodes.size()).isEqualTo(1);
        assertThat(canvasNodes.get(0).path("node_id").asText()).isEqualTo("node-1");
        assertThat(canvasNodes.get(0).path("type").asText()).isEqualTo("image");
        assertThat(canvasNodes.get(0).path("asset_id").asLong()).isEqualTo(assetId);
    }

    @Test
    void referencedAssetIdsArePersistedWithOrderedMentionSeq() throws Exception {
        // IK39QX：@ 引用随消息同事务持久化到 message_asset_reference，mention_seq 按请求列表保序（1-based），
        // conversation_id / project_id 冗余存储便于读路径白名单反查。
        Project project = new Project().setOwnerId(10L).setName("message-asset-reference");
        projectMapper.insert(project);
        Asset first = referenceAsset(project.getId(), "reference/first.png");
        Asset second = referenceAsset(project.getId(), "reference/second.png");

        JsonNode accepted = postMessageWithReferences(project.getId(), "reference-persist-key",
                "参考素材生成海报", "[" + first.getId() + "," + second.getId() + "]");

        long messageId = accepted.path("message_id").asLong();
        long conversationId = jdbcTemplate.queryForObject(
                "SELECT conversation_id FROM conversation_messages WHERE id = ?", Long.class, messageId);
        assertThat(count("message_asset_reference", "message_id", messageId)).isEqualTo(2);
        assertThat(jdbcTemplate.queryForList(
                "SELECT asset_id FROM message_asset_reference WHERE message_id = ? ORDER BY mention_seq",
                Long.class, messageId)).containsExactly(first.getId(), second.getId());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT conversation_id FROM message_asset_reference WHERE message_id = ? AND asset_id = ?",
                Long.class, messageId, first.getId())).isEqualTo(conversationId);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT project_id FROM message_asset_reference WHERE message_id = ? AND asset_id = ?",
                Long.class, messageId, first.getId())).isEqualTo(project.getId());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT mention_seq FROM message_asset_reference WHERE message_id = ? AND asset_id = ?",
                Long.class, messageId, first.getId())).isEqualTo(1);
    }

    @Test
    void referencedAssetIdsOutsideOwnedProjectAreSilentlyDropped() throws Exception {
        // IK39QX：越权/失效引用 id 静默过滤（warn 不硬断言），只落归属本 project+user 的子集。
        Project project = new Project().setOwnerId(10L).setName("owned-reference-project");
        projectMapper.insert(project);
        Project other = new Project().setOwnerId(11L).setName("foreign-reference-project");
        projectMapper.insert(other);
        Asset foreign = new Asset()
                .setProjectId(other.getId())
                .setUserId(11L)
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey("reference/foreign.png")
                .setMime("image/png")
                .setSize(128L)
                .setSource(Asset.SOURCE_UPLOADED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(foreign);
        Asset owned = referenceAsset(project.getId(), "reference/owned.png");

        JsonNode accepted = postMessageWithReferences(project.getId(), "reference-filter-key",
                "参考素材生成海报", "[" + owned.getId() + "," + foreign.getId() + "]");

        long messageId = accepted.path("message_id").asLong();
        assertThat(count("message_asset_reference", "message_id", messageId)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT asset_id FROM message_asset_reference WHERE message_id = ?", Long.class, messageId))
                .isEqualTo(owned.getId());
    }

    @Test
    void idempotencyConflictWhenReferencedAssetIdsDrift() throws Exception {
        // IK39QX：requestHash 纳入去重后引用列表；同 key 仅引用列表不同 → 100302 冲突，不追加引用行。
        Project project = new Project().setOwnerId(10L).setName("reference-idempotency");
        projectMapper.insert(project);
        Asset first = referenceAsset(project.getId(), "reference/idem-first.png");
        Asset second = referenceAsset(project.getId(), "reference/idem-second.png");

        postMessageWithReferences(project.getId(), "reference-idem-key",
                "参考素材生成海报", "[" + first.getId() + "]");
        // 仅 referenced_asset_ids 由 [first] 漂移到 [first,second]，其余字段不变 → 证明引用列表纳入幂等键。
        mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "reference-idem-key")
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"client-reference-idem-key\","
                                + "\"content\":\"参考素材生成海报\","
                                + "\"referenced_asset_ids\":[" + first.getId() + "," + second.getId() + "]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100302));

        assertThat(count("message_asset_reference", "project_id", project.getId())).isEqualTo(1);
    }

    private JsonNode postMessage(Long projectId, String idempotencyKey, String content) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/projects/{id}/conversation/messages", projectId)
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"client-" + idempotencyKey
                                + "\",\"content\":\"" + content + "\"}"))
                .andExpect(status().isAccepted())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private JsonNode postMessageWithReferences(Long projectId, String idempotencyKey, String content,
                                               String referencedAssetIdsJson) throws Exception {
        String body = "{\"client_message_id\":\"client-" + idempotencyKey
                + "\",\"content\":\"" + content + "\""
                + (referencedAssetIdsJson == null ? "" : ",\"referenced_asset_ids\":" + referencedAssetIdsJson)
                + "}";
        MvcResult result = mockMvc.perform(post("/api/projects/{id}/conversation/messages", projectId)
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isAccepted())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private JsonNode claim(long expectedRunId) throws Exception {
        return claim(expectedRunId, "fake-worker-1");
    }

    private JsonNode claim(long expectedRunId, String workerId) throws Exception {
        MvcResult result = mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", workerId)
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.agent_run_id").value(expectedRunId))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private String validCommitBody(Long projectId, JsonNode work) {
        return "{" +
                "\"commit_id\":\"commit-1\"," +
                "\"project_id\":" + projectId + "," +
                "\"user_id\":10," +
                "\"expected_run_version\":" + work.path("run_version").asInt() + "," +
                "\"fencing_token\":" + work.path("fencing_token").asLong() + "," +
                "\"engine\":\"fake\"," +
                "\"engine_version\":\"1\"," +
                "\"adapter_schema_version\":1," +
                "\"visible_text\":\"已接纳，正在生成图片。\"," +
                "\"checkpoint\":{\"opaque_payload\":{\"step\":\"proposed\"}}," +
                "\"actions\":[{\"action_id\":\"action-1\",\"tool_id\":\"create_image_generation_job\",\"registry_version\":1," +
                "\"arguments\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}}]}";
    }

    private String videoCommitBody(Long projectId, JsonNode work) {
        return "{"
                + "\"commit_id\":\"commit-video\","
                + "\"project_id\":" + projectId + ","
                + "\"user_id\":10,"
                + "\"expected_run_version\":" + work.path("run_version").asInt() + ","
                + "\"fencing_token\":" + work.path("fencing_token").asLong() + ","
                + "\"engine\":\"fake\","
                + "\"engine_version\":\"1\","
                + "\"adapter_schema_version\":1,"
                + "\"visible_text\":\"已接纳，正在生成视频。\","
                + "\"checkpoint\":{\"opaque_payload\":{\"step\":\"proposed\"}},"
                + "\"actions\":[{\"action_id\":\"action-video\",\"tool_id\":\"create_video_generation_job\","
                + "\"registry_version\":1,"
                + "\"arguments\":{\"prompt\":\"蓝鲸视频\",\"aspect_ratio\":\"16:9\","
                + "\"resolution\":\"720p\",\"duration\":5}}]}";
    }

    private void assertNoCommitFacts(Long projectId, long runId) {
        assertThat(count("runtime_checkpoints", "agent_run_id", runId)).isZero();
        assertThat(count("run_commits", "agent_run_id", runId)).isZero();
        assertThat(count("conversation_messages", "project_id", projectId)).isEqualTo(1);
        assertThat(count("generation_jobs", "agent_run_id", runId)).isZero();
        assertThat(count("project_events", "project_id", projectId)).isEqualTo(3);
        assertThat(count("outbox_messages", "project_id", projectId)).isEqualTo(3);
    }

    private org.springframework.test.web.servlet.ResultActions postCommit(long runId, String body) throws Exception {
        return postCommit(runId, body, "fake-worker-1");
    }

    private org.springframework.test.web.servlet.ResultActions postCommit(
            long runId, String body, String workerId) throws Exception {
        return mockMvc.perform(post("/internal/agent-runs/{id}/commits", runId)
                .header("X-Worker-Id", workerId)
                .contentType("application/json")
                .content(body));
    }

    private long count(String table, String column, Long value) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return result == null ? 0L : result;
    }
}
