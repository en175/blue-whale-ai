package com.blue.whale.agent;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.AssetStorageObjectMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.AssetStorageObject;
import com.blue.whale.agent.model.entity.Project;
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

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Asset 跨项目复制集成测试（IK21O9「添加到项目」）：副本落库、共享存储对象防 GC、
 * 收件箱/越权/不存在 404、副本行级独立。
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
class AssetCopyIT {

    private static final String SHA256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private AssetMapper assetMapper;
    @Autowired
    private AssetStorageObjectMapper storageObjectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void cleanFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM asset_object_transfers",
                "DELETE FROM asset_storage_objects",
                "DELETE FROM assets",
                "DELETE FROM command_idempotency",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void copyCreatesIndependentRowSharingStorageObject() throws Exception {
        Project target = canvasProject(10L, "target");
        Asset source = sourceAsset(10L, "copy/shared.png");

        MvcResult result = mockMvc.perform(post("/api/projects/{projectId}/assets", target.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "copy-key-independent")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + source.getId() + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.id").isNumber())
                .andExpect(jsonPath("$.data.type").value("image"))
                .andExpect(jsonPath("$.data.url").value(source.getUrl()))
                .andReturn();
        long copyId = objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").path("id").asLong();
        assertThat(copyId).isNotEqualTo(source.getId());

        // 副本行：归属目标项目、记录来源、脱离生成任务，媒体字段与源一致
        Asset copy = assetMapper.selectById(copyId);
        assertThat(copy.getProjectId()).isEqualTo(target.getId());
        assertThat(copy.getUserId()).isEqualTo(10L);
        assertThat(copy.getSourceAssetId()).isEqualTo(source.getId());
        assertThat(copy.getGenerationJobId()).isNull();
        assertThat(copy.getStatus()).isEqualTo(Asset.STATUS_NORMAL);
        assertThat(copy.getType()).isEqualTo(source.getType());
        assertThat(copy.getStorageKey()).isEqualTo(source.getStorageKey());
        assertThat(copy.getContentSha256()).isEqualTo(source.getContentSha256());
        assertThat(copy.getUrl()).isEqualTo(source.getUrl());
        assertThat(copy.getMime()).isEqualTo(source.getMime());
        assertThat(copy.getWidth()).isEqualTo(source.getWidth());
        assertThat(copy.getHeight()).isEqualTo(source.getHeight());
        assertThat(copy.getSize()).isEqualTo(source.getSize());
        assertThat(copy.getSource()).isEqualTo(source.getSource());

        // 源行不变
        Asset unchanged = assetMapper.selectById(source.getId());
        assertThat(unchanged.getProjectId()).isEqualTo(source.getProjectId());
        assertThat(unchanged.getSourceAssetId()).isNull();

        // 删除源行（物理）后副本仍在：行级独立
        jdbcTemplate.update("DELETE FROM assets WHERE id = ?", source.getId());
        assertThat(assetMapper.selectById(copyId)).isNotNull();
    }

    @Test
    void copyProtectsSharedStorageObjectFromGc() throws Exception {
        // 预置待 GC 的共享存储对象（first_unreferenced_at 非空），复制后应被重新保护（置空）
        Project target = canvasProject(10L, "gc-target");
        Asset source = sourceAsset(10L, "copy/pending-gc.png");
        storageObjectMapper.insert(new AssetStorageObject()
                .setStorageKey("copy/pending-gc.png")
                .setContentSha256(SHA256)
                .setSource(Asset.SOURCE_UPLOADED)
                .setState(AssetStorageObject.STATE_AVAILABLE)
                .setActiveTransferCount(0)
                .setFirstUnreferencedAt(LocalDateTime.now().minusDays(1)));

        mockMvc.perform(post("/api/projects/{projectId}/assets", target.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "copy-key-gc")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + source.getId() + "}"))
                .andExpect(status().isOk());

        assertThat(storageObjectMapper.selectOne(Wrappers.<AssetStorageObject>lambdaQuery()
                .eq(AssetStorageObject::getStorageKey, "copy/pending-gc.png"))
                .getFirstUnreferencedAt()).isNull();
    }

    @Test
    void copyToGenerationInboxIsRejected() throws Exception {
        Project inbox = new Project().setOwnerId(10L).setName("inbox")
                .setPurpose(Project.PURPOSE_GENERATION_INBOX);
        projectMapper.insert(inbox);
        Asset source = sourceAsset(10L, "copy/to-inbox.png");

        mockMvc.perform(post("/api/projects/{projectId}/assets", inbox.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "copy-key-to-inbox")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + source.getId() + "}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100301));
    }

    @Test
    void copyRejectsForeignSourceForeignTargetAndMissingSource() throws Exception {
        Project target = canvasProject(10L, "owner-target");
        Asset foreign = sourceAsset(11L, "copy/foreign.png");

        // 源 asset 属于其他用户 → 404
        mockMvc.perform(post("/api/projects/{projectId}/assets", target.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "copy-key-foreign-source")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + foreign.getId() + "}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100301));

        // 源不存在 → 404
        mockMvc.perform(post("/api/projects/{projectId}/assets", target.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "copy-key-missing-source")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + (foreign.getId() + 1000) + "}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100301));

        // 目标 project 属于其他用户 → 404
        Asset own = sourceAsset(10L, "copy/own.png");
        mockMvc.perform(post("/api/projects/{projectId}/assets", target.getId())
                        .header("X-User-Id", "11")
                        .header("Idempotency-Key", "copy-key-foreign-target")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + own.getId() + "}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100301));
    }

    @Test
    void copyRequiresIdempotencyKey() throws Exception {
        // 评审修复2c：缺 Idempotency-Key → 400（ADR-0016 §1）
        Project target = canvasProject(10L, "no-key-target");
        Asset source = sourceAsset(10L, "copy/no-key.png");

        mockMvc.perform(post("/api/projects/{projectId}/assets", target.getId())
                        .header("X-User-Id", "10")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + source.getId() + "}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(100000));
    }

    @Test
    void copyIdempotentReplayReturnsSameCopyWithoutDuplicating() throws Exception {
        // 评审修复2c：同键同源重放返回首次副本且 assets 只多一行；不同键各建副本（ADR-0017 §4）
        Project target = canvasProject(10L, "replay-target");
        Asset source = sourceAsset(10L, "copy/replay.png");
        long baseline = countAssets(target.getId());

        MvcResult first = mockMvc.perform(post("/api/projects/{projectId}/assets", target.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "copy-key-replay")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + source.getId() + "}"))
                .andExpect(status().isOk())
                .andReturn();
        long copyId = objectMapper.readTree(first.getResponse().getContentAsString())
                .path("data").path("id").asLong();

        MvcResult replayed = mockMvc.perform(post("/api/projects/{projectId}/assets", target.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "copy-key-replay")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + source.getId() + "}"))
                .andExpect(status().isOk())
                .andReturn();
        long replayedId = objectMapper.readTree(replayed.getResponse().getContentAsString())
                .path("data").path("id").asLong();
        assertThat(replayedId).isEqualTo(copyId);
        assertThat(countAssets(target.getId())).isEqualTo(baseline + 1);

        MvcResult otherKey = mockMvc.perform(post("/api/projects/{projectId}/assets", target.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "copy-key-replay-other")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + source.getId() + "}"))
                .andExpect(status().isOk())
                .andReturn();
        long otherCopyId = objectMapper.readTree(otherKey.getResponse().getContentAsString())
                .path("data").path("id").asLong();
        assertThat(otherCopyId).isNotEqualTo(copyId);
        assertThat(countAssets(target.getId())).isEqualTo(baseline + 2);
    }

    @Test
    void copySameKeyWithDifferentSourceIsRejected() throws Exception {
        // 评审修复2c：同键不同 source_asset_id → 409 IDEMPOTENCY_KEY_REUSED
        Project target = canvasProject(10L, "conflict-target");
        Asset first = sourceAsset(10L, "copy/conflict-a.png");
        Asset second = sourceAsset(10L, "copy/conflict-b.png");

        mockMvc.perform(post("/api/projects/{projectId}/assets", target.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "copy-key-conflict")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + first.getId() + "}"))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/projects/{projectId}/assets", target.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "copy-key-conflict")
                        .contentType("application/json")
                        .content("{\"source_asset_id\":" + second.getId() + "}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100302));
    }

    private long countAssets(Long projectId) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM assets WHERE project_id = ?", Long.class, projectId);
        return result == null ? 0L : result;
    }

    private Project canvasProject(Long ownerId, String name) {
        Project project = new Project().setOwnerId(ownerId).setName(name);
        projectMapper.insert(project);
        return project;
    }

    private Asset sourceAsset(Long userId, String storageKey) {
        Asset asset = new Asset()
                .setProjectId(canvasProject(userId, "source-project").getId())
                .setUserId(userId)
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey(storageKey)
                .setContentSha256(SHA256)
                .setUrl("/assets/" + storageKey)
                .setMime("image/png")
                .setSize(128L)
                .setWidth(64)
                .setHeight(64)
                .setSource(Asset.SOURCE_UPLOADED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(asset);
        return asset;
    }
}
