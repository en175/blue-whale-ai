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

    public RunPin resolve(AgentRun sourceRun, String forcedCreativeSkillId) {
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
        // Creative Skill 激活：forced_use 时解析当前发布版本原子固定为 0/1 单例；无 forced 时空数组。
        // ToolGrant 从激活 BundleVersion 快照 composition.toolGrants 解析（不变）。
        JsonNode toolGrantsNode = composition.path("toolGrants");
        String toolGrantsJson = toolGrantsNode.isArray() ? toolGrantsNode.toString() : "[]";
        String creativeSkillVersions = forcedCreativeSkillId == null
                ? "[]"
                : resolveForcedActivation(forcedCreativeSkillId);
        return requiredPin(
                pin.bundleVersionId(), pin.manifestDigest(),
                model.path("modelProfileId").asText(), model.path("version").asText(),
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

    private RunPin inherited(AgentRun sourceRun) {
        return requiredPin(
                sourceRun.getBundleVersionId(), sourceRun.getManifestDigest(),
                sourceRun.getModelProfileId(), sourceRun.getModelProfileVersion(),
                sourceRun.getActivatedCreativeSkillVersions(),
                sourceRun.getToolGrants());
    }

    private RunPin requiredPin(
            String bundleVersionId,
            String manifestDigest,
            String modelProfileId,
            String modelProfileVersion,
            String creativeSkillVersions,
            String toolGrants) {
        if (blank(bundleVersionId) || blank(manifestDigest)
                || blank(modelProfileId) || blank(modelProfileVersion)) {
            throw unavailable("Runtime Bundle 运行身份不完整");
        }
        return new RunPin(bundleVersionId, manifestDigest, modelProfileId, modelProfileVersion,
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
            String activatedCreativeSkillVersions,
            String toolGrants) {

        static RunPin disabled() {
            return new RunPin(null, null, null, null, null, null);
        }
    }

    private record PublishedPin(String bundleVersionId, String manifestDigest) {}
}
