package com.blue.whale.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.blue.whale.agent.runtimebundle.RuntimeBundleDigests;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * IK3NPF：auto Creative Skill 候选冻结与 Worker→Java 激活端点端到端验收（契约 §3/§4.2/§5/§8）。
 *
 * <p>覆盖：普通消息冻结候选（含 6 字段元数据）+ claim 下发、forced/无关系空候选、resume 继承快照、
 * 候选 fail closed（100307）、成功激活（source=auto + run_version 递增 + digest 来自候选）、
 * 非候选（100309）/已激活（100310）/version 冲突（100303）/租约失效（100303）/同键异载（100302）、
 * 幂等逐字节回放（§4.4）。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.agent-orchestrator.engine=fake",
        "blue-whale.agent-orchestrator.engine-version=1",
        "blue-whale.agent-orchestrator.adapter-schema-version=1",
        "blue-whale.runtime-bundle.admin-user-ids=10",
        "blue-whale.runtime-bundle.enforcement-enabled=true",
        "blue-whale.runtime-bundle.default-agent-definition-id=pin_agent"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AutoCreativeSkillActivationIT {

    private static final String DIGEST =
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static final String CS_ID = "cs_poster_design";
    private static final String CSV_ID = "csv_poster_1_0_0";
    private static final long LEGACY_SKILL_ID = 5001L;
    private static final long PROJECT_ID = 93001L;
    private static final long USER_ID = 10L;
    private static final long USER_ID_2 = 11L;
    private static final long PROJECT_ID_2 = 93002L;
    private static final long LEGACY_SKILL_ID_2 = 5002L;
    private static final String CS_ID_2 = "cs_video_cut";
    private static final String CSV_ID_2 = "csv_video_1_0_0";
    private static final String DIGEST_2 =
            "sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void cleanFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM run_creative_skill_activations",
                "DELETE FROM runtime_bundle_audit_records",
                "DELETE FROM runtime_bundle_write_idempotency",
                "DELETE FROM runtime_bundle_resources",
                "DELETE FROM runtime_bundle_versions",
                "DELETE FROM runtime_bundle_drafts",
                "DELETE FROM runtime_agent_definitions",
                "DELETE FROM user_input_requests",
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM command_idempotency",
                "DELETE FROM conversation_messages",
                "DELETE FROM agent_runs",
                "DELETE FROM conversations",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project",
                "DELETE FROM creative_skill_version",
                "DELETE FROM creative_skill",
                "DELETE FROM user_skill",
                "DELETE FROM skill");
    }

    @Test
    void plainMessageFreezesAutoCandidatesAndClaimDeliversThem() throws Exception {
        autoSkillFixture();
        long run = postMessage("plain-auto", "生成海报");

        JsonNode candidates = objectMapper.readTree(jdbcTemplate.queryForObject(
                "SELECT auto_creative_skill_candidates FROM agent_runs WHERE id = ?", String.class, run));
        assertThat(candidates.isArray()).isTrue();
        assertThat(candidates).hasSize(1);
        JsonNode candidate = candidates.get(0);
        assertThat(candidate.path("creative_skill_id").asText()).isEqualTo(CS_ID);
        assertThat(candidate.path("creative_skill_version_id").asText()).isEqualTo(CSV_ID);
        assertThat(candidate.path("name").asText()).isEqualTo("poster-design");
        assertThat(candidate.path("description").asText()).isEqualTo("海报设计技能");
        assertThat(candidate.path("display_version").asText()).isEqualTo("1.0.0");
        assertThat(candidate.path("resource_digest").asText()).isEqualTo(DIGEST);
        // 候选恰好 6 字段（additionalProperties:false 镜像，禁正文）。
        assertThat(candidate).hasSize(6);

        JsonNode claimed = claim("auto-worker");
        JsonNode delivered = claimed.path("auto_creative_skill_candidates");
        assertThat(delivered.isArray()).isTrue();
        assertThat(delivered).hasSize(1);
        assertThat(delivered.get(0).path("creative_skill_id").asText()).isEqualTo(CS_ID);
    }

    @Test
    void forcedMessageHasEmptyCandidatesAndNoRelationYieldsEmpty() throws Exception {
        pinAgentFixture();
        insertCreativeSkill(CS_ID, "poster-design", CSV_ID);
        insertCreativeSkillVersion(CSV_ID, CS_ID, DIGEST);

        long forcedRun = postForcedMessage("forced-empty", "强制海报", CS_ID);
        assertThat(objectMapper.readTree(jdbcTemplate.queryForObject(
                "SELECT auto_creative_skill_candidates FROM agent_runs WHERE id = ?", String.class, forcedRun)))
                .isEmpty();

        // 无 auto 关系用户普通消息 → 候选空。
        long plainRun = postMessage("plain-no-relation", "普通消息");
        assertThat(objectMapper.readTree(jdbcTemplate.queryForObject(
                "SELECT auto_creative_skill_candidates FROM agent_runs WHERE id = ?", String.class, plainRun)))
                .isEmpty();
    }

    @Test
    void resumeInheritsSourceRunCandidatesSnapshot() throws Exception {
        autoSkillFixture();
        long sourceRun = postMessage("resume-src", "源消息");
        String sourceCandidates = jdbcTemplate.queryForObject(
                "SELECT auto_creative_skill_candidates FROM agent_runs WHERE id = ?", String.class, sourceRun);
        Long conversationId = jdbcTemplate.queryForObject(
                "SELECT conversation_id FROM agent_runs WHERE id = ?", Long.class, sourceRun);

        final long clarification = 77001L;
        jdbcTemplate.update("""
                INSERT INTO user_input_requests
                    (id, project_id, user_id, request_type, conversation_id, source_agent_run_id, question,
                     action_identity, action_type, arguments_digest, status, expires_at)
                    VALUES (?, ?, ?, 'creation_clarification', ?, ?, '用海报还是视频?',
                            'act-1', 'generate_image', 'digest-x', 'pending',
                            DATEADD(SECOND, 3600, CURRENT_TIMESTAMP))
                """, clarification, PROJECT_ID, USER_ID, conversationId, sourceRun);

        long resumedRun = postReplyMessage("resume-dest", "用海报", clarification);

        // resume 继承 sourceRun 候选快照（原样透传，不重算）。
        String resumedCandidates = jdbcTemplate.queryForObject(
                "SELECT auto_creative_skill_candidates FROM agent_runs WHERE id = ?",
                String.class, resumedRun);
        assertThat(resumedCandidates).isEqualTo(sourceCandidates);
    }

    @Test
    void autoCandidateFailClosedWhenVersionRowMissing() throws Exception {
        pinAgentFixture();
        insertLegacySkill(LEGACY_SKILL_ID, "legacy-poster");
        insertUserSkillAuto(USER_ID, LEGACY_SKILL_ID, 1);
        // active_version_id 指向不存在的版本行 → resolveAutoCandidates 双 eq 查无 → 100307 fail closed。
        insertCreativeSkillWithSource(CS_ID, "poster-design", LEGACY_SKILL_ID, "csv_no_such_version");

        mockMvc.perform(post("/api/projects/" + PROJECT_ID + "/conversation/messages")
                        .header("X-User-Id", String.valueOf(USER_ID))
                        .header("Idempotency-Key", "fail-closed")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"client_message_id\":\"client-fail\",\"content\":\"x\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100307));
        assertThat(count("agent_runs")).isEqualTo(0);
    }

    @Test
    void successfulActivationPinsAutoSingletonAndIncrementsRunVersion() throws Exception {
        autoSkillFixture();
        long run = postMessage("activate-ok", "生成海报");
        JsonNode claimed = claim("auto-worker");
        int runVersion = claimed.path("run_version").asInt();

        MvcResult result = activate(run, "auto-worker", "key-ok", runVersion, CS_ID, CSV_ID,
                List.of("conversation_messages"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accepted").value(true))
                .andExpect(jsonPath("$.data.activation.source").value("auto"))
                .andExpect(jsonPath("$.data.activation.resource_digest").value(DIGEST))
                .andExpect(jsonPath("$.data.run_version").value(runVersion + 1))
                .andReturn();

        // 幂等回放基准：首个响应体。
        String firstOkBody = result.getResponse().getContentAsString();

        JsonNode pinned = objectMapper.readTree(jdbcTemplate.queryForObject(
                "SELECT activated_creative_skill_versions FROM agent_runs WHERE id = ?", String.class, run));
        assertThat(pinned).hasSize(1);
        assertThat(pinned.get(0).path("source").asText()).isEqualTo("auto");
        assertThat(pinned.get(0).path("resource_digest").asText()).isEqualTo(DIGEST);
        assertThat(pinned.get(0).path("reason").path("type").asText()).isEqualTo("agent_match");
        assertThat(pinned.get(0).path("reason").path("detail").path("matched_fields").get(0).asText())
                .isEqualTo("conversation_messages");

        // 幂等逐字节回放：同键同载二次 → 响应字节完全一致，无二次 version 递增、无第二条记账。
        String replayBody = activate(run, "auto-worker", "key-ok", runVersion, CS_ID, CSV_ID,
                List.of("conversation_messages"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(replayBody).isEqualTo(firstOkBody);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT version FROM agent_runs WHERE id = ?", Integer.class, run))
                .isEqualTo(runVersion + 1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM run_creative_skill_activations WHERE agent_run_id = ? "
                        + "AND idempotency_key = 'key-ok'", Integer.class, run))
                .isEqualTo(1);
    }

    @Test
    void activationRejectedForNonCandidate() throws Exception {
        autoSkillFixture();
        long run = postMessage("activate-non-cand", "生成海报");
        int runVersion = claim("auto-worker").path("run_version").asInt();

        activate(run, "auto-worker", "key-non", runVersion, CS_ID, "csv_other_version",
                List.of("conversation_messages"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100309));
    }

    @Test
    void secondActivationRejectedAsAlreadyActivated() throws Exception {
        autoSkillFixture();
        long run = postMessage("activate-twice", "生成海报");
        int runVersion = claim("auto-worker").path("run_version").asInt();

        activate(run, "auto-worker", "key-first", runVersion, CS_ID, CSV_ID,
                List.of("conversation_messages"))
                .andExpect(status().isOk());
        // 第二次：不同 idempotency_key + expected=新 version，越过 version 校验后命中单激活铁闸。
        activate(run, "auto-worker", "key-second", runVersion + 1, CS_ID, CSV_ID,
                List.of("conversation_messages"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100310));
    }

    @Test
    void activationOnForcedRunRejectedAsAlreadyActivated() throws Exception {
        pinAgentFixture();
        insertCreativeSkill(CS_ID, "poster-design", CSV_ID);
        insertCreativeSkillVersion(CSV_ID, CS_ID, DIGEST);
        long run = postForcedMessage("forced-already", "强制海报", CS_ID);
        int runVersion = claim("auto-worker").path("run_version").asInt();
        // forced Run 候选空但已激活：任何激活请求须 100310，不因候选空降级为 100309（契约 §4.1 第 4 条）。
        activate(run, "auto-worker", "key-forced", runVersion, CS_ID, CSV_ID,
                List.of("conversation_messages"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100310));
    }

    @Test
    void activationRejectedOnVersionConflict() throws Exception {
        autoSkillFixture();
        long run = postMessage("activate-conflict", "生成海报");
        int runVersion = claim("auto-worker").path("run_version").asInt();

        activate(run, "auto-worker", "key-conflict", runVersion + 999, CS_ID, CSV_ID,
                List.of("conversation_messages"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
    }

    @Test
    void activationRejectedWhenLeaseExpired() throws Exception {
        autoSkillFixture();
        long run = postMessage("activate-lease", "生成海报");
        int runVersion = claim("auto-worker").path("run_version").asInt();
        jdbcTemplate.update("UPDATE agent_runs SET lease_expires_at = CURRENT_TIMESTAMP WHERE id = ?", run);

        activate(run, "auto-worker", "key-lease", runVersion, CS_ID, CSV_ID,
                List.of("conversation_messages"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
    }

    @Test
    void sameKeyDifferentPayloadRejectedAsReused() throws Exception {
        autoSkillFixture();
        long run = postMessage("activate-reused", "生成海报");
        int runVersion = claim("auto-worker").path("run_version").asInt();

        activate(run, "auto-worker", "key-reused", runVersion, CS_ID, CSV_ID,
                List.of("conversation_messages"))
                .andExpect(status().isOk());
        // 同 idempotency_key 异载（不同 skill_id → requestHash 不同）→ 100302。
        activate(run, "auto-worker", "key-reused", runVersion, CS_ID, "csv_other_version",
                List.of("conversation_messages"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100302));
    }

    @Test
    void autoCandidatesIsolatedAcrossUsers() throws Exception {
        // user 10：cs_poster_design auto 关系（autoSkillFixture 内置 description="海报设计技能"）。
        autoSkillFixture();
        // user 11：独立 cs_video_cut auto 关系，name/description/version_id/digest 均不同。
        jdbcTemplate.update("INSERT INTO project (id, owner_id, name) VALUES (?, ?, 'auto-skill-test-2')",
                PROJECT_ID_2, USER_ID_2);
        insertLegacySkill(LEGACY_SKILL_ID_2, "legacy-video");
        insertUserSkillAuto(USER_ID_2, LEGACY_SKILL_ID_2, 1);
        insertCreativeSkillWithSource(CS_ID_2, "video-cut", LEGACY_SKILL_ID_2, CSV_ID_2, "视频剪辑技能");
        insertCreativeSkillVersion(CSV_ID_2, CS_ID_2, DIGEST_2);

        long runUser10 = postMessage("iso-user-10", "生成海报");
        long runUser11 = postMessage(USER_ID_2, PROJECT_ID_2, "iso-user-11", "生成视频");

        // 各 Run 候选只含自己的 1 条，6 字段不串扰。
        JsonNode candidatesUser10 = objectMapper.readTree(jdbcTemplate.queryForObject(
                "SELECT auto_creative_skill_candidates FROM agent_runs WHERE id = ?", String.class, runUser10));
        assertThat(candidatesUser10.isArray()).isTrue();
        assertThat(candidatesUser10).hasSize(1);
        assertThat(candidatesUser10.get(0).path("creative_skill_id").asText()).isEqualTo(CS_ID);
        assertThat(candidatesUser10.get(0).path("creative_skill_version_id").asText()).isEqualTo(CSV_ID);
        assertThat(candidatesUser10.get(0).path("name").asText()).isEqualTo("poster-design");
        assertThat(candidatesUser10.get(0).path("description").asText()).isEqualTo("海报设计技能");
        assertThat(candidatesUser10.get(0).path("display_version").asText()).isEqualTo("1.0.0");
        assertThat(candidatesUser10.get(0).path("resource_digest").asText()).isEqualTo(DIGEST);

        JsonNode candidatesUser11 = objectMapper.readTree(jdbcTemplate.queryForObject(
                "SELECT auto_creative_skill_candidates FROM agent_runs WHERE id = ?", String.class, runUser11));
        assertThat(candidatesUser11.isArray()).isTrue();
        assertThat(candidatesUser11).hasSize(1);
        assertThat(candidatesUser11.get(0).path("creative_skill_id").asText()).isEqualTo(CS_ID_2);
        assertThat(candidatesUser11.get(0).path("creative_skill_version_id").asText()).isEqualTo(CSV_ID_2);
        assertThat(candidatesUser11.get(0).path("name").asText()).isEqualTo("video-cut");
        assertThat(candidatesUser11.get(0).path("description").asText()).isEqualTo("视频剪辑技能");
        assertThat(candidatesUser11.get(0).path("display_version").asText()).isEqualTo("1.0.0");
        assertThat(candidatesUser11.get(0).path("resource_digest").asText()).isEqualTo(DIGEST_2);
    }

    @Test
    void forcedUseDoesNotRewriteAutoRelation() throws Exception {
        autoSkillFixture();
        Integer autoBefore = jdbcTemplate.queryForObject(
                "SELECT auto FROM user_skill WHERE user_id = ? AND skill_id = ?",
                Integer.class, USER_ID, LEGACY_SKILL_ID);

        long forcedRun = postForcedMessage("forced-no-rewrite", "强制海报", CS_ID);

        Integer autoAfter = jdbcTemplate.queryForObject(
                "SELECT auto FROM user_skill WHERE user_id = ? AND skill_id = ?",
                Integer.class, USER_ID, LEGACY_SKILL_ID);
        assertThat(autoAfter).isEqualTo(autoBefore);
        // forced Run 候选为空：forced 路径只读，不改写 auto 关系。
        assertThat(objectMapper.readTree(jdbcTemplate.queryForObject(
                "SELECT auto_creative_skill_candidates FROM agent_runs WHERE id = ?", String.class, forcedRun)))
                .isEmpty();
    }

    // ===== 夹具与工具 =====

    /** pin_agent 发布基线 + user 10 的 auto 关系（legacy skill 5001 → cs_poster_design/csv_poster_1_0_0）。 */
    private void autoSkillFixture() throws Exception {
        pinAgentFixture();
        insertLegacySkill(LEGACY_SKILL_ID, "legacy-poster");
        insertUserSkillAuto(USER_ID, LEGACY_SKILL_ID, 1);
        insertCreativeSkillWithSource(CS_ID, "poster-design", LEGACY_SKILL_ID, CSV_ID);
        insertCreativeSkillVersion(CSV_ID, CS_ID, DIGEST);
    }

    private void pinAgentFixture() throws Exception {
        jdbcTemplate.update("INSERT INTO project (id, owner_id, name) VALUES (?, ?, 'auto-skill-test')",
                PROJECT_ID, USER_ID);
        jdbcTemplate.update("""
                INSERT INTO runtime_agent_definitions
                    (agent_definition_id, definition_key, display_name, description, active_bundle_version_id)
                VALUES ('pin_agent', 'pin-agent', 'Pin Agent', 'auto skill test', 'pin_agent_v2_0_0')
                """);
        insertVersion("pin_agent_v2_0_0", "2.0.0", "model_v2", "generate_image", "side_effect");
    }

    private void insertLegacySkill(long id, String name) {
        jdbcTemplate.update("INSERT INTO skill (id, name, source) VALUES (?, ?, 'official')", id, name);
    }

    private void insertUserSkillAuto(long userId, long skillId, int auto) {
        jdbcTemplate.update("INSERT INTO user_skill (user_id, skill_id, auto) VALUES (?, ?, ?)",
                userId, skillId, auto);
    }

    private void insertCreativeSkill(String skillId, String name, String activeVersionId) {
        jdbcTemplate.update("""
                INSERT INTO creative_skill (creative_skill_id, name, description, active_version_id)
                VALUES (?, ?, ?, ?)
                """, skillId, name, "测试技能", activeVersionId);
    }

    private void insertCreativeSkillWithSource(
            String skillId, String name, long sourceSkillId, String activeVersionId) {
        insertCreativeSkillWithSource(skillId, name, sourceSkillId, activeVersionId, "海报设计技能");
    }

    private void insertCreativeSkillWithSource(
            String skillId, String name, long sourceSkillId, String activeVersionId, String description) {
        jdbcTemplate.update("""
                INSERT INTO creative_skill (creative_skill_id, name, description, source_skill_id, active_version_id)
                VALUES (?, ?, ?, ?, ?)
                """, skillId, name, description, sourceSkillId, activeVersionId);
    }

    private void insertCreativeSkillVersion(String versionId, String skillId, String resourceDigest) {
        jdbcTemplate.update("""
                INSERT INTO creative_skill_version
                    (creative_skill_version_id, creative_skill_id, display_version, body,
                     content_digest, resource_digest, media_type)
                VALUES (?, ?, '1.0.0', '正文', ?, ?, 'text/markdown')
                """, versionId, skillId, resourceDigest, resourceDigest);
    }

    private long postMessage(String idempotencyKey, String content) throws Exception {
        return postMessage(USER_ID, PROJECT_ID, idempotencyKey, content);
    }

    private long postMessage(long userId, long projectId, String idempotencyKey, String content)
            throws Exception {
        return objectMapper.readTree(mockMvc.perform(post("/api/projects/" + projectId + "/conversation/messages")
                        .header("X-User-Id", String.valueOf(userId))
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"client_message_id\":\"client-" + idempotencyKey
                                + "\",\"content\":\"" + content + "\"}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString())
                .path("data").path("agent_run_id").asLong();
    }

    private long postForcedMessage(String idempotencyKey, String content, String forcedId) throws Exception {
        return objectMapper.readTree(mockMvc.perform(post("/api/projects/" + PROJECT_ID + "/conversation/messages")
                        .header("X-User-Id", String.valueOf(USER_ID))
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"client_message_id\":\"client-" + idempotencyKey + "\",\"content\":\"" + content
                                + "\",\"forced_creative_skill_id\":\"" + forcedId + "\"}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString())
                .path("data").path("agent_run_id").asLong();
    }

    private long postReplyMessage(String idempotencyKey, String content, long replyToInputRequestId)
            throws Exception {
        return objectMapper.readTree(mockMvc.perform(post("/api/projects/" + PROJECT_ID + "/conversation/messages")
                        .header("X-User-Id", String.valueOf(USER_ID))
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"client_message_id\":\"client-" + idempotencyKey + "\",\"content\":\"" + content
                                + "\",\"reply_to_input_request_id\":" + replyToInputRequestId + "}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString())
                .path("data").path("agent_run_id").asLong();
    }

    private JsonNode claim(String workerId) throws Exception {
        return objectMapper.readTree(mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", workerId)
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString())
                .path("data");
    }

    private org.springframework.test.web.servlet.ResultActions activate(
            long runId, String workerId, String idempotencyKey, int expectedRunVersion,
            String skillId, String versionId, List<String> matchedFields) throws Exception {
        return mockMvc.perform(post("/internal/agent-runs/" + runId + "/creative-skill-activations")
                .header("X-Worker-Id", workerId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(activateBody(idempotencyKey, expectedRunVersion, skillId, versionId, matchedFields)));
    }

    private String activateBody(String idempotencyKey, int expectedRunVersion, String skillId,
            String versionId, List<String> matchedFields) throws Exception {
        ObjectNode node = objectMapper.createObjectNode()
                .put("idempotency_key", idempotencyKey)
                .put("expected_run_version", expectedRunVersion)
                .put("creative_skill_id", skillId)
                .put("creative_skill_version_id", versionId);
        ObjectNode reason = objectMapper.createObjectNode().put("type", "agent_match");
        ArrayNode fields = objectMapper.createArrayNode();
        matchedFields.forEach(fields::add);
        reason.set("detail", objectMapper.createObjectNode().set("matched_fields", fields));
        node.set("reason", reason);
        return objectMapper.writeValueAsString(node);
    }

    private String insertVersion(String versionId, String version, String modelProfileId,
            String toolGrantName, String toolGrantEffect) throws Exception {
        ObjectNode manifest = objectMapper.createObjectNode()
                .put("formatVersion", 1)
                .put("baseUri", "bw-bundle://" + versionId + "/")
                .put("digestAlgorithm", "sha256");
        manifest.set("resources", objectMapper.createArrayNode());
        String digest = new RuntimeBundleDigests(objectMapper).canonicalJson(manifest);
        manifest.put("manifestDigest", digest);
        ObjectNode composition = objectMapper.createObjectNode();
        composition.set("modelProfiles", objectMapper.createArrayNode().add(
                objectMapper.createObjectNode()
                        .put("modelProfileId", modelProfileId)
                        .put("version", version)));
        ObjectNode grant = objectMapper.createObjectNode()
                .put("toolName", toolGrantName)
                .put("registryVersion", 1)
                .put("effect", toolGrantEffect)
                .put("proposalOnly", true);
        grant.set("argumentSchema", objectMapper.createObjectNode()
                .put("$schema", "https://json-schema.org/draft/2020-12/schema")
                .put("type", "object"));
        grant.set("constraints", objectMapper.createObjectNode());
        composition.set("toolGrants", objectMapper.createArrayNode().add(grant));
        composition.set("resourceManifest", manifest);
        ObjectNode snapshot = objectMapper.createObjectNode().put("bundleVersionId", versionId);
        snapshot.set("composition", composition);
        jdbcTemplate.update("""
                INSERT INTO runtime_bundle_versions
                    (bundle_version_id, agent_definition_id, semantic_version, source_draft_id,
                     source_draft_revision, manifest_digest, snapshot_json, published_by)
                VALUES (?, 'pin_agent', ?, 'pin-agent-draft', 1, ?, ?, 10)
                """, versionId, version, digest, objectMapper.writeValueAsString(snapshot));
        return digest;
    }

    private Integer count(String table) {
        return jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
    }
}
