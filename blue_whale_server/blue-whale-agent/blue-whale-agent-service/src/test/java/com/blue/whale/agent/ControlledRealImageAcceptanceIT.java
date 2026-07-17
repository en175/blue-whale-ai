package com.blue.whale.agent;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.generation.GenerationAdapterProperties;
import com.blue.whale.agent.service.generation.GenerationProvider;
import com.blue.whale.agent.service.generation.GenerationProviderRequest;
import com.blue.whale.agent.service.generation.GenerationProviderResult;
import com.blue.whale.agent.service.generation.GenerationWorker;
import com.blue.whale.agent.service.generation.PreparedGenerationObject;
import com.blue.whale.agent.service.generation.SignedGenerationObject;
import com.blue.whale.agent.service.generation.StoredGenerationObject;
import com.blue.whale.agent.service.generation.TosGenerationStorage;
import com.blue.whale.agent.service.governance.GovernanceException;
import com.blue.whale.agent.service.governance.NonProductionAcceptanceReviewEvidenceSource;
import com.blue.whale.agent.service.governance.ReviewEvidenceSource;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.volcengine.tos.TOSV2;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * IK1NS3 受控真实图片验收纵向闭环：{@code mode=openai-tos} + 显式
 * {@code acceptance-allowed=true} 的生产装配下，agent_run 图片 Job 经真实 Worker、
 * 成本预留准入、审计、非生产验收证据源与规范化 ContentReview 推进到 succeeded，
 * 只创建一个不可变私有 Asset 并投影同一 asset_id；无有效预留时 Provider 零调用
 * 且留下拒绝审计。
 *
 * <p>与 {@code LocalFakeGenerationIT} 的区别：走 openai-tos 生产 bean 装配
 * （真实 OpenAI Provider / TOS 存储 / 验收证据源选型），仅把网络出口替换为
 * 确定性 stub（{@link StubImageGenerationProvider} 与
 * {@link InMemoryTosGenerationStorage}），不产生真实供应商费用。
 * 本类只覆盖验收模式特有行为：成功接纳（验收证据源经 ContentReview 归一化）
 * 与无有效预留时的准入 fail closed；审核拒绝 / 无效证据 / 审核不可用的
 * fail-closed 语义由 LocalFakeGenerationIT 与 ContentReviewServiceTest 覆盖。
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
        "blue-whale.generation.mode=openai-tos",
        "blue-whale.generation.acceptance-allowed=true",
        "blue-whale.generation.openai.api-key=acceptance-test-key",
        "blue-whale.generation.openai.base-url=https://openai.example.test",
        "blue-whale.generation.tos.access-key=acceptance-tos-ak",
        "blue-whale.generation.tos.secret-key=acceptance-tos-sk",
        "blue-whale.generation.tos.region=cn-beijing",
        "blue-whale.generation.tos.endpoint=tos-cn-beijing.volces.com",
        "blue-whale.generation.tos.bucket=acceptance-test-bucket",
        "blue-whale.generation.tos.prefix=acceptance-test",
        "blue-whale.generation.seedance.callback-base-url=https://callback.example.test"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(ControlledRealImageAcceptanceIT.StubNetworkAdapterConfiguration.class)
class ControlledRealImageAcceptanceIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private GenerationJobMapper generationJobMapper;
    @Autowired
    private AssetMapper assetMapper;
    @Autowired
    private GenerationWorker generationWorker;
    @Autowired
    private ReviewEvidenceSource reviewEvidenceSource;
    @Autowired
    private StubImageGenerationProvider stubProvider;
    @Autowired
    private InMemoryTosGenerationStorage inMemoryStorage;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void cleanFacts() {
        stubProvider.reset();
        inMemoryStorage.clear();
        jdbcTemplate.batchUpdate(
                "DELETE FROM content_reviews",
                "DELETE FROM audit_records",
                "DELETE FROM cost_reservations",
                "DELETE FROM asset_object_transfers",
                "DELETE FROM asset_storage_objects",
                "DELETE FROM generation_provider_tasks",
                "DELETE FROM generation_result_conflicts",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM assets",
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM command_idempotency",
                "DELETE FROM conversation_messages",
                "DELETE FROM generation_jobs",
                "DELETE FROM agent_runs",
                "DELETE FROM conversations",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void acceptanceEvidenceSourceReplacesPendingPlaceholder() {
        assertThat(reviewEvidenceSource)
                .isInstanceOf(NonProductionAcceptanceReviewEvidenceSource.class);
    }

    @Test
    void agentRunImageJobCompletesThroughAcceptanceReviewedRealPath() throws Exception {
        Long jobId = createJobThroughAgentRun("受控验收合成提示词：白底蓝鲸图标");

        assertThat(generationWorker.runOnce("generation-worker-acceptance")).isTrue();
        assertThat(generationWorker.runOnce("generation-worker-acceptance")).isFalse();

        // Job 终态：source=agent_run 的 image Job，单槽位单 Asset；供应商恰好调用一次
        GenerationJob job = generationJobMapper.selectById(jobId);
        assertThat(job.getType()).isEqualTo(GenerationJob.TYPE_IMAGE);
        assertThat(job.getSource()).isEqualTo(GenerationJob.SOURCE_AGENT_RUN);
        assertThat(job.getStatus()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(job.getOutputAssetIds()).hasSize(1);
        assertThat(stubProvider.callCount()).isOne();
        Long assetId = job.getOutputAssetIds().get(0);
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isEqualTo(1);
        assertThat(count("assets", "generation_job_id", jobId)).isEqualTo(1);

        // 真实落盘事实：不可变内容摘要 + 私有存储可读
        String contentSha = jdbcTemplate.queryForObject(
                "SELECT content_sha256 FROM assets WHERE id = ?", String.class, assetId);
        assertThat(contentSha).matches("[0-9a-f]{64}");
        String storageKey = jdbcTemplate.queryForObject(
                "SELECT storage_key FROM assets WHERE id = ?", String.class, assetId);
        assertThat(storageKey).startsWith("acceptance-test/sha256/");
        assertThat(inMemoryStorage.read(storageKey))
                .startsWith((byte) 0x89, (byte) 0x50, (byte) 0x4e, (byte) 0x47);

        // 规范化 ContentReview：非生产验收证据 → decided + pass，身份与策略版本完整
        Map<String, Object> review = jdbcTemplate.queryForMap(
                "SELECT * FROM content_reviews WHERE subject_id = ?",
                "generation-job:" + jobId + ":slot:0");
        assertThat(review.get("review_state")).isEqualTo("decided");
        assertThat(review.get("decision")).isEqualTo("pass");
        assertThat(review.get("failure_code")).isNull();
        assertThat(review.get("policy_version")).isEqualTo("local-fake-v1");
        assertThat(review.get("content_digest")).isEqualTo(contentSha);
        assertThat(review.get("modality")).isEqualTo("image");
        assertThat(review.get("direction")).isEqualTo("output");
        assertThat(review.get("evidence_ref")).isEqualTo("non-production-acceptance-review");
        assertThat(count("content_reviews", "subject_id", "generation-job:" + jobId + ":slot:0"))
                .isEqualTo(1);

        // 控制面审计：预留创建、供应商准入、调用结果、审核决定、成本结算
        List<Map<String, Object>> audits = jdbcTemplate.queryForList(
                "SELECT action, decision, reason_code FROM audit_records WHERE correlation_id = ?",
                "generation-job:" + jobId);
        assertThat(audits).anyMatch(row -> row.get("action").equals("cost_reservation.create")
                && row.get("decision").equals("allowed"));
        assertThat(audits).anyMatch(row -> row.get("action").equals("cost_reservation.provider_admission")
                && row.get("decision").equals("allowed")
                && row.get("reason_code").equals("RESERVATION_ACTIVE"));
        assertThat(audits).anyMatch(row -> row.get("action").equals("generation_provider.call_outcome")
                && row.get("decision").equals("allowed")
                && row.get("reason_code").equals("SUCCESS"));
        assertThat(audits).anyMatch(row -> row.get("action").equals("content_review.decision")
                && row.get("decision").equals("allowed")
                && row.get("reason_code").equals("CONTENT_REVIEW_PASS"));
        assertThat(audits).anyMatch(row -> row.get("action").equals("cost_reservation.settle")
                && row.get("decision").equals("allowed")
                && row.get("reason_code").equals("PROVIDER_COST_PROVEN"));
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM cost_reservations WHERE generation_job_id = ?",
                String.class, jobId)).isEqualTo("SETTLED");

        // 事件与快照携带同一个 asset_id
        assertThat(jdbcTemplate.queryForList(
                "SELECT event_type FROM project_events WHERE project_id = ? ORDER BY cursor",
                String.class, job.getProjectId()))
                .contains("asset.created", "generation_job.output_attached");
        MvcResult snapshot = mockMvc.perform(get("/api/projects/{id}/snapshot", job.getProjectId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode snapshotData = objectMapper.readTree(snapshot.getResponse().getContentAsString()).path("data");
        JsonNode output = snapshotData.path("generation_jobs").get(0).path("outputs").get(0);
        assertThat(output.path("asset_id").asLong()).isEqualTo(assetId);
        String accessUrl = snapshotData.path("assets").path(String.valueOf(assetId))
                .path("access_url").asText();
        assertThat(accessUrl).isEqualTo(
                "/api/projects/" + job.getProjectId() + "/assets/" + assetId + "/content");

        // 私有访问边界：owner 200，跨 User 404，未认证 4xx
        mockMvc.perform(get(accessUrl).header("X-User-Id", "10"))
                .andExpect(status().isOk());
        mockMvc.perform(get(accessUrl).header("X-User-Id", "11"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get(accessUrl))
                .andExpect(status().is4xxClientError());
    }

    @Test
    void missingActiveReservationFailsClosedAndProviderIsNotCalled() throws Exception {
        Long jobId = createJobThroughAgentRun("受控验收合成提示词：白底蓝鲸图标");
        // 预留被终结（非 ACTIVE）后，准入闸必须 fail closed，Provider 不得被调用
        jdbcTemplate.update(
                "UPDATE cost_reservations SET status = 'RELEASED' WHERE generation_job_id = ?", jobId);

        assertThatThrownBy(() -> generationWorker.runOnce("generation-worker-no-reservation"))
                .isInstanceOf(GovernanceException.class);

        // 无供应商调用、无调用证据、无 Asset、无审核事实；准入拒绝已写审计
        assertThat(stubProvider.callCount()).isZero();
        assertThat(count("generation_provider_tasks", "generation_job_id", jobId)).isZero();
        assertThat(count("assets", "generation_job_id", jobId)).isZero();
        assertThat(count("content_reviews", "subject_id", "generation-job:" + jobId + ":slot:0"))
                .isZero();
        assertThat(jdbcTemplate.queryForList(
                "SELECT action, decision, reason_code FROM audit_records WHERE correlation_id = ?",
                "generation-job:" + jobId))
                .anyMatch(row -> row.get("action").equals("cost_reservation.provider_admission")
                        && row.get("decision").equals("denied")
                        && row.get("reason_code").equals("ACTIVE_RESERVATION_REQUIRED"));
    }

    private Long createJobThroughAgentRun(String prompt) throws Exception {
        Project project = new Project().setOwnerId(10L).setName("controlled-real-acceptance");
        projectMapper.insert(project);
        MvcResult message = mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "message-" + project.getId())
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"client-" + project.getId()
                                + "\",\"content\":\"生成图片\"}"))
                .andExpect(status().isAccepted())
                .andReturn();
        long runId = objectMapper.readTree(message.getResponse().getContentAsString())
                .path("data").path("agent_run_id").asLong();
        MvcResult claimed = mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", "agent-worker")
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode work = objectMapper.readTree(claimed.getResponse().getContentAsString()).path("data");
        String commit = "{" +
                "\"commit_id\":\"commit-1\"," +
                "\"project_id\":" + project.getId() + "," +
                "\"user_id\":10," +
                "\"expected_run_version\":" + work.path("run_version").asInt() + "," +
                "\"fencing_token\":" + work.path("fencing_token").asLong() + "," +
                "\"engine\":\"fake\"," +
                "\"engine_version\":\"1\"," +
                "\"adapter_schema_version\":1," +
                "\"visible_text\":\"已接纳，正在生成图片。\","
                + "\"checkpoint\":{\"opaque_payload\":{\"step\":\"proposed\"}},"
                + "\"actions\":[{\"action_id\":\"action-1\",\"action_type\":\"generate_image\","
                + "\"arguments\":{\"prompt\":\"" + prompt + "\",\"aspect_ratio\":\"1:1\"}}]}";
        MvcResult committed = mockMvc.perform(post("/internal/agent-runs/{id}/commits", runId)
                        .header("X-Worker-Id", "agent-worker")
                        .contentType("application/json")
                        .content(commit))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(committed.getResponse().getContentAsString())
                .path("data").path("generation_job_id").asLong();
    }

    private long count(String table, String column, Object value) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return result == null ? 0 : result;
    }

    @TestConfiguration
    static class StubNetworkAdapterConfiguration {

        // 只替换网络出口，不动产品控制面：Provider 与存储保持生产 bean 类型，
        // 由 @Primary 注入 GenerationWorker / 资产内容服务等既有消费点。
        @Bean
        @Primary
        StubImageGenerationProvider stubImageGenerationProvider() {
            return new StubImageGenerationProvider();
        }

        @Bean
        @Primary
        InMemoryTosGenerationStorage inMemoryTosGenerationStorage(
                GenerationAdapterProperties properties) {
            return new InMemoryTosGenerationStorage(properties);
        }
    }

    /** 确定性图片 Provider stub：记录调用次数，返回 1px PNG，不触网。 */
    static final class StubImageGenerationProvider implements GenerationProvider {

        private static final byte[] ONE_PIXEL_PNG = Base64.getDecoder().decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

        private final AtomicInteger calls = new AtomicInteger();

        @Override
        public GenerationProviderResult generate(GenerationProviderRequest request) {
            calls.incrementAndGet();
            return GenerationProviderResult.success(ONE_PIXEL_PNG.clone(), "image/png", 1, 1);
        }

        int callCount() {
            return calls.get();
        }

        void reset() {
            calls.set(0);
        }
    }

    /**
     * 内存版 TOS 存储：沿用真实 key/摘要规则（{@code prepare} 直接继承），
     * store/read/sign/delete 落本地 Map，不触网；凭据永不参与。
     */
    static final class InMemoryTosGenerationStorage extends TosGenerationStorage {

        private final Map<String, byte[]> objects = new ConcurrentHashMap<>();

        InMemoryTosGenerationStorage(GenerationAdapterProperties properties) {
            super(mock(TOSV2.class), properties, Clock.systemUTC());
        }

        @Override
        public StoredGenerationObject store(PreparedGenerationObject prepared, byte[] content) {
            objects.put(prepared.storageKey(), content.clone());
            return new StoredGenerationObject(prepared.storageKey(), prepared.contentSha256(),
                    prepared.mimeType(), prepared.sizeBytes());
        }

        @Override
        public byte[] read(String storageKey) {
            byte[] content = objects.get(storageKey);
            return content == null ? null : content.clone();
        }

        @Override
        public SignedGenerationObject sign(String storageKey) {
            return new SignedGenerationObject(
                    "https://in-memory-tos.invalid/" + storageKey,
                    Instant.now().plusSeconds(300));
        }

        @Override
        public void delete(String storageKey) {
            objects.remove(storageKey);
        }

        void clear() {
            objects.clear();
        }
    }
}
