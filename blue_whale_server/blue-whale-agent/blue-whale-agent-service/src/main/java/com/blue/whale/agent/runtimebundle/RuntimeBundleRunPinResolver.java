package com.blue.whale.agent.runtimebundle;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.CreativeSkillMapper;
import com.blue.whale.agent.mapper.CreativeSkillVersionMapper;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.CreativeSkill;
import com.blue.whale.agent.model.entity.CreativeSkillVersion;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public final class RuntimeBundleRunPinResolver {

    private final JdbcTemplate jdbcTemplate;
    private final RuntimeBundleService runtimeBundleService;
    private final boolean enforcementEnabled;
    private final String defaultAgentDefinitionId;
    private final CreativeSkillMapper creativeSkillMapper;
    private final CreativeSkillVersionMapper creativeSkillVersionMapper;
    private final ObjectMapper objectMapper;

    RuntimeBundleRunPinResolver(
            JdbcTemplate jdbcTemplate,
            RuntimeBundleService runtimeBundleService,
            @Value("${blue-whale.runtime-bundle.enforcement-enabled:true}") boolean enforcementEnabled,
            @Value("${blue-whale.runtime-bundle.default-agent-definition-id:canvas_agent}")
                    String defaultAgentDefinitionId,
            CreativeSkillMapper creativeSkillMapper,
            CreativeSkillVersionMapper creativeSkillVersionMapper,
            ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.runtimeBundleService = runtimeBundleService;
        this.enforcementEnabled = enforcementEnabled;
        this.defaultAgentDefinitionId = defaultAgentDefinitionId;
        this.creativeSkillMapper = creativeSkillMapper;
        this.creativeSkillVersionMapper = creativeSkillVersionMapper;
        this.objectMapper = objectMapper;
    }

    public RunPin resolve(AgentRun sourceRun, String forcedCreativeSkillId, Long userId) {
        if (!enforcementEnabled) {
            return RunPin.disabled();
        }
        if (sourceRun != null) {
            return inherited(sourceRun);
        }
        List<PublishedPin> pins = jdbcTemplate.query("""
                SELECT definition.active_bundle_version_id, version.manifest_digest
                FROM runtime_agent_definitions definition
                JOIN runtime_bundle_versions version
                  ON version.bundle_version_id = definition.active_bundle_version_id
                WHERE definition.agent_definition_id = ?
                """, (resultSet, rowNumber) -> new PublishedPin(
                        resultSet.getString("active_bundle_version_id"),
                        resultSet.getString("manifest_digest")), defaultAgentDefinitionId);
        if (pins.size() != 1) {
            throw unavailable("默认 Agent 没有唯一的激活 BundleVersion");
        }
        PublishedPin pin = pins.get(0);
        JsonNode snapshot = runtimeBundleService.readVersion(pin.bundleVersionId());
        JsonNode composition = snapshot.path("composition");
        JsonNode modelProfiles = composition.path("modelProfiles");
        if (!modelProfiles.isArray() || modelProfiles.isEmpty()) {
            throw unavailable("激活 BundleVersion 未声明可用 ModelProfile");
        }
        JsonNode model = modelProfiles.get(0);
        String manifestInSnapshot = composition.path("resourceManifest")
                .path("manifestDigest").asText(pin.manifestDigest());
        if (!pin.manifestDigest().equals(manifestInSnapshot)) {
            throw unavailable("激活 BundleVersion 的 manifest 摘要不一致");
        }
        // Creative Skill 激活：forced_use 时候选恒空（forced Run 不算 auto 候选），activated 解析
        // 当前发布版本原子固定为 0/1 单例；无 forced 时 activated 空，按 userId 冻结 auto 候选。
        // ToolGrant 从激活 BundleVersion 快照 composition.toolGrants 解析（不变）。
        JsonNode toolGrantsNode = composition.path("toolGrants");
        String toolGrantsJson = toolGrantsNode.isArray() ? toolGrantsNode.toString() : "[]";
        String autoCandidates;
        String creativeSkillVersions;
        if (forcedCreativeSkillId != null) {
            autoCandidates = "[]";
            creativeSkillVersions = resolveForcedActivation(forcedCreativeSkillId);
        } else {
            autoCandidates = resolveAutoCandidates(userId);
            creativeSkillVersions = "[]";
        }
        return requiredPin(
                pin.bundleVersionId(), pin.manifestDigest(),
                model.path("modelProfileId").asText(), model.path("version").asText(),
                autoCandidates,
                creativeSkillVersions,
                toolGrantsJson);
    }

    /**
     * 解析 forced Creative Skill 当前发布版本，构造 {@code source=forced_use} 激活单例 JSON。
     *
     * <p>任何不完整或不一致均 fail closed（契约 §4.1/§8）：Skill 不存在 → 100306；
     * 版本缺失 / 归属不符 / 摘要无效 → 100307。不换版本、不降级为空 pin。
     */
    private String resolveForcedActivation(String forcedCreativeSkillId) {
        CreativeSkill skill = creativeSkillMapper.selectOne(
                Wrappers.<CreativeSkill>lambdaQuery()
                        .eq(CreativeSkill::getCreativeSkillId, forcedCreativeSkillId));
        if (skill == null) {
            throw new GlobalException(SystemCode.CREATIVE_SKILL_UNAVAILABLE_CODE, "Creative Skill 不可用");
        }
        String activeVersionId = skill.getActiveVersionId();
        if (activeVersionId == null || activeVersionId.isBlank()) {
            throw new GlobalException(SystemCode.CREATIVE_SKILL_VERSION_UNAVAILABLE_CODE,
                    "Creative Skill 当前无发布版本");
        }
        CreativeSkillVersion version = creativeSkillVersionMapper.selectOne(
                Wrappers.<CreativeSkillVersion>lambdaQuery()
                        .eq(CreativeSkillVersion::getCreativeSkillVersionId, activeVersionId)
                        .eq(CreativeSkillVersion::getCreativeSkillId, forcedCreativeSkillId));
        if (version == null) {
            throw new GlobalException(SystemCode.CREATIVE_SKILL_VERSION_UNAVAILABLE_CODE,
                    "Creative Skill 版本不可用");
        }
        String resourceDigest = version.getResourceDigest();
        if (resourceDigest == null || !resourceDigest.matches("^sha256:[0-9a-f]{64}$")) {
            throw new GlobalException(SystemCode.CREATIVE_SKILL_VERSION_UNAVAILABLE_CODE,
                    "Creative Skill 版本摘要无效");
        }
        Map<String, Object> activation = new LinkedHashMap<>();
        activation.put("creative_skill_id", forcedCreativeSkillId);
        activation.put("creative_skill_version_id", activeVersionId);
        activation.put("source", "forced_use");
        activation.put("reason", Map.of("type", "user_use"));
        activation.put("resource_digest", resourceDigest);
        try {
            return objectMapper.writeValueAsString(List.of(activation));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("无法序列化 Creative Skill 激活单例", exception);
        }
    }

    /**
     * 解析 user 的 auto Creative Skill 候选快照（契约 §4.2/§4.2.5）。
     *
     * <p>user_skill(auto=1, is_delete=0) JOIN creative_skill ON source_skill_id = user_skill.skill_id
     * → (creative_skill_id, name, description, active_version_id)；逐个双 eq 查 creative_skill_version
     * 取 display_version 与 resource_digest，构造 6 字段候选（snake_case，无正文）。任一候选
     * active_version_id 空 / 版本行缺失 / 归属不符 / digest 无效 → fail closed 100307，整个 accept
     * 回滚，不留部分候选。forced Run 不调用本方法（候选恒空）。
     */
    private String resolveAutoCandidates(Long userId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
                SELECT creative_skill.creative_skill_id AS creative_skill_id,
                       creative_skill.name AS name,
                       creative_skill.description AS description,
                       creative_skill.active_version_id AS active_version_id
                FROM user_skill
                JOIN creative_skill ON creative_skill.source_skill_id = user_skill.skill_id
                WHERE user_skill.user_id = ?
                  AND user_skill.auto = 1
                  AND user_skill.is_delete = 0
                """, userId);
        List<Map<String, Object>> candidates = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            String creativeSkillId = (String) row.get("creative_skill_id");
            String activeVersionId = (String) row.get("active_version_id");
            if (activeVersionId == null || activeVersionId.isBlank()) {
                throw new GlobalException(SystemCode.CREATIVE_SKILL_VERSION_UNAVAILABLE_CODE,
                        "Creative Skill 候选无发布版本");
            }
            CreativeSkillVersion version = creativeSkillVersionMapper.selectOne(
                    Wrappers.<CreativeSkillVersion>lambdaQuery()
                            .eq(CreativeSkillVersion::getCreativeSkillVersionId, activeVersionId)
                            .eq(CreativeSkillVersion::getCreativeSkillId, creativeSkillId));
            if (version == null) {
                throw new GlobalException(SystemCode.CREATIVE_SKILL_VERSION_UNAVAILABLE_CODE,
                        "Creative Skill 候选版本不可用");
            }
            String resourceDigest = version.getResourceDigest();
            if (resourceDigest == null || !resourceDigest.matches("^sha256:[0-9a-f]{64}$")) {
                throw new GlobalException(SystemCode.CREATIVE_SKILL_VERSION_UNAVAILABLE_CODE,
                        "Creative Skill 候选版本摘要无效");
            }
            Map<String, Object> candidate = new LinkedHashMap<>();
            candidate.put("creative_skill_id", creativeSkillId);
            candidate.put("creative_skill_version_id", activeVersionId);
            candidate.put("name", row.get("name"));
            candidate.put("description", row.get("description"));
            candidate.put("display_version", version.getDisplayVersion());
            candidate.put("resource_digest", resourceDigest);
            candidates.add(candidate);
        }
        try {
            return objectMapper.writeValueAsString(candidates);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("无法序列化 Creative Skill 候选", exception);
        }
    }

    private RunPin inherited(AgentRun sourceRun) {
        return requiredPin(
                sourceRun.getBundleVersionId(), sourceRun.getManifestDigest(),
                sourceRun.getModelProfileId(), sourceRun.getModelProfileVersion(),
                sourceRun.getAutoCreativeSkillCandidates(),
                sourceRun.getActivatedCreativeSkillVersions(),
                sourceRun.getToolGrants());
    }

    private RunPin requiredPin(
            String bundleVersionId,
            String manifestDigest,
            String modelProfileId,
            String modelProfileVersion,
            String autoCreativeSkillCandidates,
            String creativeSkillVersions,
            String toolGrants) {
        if (blank(bundleVersionId) || blank(manifestDigest)
                || blank(modelProfileId) || blank(modelProfileVersion)) {
            throw unavailable("Runtime Bundle 运行身份不完整");
        }
        return new RunPin(bundleVersionId, manifestDigest, modelProfileId, modelProfileVersion,
                blank(autoCreativeSkillCandidates) ? "[]" : autoCreativeSkillCandidates,
                blank(creativeSkillVersions) ? "[]" : creativeSkillVersions,
                blank(toolGrants) ? "[]" : toolGrants);
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private GlobalException unavailable(String message) {
        return new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, message);
    }

    public record RunPin(
            String bundleVersionId,
            String manifestDigest,
            String modelProfileId,
            String modelProfileVersion,
            String autoCreativeSkillCandidates,
            String activatedCreativeSkillVersions,
            String toolGrants) {

        static RunPin disabled() {
            return new RunPin(null, null, null, null, null, null, null);
        }
    }

    private record PublishedPin(String bundleVersionId, String manifestDigest) {}
}
