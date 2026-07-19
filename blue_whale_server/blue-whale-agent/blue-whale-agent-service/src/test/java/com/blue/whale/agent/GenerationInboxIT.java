package com.blue.whale.agent;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.AssetStorageObjectMapper;
import com.blue.whale.agent.mapper.ConversationMapper;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.AssetStorageObject;
import com.blue.whale.agent.model.entity.ConversationMessage;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 生成收件箱集成测试（IK21O9）：懒建、消息接纳与幂等、多对话、永久删除、共享存储对象与越权。
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
class GenerationInboxIT {

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
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void cleanInboxFacts() {
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
    void getInboxWithoutInboxReturnsNullDataAndCreatesNothing() throws Exception {
        // ac-a：无收件箱时 GET 返回 data=null，且只读不创建 project
        mockMvc.perform(get("/api/generation-inbox").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data").value(nullValue()));

        assertThat(count("project", "owner_id", 10L)).isZero();
    }

    @Test
    void firstMessageCreatesInboxAndSecondMessageReusesLatestConversation() throws Exception {
        // ac-b：首发消息懒建收件箱，二次发消息复用同一收件箱与最新对话
        JsonNode first = postInboxMessage("first-key",
                "{\"client_message_id\":\"client-first\",\"content\":\"生成一张蓝鲸海报\"}");
        long inboxId = first.path("project_id").asLong();
        long conversationId = first.path("conversation_id").asLong();
        assertThat(first.path("message_id").isNumber()).isTrue();
        assertThat(first.path("agent_run_id").isNumber()).isTrue();
        assertThat(first.path("accepted_cursor").isNumber()).isTrue();

        Project inbox = projectMapper.selectById(inboxId);
        assertThat(inbox).isNotNull();
        assertThat(inbox.getOwnerId()).isEqualTo(10L);
        assertThat(inbox.getPurpose()).isEqualTo(Project.PURPOSE_GENERATION_INBOX);
        assertThat(inbox.getName()).isEqualTo("生成收件箱");
        ConversationMessage message = messageMapper.selectById(first.path("message_id").asLong());
        assertThat(message.getRole()).isEqualTo(ConversationMessage.ROLE_USER);
        assertThat(message.getContent()).isEqualTo("生成一张蓝鲸海报");

        JsonNode second = postInboxMessage("second-key",
                "{\"client_message_id\":\"client-second\",\"content\":\"再生成一张白鲸\"}");
        assertThat(second.path("project_id").asLong()).isEqualTo(inboxId);
        assertThat(second.path("conversation_id").asLong()).isEqualTo(conversationId);
        assertThat(count("project", "owner_id", 10L)).isEqualTo(1);
        assertThat(count("conversation_messages", "project_id", inboxId)).isEqualTo(2);

        mockMvc.perform(get("/api/generation-inbox").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.project.id").value(inboxId))
                .andExpect(jsonPath("$.data.project.purpose").value("generation_inbox"))
                .andExpect(jsonPath("$.data.active_conversation_id").value(conversationId));
    }

    @Test
    void idempotentReplayReturnsSameMessageWithoutDuplicatingInbox() throws Exception {
        // ac-c：同 Idempotency-Key 重放返回首次接纳结果，不重复建收件箱/消息
        String body = "{\"client_message_id\":\"client-replay\",\"content\":\"生成一张蓝鲸海报\"}";
        JsonNode first = postInboxMessage("replay-key", body);
        JsonNode replayed = postInboxMessage("replay-key", body);

        assertThat(replayed).isEqualTo(first);
        long inboxId = first.path("project_id").asLong();
        assertThat(count("project", "owner_id", 10L)).isEqualTo(1);
        assertThat(count("conversation_messages", "project_id", inboxId)).isEqualTo(1);
        assertThat(count("agent_runs", "project_id", inboxId)).isEqualTo(1);
    }

    @Test
    void renamedInboxStillResolvesByPurpose() throws Exception {
        // ac-e：收件箱改名后仍按 purpose 解析到同一收件箱（定位不依赖名称）
        JsonNode first = postInboxMessage("rename-key",
                "{\"client_message_id\":\"client-rename\",\"content\":\"生成一张蓝鲸海报\"}");
        long inboxId = first.path("project_id").asLong();

        mockMvc.perform(put("/api/projects/{id}", inboxId)
                        .header("X-User-Id", "10")
                        .contentType("application/json")
                        .content("{\"name\":\"我的收件箱\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/generation-inbox").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.project.id").value(inboxId))
                .andExpect(jsonPath("$.data.project.name").value("我的收件箱"));
    }

    @Test
    void multipleConversationsResolveByIdAndPreviewFirstUserMessage() throws Exception {
        // ac-f：多对话——新建对话后带 conversation_id 落点；列表 id 倒序、preview 截断、active 为最新
        String longContent = "这是一段用于验证预览截断的长消息，需要超过五十个字符才会被截断，因此继续补充更多内容，直到长度足够为止。";
        assertThat(longContent.length()).isGreaterThan(50);
        JsonNode first = postInboxMessage("multi-key-1",
                "{\"client_message_id\":\"client-multi-1\",\"content\":\"" + longContent + "\"}");
        long firstConversationId = first.path("conversation_id").asLong();

        MvcResult created = mockMvc.perform(post("/api/generation-inbox/conversations")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "multi-create-conversation"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").isNumber())
                .andExpect(jsonPath("$.data.preview").value(""))
                .andReturn();
        long secondConversationId = objectMapper.readTree(created.getResponse().getContentAsString())
                .path("data").path("id").asLong();

        JsonNode second = postInboxMessage("multi-key-2",
                "{\"client_message_id\":\"client-multi-2\",\"content\":\"画一只小猫\","
                        + "\"conversation_id\":" + secondConversationId + "}");
        assertThat(second.path("conversation_id").asLong()).isEqualTo(secondConversationId);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT conversation_id FROM conversation_messages WHERE id = ?", Long.class,
                second.path("message_id").asLong())).isEqualTo(secondConversationId);

        mockMvc.perform(get("/api/generation-inbox/conversations").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].id").value(secondConversationId))
                .andExpect(jsonPath("$.data[0].preview").value("画一只小猫"))
                .andExpect(jsonPath("$.data[1].id").value(firstConversationId))
                .andExpect(jsonPath("$.data[1].preview").value(longContent.substring(0, 50)));

        mockMvc.perform(get("/api/generation-inbox").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.active_conversation_id").value(secondConversationId));
        assertThat(count("conversations", "project_id", first.path("project_id").asLong())).isEqualTo(2);
    }

    @Test
    void purgePermanentlyDeletesInboxFactsButKeepsAuditEvents() throws Exception {
        // ac-g：永久删除——对话/消息/agent_run/生成任务族/asset 物理消失，审计事件保留，重建得全新收件箱
        JsonNode first = postInboxMessage("purge-key",
                "{\"client_message_id\":\"client-purge\",\"content\":\"生成一张蓝鲸海报\"}");
        long inboxId = first.path("project_id").asLong();
        long conversationId = first.path("conversation_id").asLong();
        long messageId = first.path("message_id").asLong();
        long runId = first.path("agent_run_id").asLong();

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
                inboxId, conversationId, runId);
        jdbcTemplate.update("INSERT INTO generation_jobs (project_id, user_id, agent_run_id, type, source, status) "
                + "VALUES (?, 10, ?, 'image', 'agent_run', 'queued')", inboxId, runId);
        Long jobId = jdbcTemplate.queryForObject(
                "SELECT id FROM generation_jobs WHERE project_id = ?", Long.class, inboxId);
        jdbcTemplate.update("INSERT INTO generation_job_outputs (generation_job_id, slot_index, status) "
                + "VALUES (?, 0, 'pending')", jobId);
        jdbcTemplate.update("INSERT INTO generation_provider_tasks "
                + "(generation_job_id, slot_index, provider, account_id, submission_state, "
                + "callback_capability_digest) VALUES (?, 0, 'volcengine', 'acct', 'pending', 'digest')", jobId);
        jdbcTemplate.update("INSERT INTO generation_result_conflicts "
                + "(generation_job_id, slot_index, attempted_delivery_id, expected_content_sha256, "
                + "actual_content_sha256, reason) VALUES (?, 0, 'delivery-1', 'a', 'b', 'mismatch')", jobId);
        Asset asset = new Asset()
                .setProjectId(inboxId)
                .setUserId(10L)
                .setGenerationJobId(jobId)
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey("inbox/purge.png")
                .setMime("image/png")
                .setSize(128L)
                .setSource(Asset.SOURCE_GENERATED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(asset);

        mockMvc.perform(delete("/api/generation-inbox").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200));

        assertThat(messageMapper.selectById(messageId)).isNull();
        assertThat(conversationMapper.selectById(conversationId)).isNull();
        assertThat(agentRunMapper.selectById(runId)).isNull();
        assertThat(generationJobMapper.selectById(jobId)).isNull();
        assertThat(assetMapper.selectById(asset.getId())).isNull();
        assertThat(projectMapper.selectById(inboxId)).isNull();
        assertThat(count("runtime_checkpoints", "agent_run_id", runId)).isZero();
        assertThat(count("run_commits", "agent_run_id", runId)).isZero();
        assertThat(count("user_input_requests", "project_id", inboxId)).isZero();
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isZero();
        assertThat(count("generation_provider_tasks", "generation_job_id", jobId)).isZero();
        assertThat(count("generation_result_conflicts", "generation_job_id", jobId)).isZero();
        assertThat(count("project_events", "project_id", inboxId)).isGreaterThan(0);
        assertThat(count("outbox_messages", "project_id", inboxId)).isGreaterThan(0);

        mockMvc.perform(get("/api/generation-inbox").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(nullValue()));
        JsonNode recreated = postInboxMessage("purge-recreate-key",
                "{\"client_message_id\":\"client-purge-recreate\",\"content\":\"重新开始\"}");
        assertThat(recreated.path("project_id").asLong()).isNotEqualTo(inboxId);
    }

    @Test
    void purgeMarksStorageObjectUnreferencedOnlyWhenNoOtherProjectReferencesIt() throws Exception {
        // ac-h：共享 storage_key 的存储对象在其他项目副本仍引用时不标记；无其他引用才进入待回收
        JsonNode first = postInboxMessage("gc-key",
                "{\"client_message_id\":\"client-gc\",\"content\":\"生成一张蓝鲸海报\"}");
        long inboxId = first.path("project_id").asLong();

        insertStorageObject("inbox/shared.png");
        insertStorageObject("inbox/solo.png");
        insertAsset(inboxId, "inbox/shared.png");
        insertAsset(inboxId, "inbox/solo.png");
        Project other = new Project().setOwnerId(10L).setName("other-canvas");
        projectMapper.insert(other);
        insertAsset(other.getId(), "inbox/shared.png");

        mockMvc.perform(delete("/api/generation-inbox").header("X-User-Id", "10"))
                .andExpect(status().isOk());

        assertThat(storageObjectMapper.selectOne(Wrappers.<AssetStorageObject>lambdaQuery()
                .eq(AssetStorageObject::getStorageKey, "inbox/shared.png"))
                .getFirstUnreferencedAt()).isNull();
        assertThat(storageObjectMapper.selectOne(Wrappers.<AssetStorageObject>lambdaQuery()
                .eq(AssetStorageObject::getStorageKey, "inbox/solo.png"))
                .getFirstUnreferencedAt()).isNotNull();
    }

    @Test
    void messageToOtherUsersInboxConversationIsRejected() throws Exception {
        // ac-i：越权——用户 B 指向用户 A 收件箱对话发消息按资源不存在拒绝，副作用整体回滚
        JsonNode first = postInboxMessage("owner-key",
                "{\"client_message_id\":\"client-owner\",\"content\":\"生成一张蓝鲸海报\"}");
        long inboxId = first.path("project_id").asLong();
        long conversationId = first.path("conversation_id").asLong();

        mockMvc.perform(post("/api/generation-inbox/messages")
                        .header("X-User-Id", "11")
                        .header("Idempotency-Key", "foreign-key")
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"client-foreign\",\"content\":\"越权发消息\","
                                + "\"conversation_id\":" + conversationId + "}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100301));

        assertThat(count("project", "owner_id", 11L)).isZero();
        assertThat(count("conversation_messages", "project_id", inboxId)).isEqualTo(1);
    }

    @Test
    void deleteInboxViaGenericProjectEndpointIsRejected() throws Exception {
        // 评审修复1：通用逻辑删端点对收件箱按资源不存在拒绝，收件箱保持完好
        JsonNode first = postInboxMessage("delete-guard-key",
                "{\"client_message_id\":\"client-delete-guard\",\"content\":\"生成一张蓝鲸海报\"}");
        long inboxId = first.path("project_id").asLong();

        mockMvc.perform(delete("/api/projects/{id}", inboxId).header("X-User-Id", "10"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100301));

        Project inbox = projectMapper.selectById(inboxId);
        assertThat(inbox).isNotNull();
        assertThat(inbox.getPurpose()).isEqualTo(Project.PURPOSE_GENERATION_INBOX);
        mockMvc.perform(get("/api/generation-inbox").header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.project.id").value(inboxId));
    }

    @Test
    void createConversationRequiresIdempotencyKey() throws Exception {
        // 评审修复2b：缺 Idempotency-Key → 400（ADR-0016 §1）
        postInboxMessage("create-conversation-setup",
                "{\"client_message_id\":\"client-setup\",\"content\":\"生成一张蓝鲸海报\"}");

        mockMvc.perform(post("/api/generation-inbox/conversations").header("X-User-Id", "10"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(100000));
    }

    @Test
    void createConversationIdempotentReplayReturnsSameConversation() throws Exception {
        // 评审修复2b：同键重放返回同一对话且只多一行；不同键各建一条（ADR-0017 §4）
        JsonNode first = postInboxMessage("replay-conversation-setup",
                "{\"client_message_id\":\"client-replay-setup\",\"content\":\"生成一张蓝鲸海报\"}");
        long inboxId = first.path("project_id").asLong();
        long baseline = count("conversations", "project_id", inboxId);

        MvcResult created = mockMvc.perform(post("/api/generation-inbox/conversations")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "create-conversation-key"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").isNumber())
                .andExpect(jsonPath("$.data.preview").value(""))
                .andReturn();
        long conversationId = objectMapper.readTree(created.getResponse().getContentAsString())
                .path("data").path("id").asLong();

        mockMvc.perform(post("/api/generation-inbox/conversations")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "create-conversation-key"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(conversationId));
        assertThat(count("conversations", "project_id", inboxId)).isEqualTo(baseline + 1);

        MvcResult other = mockMvc.perform(post("/api/generation-inbox/conversations")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "create-conversation-other"))
                .andExpect(status().isOk())
                .andReturn();
        long otherId = objectMapper.readTree(other.getResponse().getContentAsString())
                .path("data").path("id").asLong();
        assertThat(otherId).isNotEqualTo(conversationId);
        assertThat(count("conversations", "project_id", inboxId)).isEqualTo(baseline + 2);
    }

    private JsonNode postInboxMessage(String idempotencyKey, String content) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/generation-inbox/messages")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType("application/json")
                        .content(content))
                .andExpect(status().isAccepted())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private void insertStorageObject(String storageKey) {
        storageObjectMapper.insert(new AssetStorageObject()
                .setStorageKey(storageKey)
                .setSource(Asset.SOURCE_UPLOADED)
                .setState(AssetStorageObject.STATE_AVAILABLE)
                .setActiveTransferCount(0));
    }

    private void insertAsset(Long projectId, String storageKey) {
        assetMapper.insert(new Asset()
                .setProjectId(projectId)
                .setUserId(10L)
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey(storageKey)
                .setMime("image/png")
                .setSize(128L)
                .setSource(Asset.SOURCE_UPLOADED)
                .setStatus(Asset.STATUS_NORMAL));
    }

    private long count(String table, String column, Long value) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return result == null ? 0L : result;
    }
}
