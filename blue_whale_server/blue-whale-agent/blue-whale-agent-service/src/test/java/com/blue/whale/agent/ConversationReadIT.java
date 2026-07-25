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
 * Conversation 渐进读取端到端 IT（IK2QBZ）。
 *
 * 覆盖 Java 内部端点：游标分页正确性（sequence_no 单调推进 + nextCursor + hasMore）、
 * 摘要聚合、紧凑度（snake_case 字段名）、租约鉴权（X-Worker-Id 匹配 leaseOwner）与
 * 跨租约 / 未认证拒绝。Project 范围由 run 绑定 conversation 天然闭环，跨 Project 不可能。
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
class ConversationReadIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void cleanConversationReadFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM message_asset_reference",
                "DELETE FROM conversation_messages",
                "DELETE FROM agent_runs",
                "DELETE FROM conversations",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void historyReturnsFirstPageWithNextCursor() throws Exception {
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedMessages(conversationId, project.getId(), 3);
        // after 缺省、limit=2 → items seq1,2；hasMore=true；nextCursor=2
        mockMvc.perform(get("/internal/agent-runs/{runId}/conversation/history", runId)
                        .header("X-Worker-Id", "worker-1").param("limit", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.conversation_id").value(conversationId.intValue()))
                .andExpect(jsonPath("$.data.items.length()").value(2))
                .andExpect(jsonPath("$.data.items[0].sequence_no").value(1))
                .andExpect(jsonPath("$.data.items[1].sequence_no").value(2))
                .andExpect(jsonPath("$.data.items[0].role").value("user"))
                .andExpect(jsonPath("$.data.has_more").value(true))
                .andExpect(jsonPath("$.data.next_cursor").value(2));
    }

    @Test
    void historyPaginatesBySequenceCursor() throws Exception {
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedMessages(conversationId, project.getId(), 3);
        // after=1、limit=2 → items seq2,3；hasMore=false；nextCursor 不返回
        mockMvc.perform(get("/internal/agent-runs/{runId}/conversation/history", runId)
                        .header("X-Worker-Id", "worker-1").param("after", "1").param("limit", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items.length()").value(2))
                .andExpect(jsonPath("$.data.items[0].sequence_no").value(2))
                .andExpect(jsonPath("$.data.items[1].sequence_no").value(3))
                .andExpect(jsonPath("$.data.has_more").value(false))
                .andExpect(jsonPath("$.data.next_cursor").doesNotExist());
    }

    @Test
    void summaryAggregatesCountAndPreviews() throws Exception {
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedMessage(conversationId, project.getId(), "user", "请帮我画一只蓝鲸在深海里游", 1);
        seedMessage(conversationId, project.getId(), "assistant", "好的，正在生成蓝鲸深海图。", 2);
        mockMvc.perform(get("/internal/agent-runs/{runId}/conversation/summary", runId)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.conversation_id").value(conversationId.intValue()))
                .andExpect(jsonPath("$.data.message_count").value(2))
                .andExpect(jsonPath("$.data.first_user_preview").value("请帮我画一只蓝鲸在深海里游"))
                .andExpect(jsonPath("$.data.last_message_preview").value("好的，正在生成蓝鲸深海图。"))
                .andExpect(jsonPath("$.data.earliest_at").isString())
                .andExpect(jsonPath("$.data.latest_at").isString());
    }

    @Test
    void historyReturnsReferencedAssetIdsOrderedByMentionSeq() throws Exception {
        // 一条消息 @ 两张素材，按 mention_seq 升序回传 referenced_asset_ids
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        Long messageId = seedMessageReturningId(conversationId, project.getId(), "user", "看这两张", 1);
        seedReference(messageId, conversationId, project.getId(), 11L, 1);
        seedReference(messageId, conversationId, project.getId(), 22L, 2);
        mockMvc.perform(get("/internal/agent-runs/{runId}/conversation/history", runId)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].referenced_asset_ids[0]").value(11))
                .andExpect(jsonPath("$.data.items[0].referenced_asset_ids[1]").value(22));
    }

    @Test
    void historyReturnsEmptyReferencedAssetIdsWhenNoReferences() throws Exception {
        // 无引用消息回传空数组 []（非 null），Python Worker 不靠名称猜
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedMessage(conversationId, project.getId(), "user", "纯文本无引用", 1);
        mockMvc.perform(get("/internal/agent-runs/{runId}/conversation/history", runId)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].referenced_asset_ids").isArray())
                .andExpect(jsonPath("$.data.items[0].referenced_asset_ids").isEmpty());
    }

    @Test
    void historyRejectsForeignWorkerLease() throws Exception {
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedMessages(conversationId, project.getId(), 1);
        // run 租约归属 worker-1，worker-2 读取 → 100303
        mockMvc.perform(get("/internal/agent-runs/{runId}/conversation/history", runId)
                        .header("X-Worker-Id", "worker-2"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value(100303));
    }

    @Test
    void historyRejectsMissingWorker() throws Exception {
        Project project = newProject(10L);
        Long conversationId = seedConversation(project.getId());
        Long runId = seedLeasedRun(project.getId(), conversationId, 10L, "worker-1");
        seedMessages(conversationId, project.getId(), 1);
        mockMvc.perform(get("/internal/agent-runs/{runId}/conversation/history", runId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(401));
    }

    @Test
    void historyRejectsCrossProjectRun() throws Exception {
        // 跨 Project 由租约校验吸收：端点以 runId 为根，run 唯一绑定 conversation/project，
        // Worker 只能读自己租约的 run。worker-1 读 projectB 的 run（租约属 worker-2）→ 100303。
        Project projectA = newProject(10L);
        Project projectB = new Project().setOwnerId(11L).setName("conv-read-other-owner");
        projectMapper.insert(projectB);
        Long conversationA = seedConversation(projectA.getId());
        Long conversationB = seedConversation(projectB.getId());
        Long runA = seedLeasedRun(projectA.getId(), conversationA, 10L, "worker-1");
        Long runB = seedLeasedRun(projectB.getId(), conversationB, 11L, "worker-2");
        seedMessages(conversationA, projectA.getId(), 1);
        seedMessages(conversationB, projectB.getId(), 1);
        // worker-1 读 projectB 的 run → 租约不匹配拒绝
        mockMvc.perform(get("/internal/agent-runs/{runId}/conversation/history", runB)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value(100303));
        // worker-1 读自己 projectA 的 run → 正常返回
        mockMvc.perform(get("/internal/agent-runs/{runId}/conversation/history", runA)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_id").value(conversationA.intValue()));
    }

    private Project newProject(long ownerId) {
        Project project = new Project().setOwnerId(ownerId).setName("conv-read-" + ownerId);
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

    private void seedMessages(Long conversationId, Long projectId, int count) {
        for (int seq = 1; seq <= count; seq++) {
            String role = (seq % 2 == 1) ? "user" : "assistant";
            seedMessage(conversationId, projectId, role, "msg-" + seq, seq);
        }
    }

    private void seedMessage(Long conversationId, Long projectId, String role, String content, int sequenceNo) {
        jdbcTemplate.update(
                "INSERT INTO conversation_messages (conversation_id, project_id, role, content, sequence_no) "
                        + "VALUES (?,?,?,?,?)",
                conversationId, projectId, role, content, sequenceNo);
    }

    private Long seedMessageReturningId(Long conversationId, Long projectId, String role, String content, int sequenceNo) {
        seedMessage(conversationId, projectId, role, content, sequenceNo);
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
