package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.CreativeSkillVersionMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.MessageAssetReferenceMapper;
import com.blue.whale.agent.model.dto.AgentAssetResponse;
import com.blue.whale.agent.model.dto.CanvasDto;
import com.blue.whale.agent.model.dto.CanvasNodeDetail;
import com.blue.whale.agent.model.dto.CanvasNodeSummary;
import com.blue.whale.agent.model.dto.CanvasNodesResponse;
import com.blue.whale.agent.model.dto.CreativeSkillBodyResponse;
import com.blue.whale.agent.model.dto.CreativeSkillRecommendationResponse;
import com.blue.whale.agent.model.dto.CreativeSkillReferenceResourceResponse;
import com.blue.whale.agent.model.dto.GenerationJobStatusResponse;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.CreativeSkillVersion;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.MessageAssetReference;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 创作现场只读查询（IK2QC7）：面向 Python Agent Worker 的 Canvas / Asset / 生成任务状态 /
 * Creative Skill 元数据五个只读端点。
 *
 * <p>鉴权与 {@link ConversationQueryService} 同语义：以 runId 为根，{@code X-Worker-Id} 校验租约归属
 * （leaseOwner 匹配 + 未过期），Project 范围由 run 绑定闭环——Worker 拿不到别的 Project 的 run 租约。
 * 所有查询叠加 run 的 {@code projectId} / {@code userId} 双保险，防跨对话 / 跨 Project 渗漏。
 *
 * <p>{@code read_asset} 的「仅选中或 @ 引用放行」：后端无独立的选中 / @ 引用持久化状态，故以当前
 * Project 画布节点引用的 {@code data.assetId} 与本 Run 的 {@code agent_run} 来源生成任务输出
 * {@code outputAssetIds} 合成放行白名单（均为现有结构化数据，不改表）。assetId 必须落入白名单，
 * 再叠加 projectId + userId + status=normal 三元组校验；任一不符一律 {@code RESOURCE_NOT_FOUND}，
 * 不泄漏资源存在性。
 */
@Service
@RequiredArgsConstructor
public class CreativeContextQueryService {

    private static final int DEFAULT_NODE_LIMIT = 50;
    private static final int MAX_NODE_LIMIT = 200;
    /** §7 推荐项 activation_eligibility 恒值：推荐不构成自动激活授权，需用户显式 Use。 */
    private static final String ACTIVATION_ELIGIBILITY_REQUIRES_USER_USE = "requires_user_use";

    private final RunLeaseGuard runLeaseGuard;
    private final AssetMapper assetMapper;
    private final GenerationJobMapper generationJobMapper;
    private final MessageAssetReferenceMapper messageAssetReferenceMapper;
    private final CreativeSkillVersionMapper creativeSkillVersionMapper;
    private final CanvasService canvasService;
    private final AgentRunMapper agentRunMapper;
    private final ProjectService projectService;
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    /** list_canvas_nodes：当前 Project 画布的节点摘要列表（紧凑，限流）。 */
    public CanvasNodesResponse listCanvasNodes(Long runId, String workerId, Integer limit) {
        AgentRun run = runLeaseGuard.requireLeasedRun(runId, workerId);
        int pageSize = clampNodeLimit(limit);
        CanvasDto canvas = canvasService.getByProject(run.getProjectId());
        List<JsonNode> raw = parseNodes(canvas.nodes());
        List<CanvasNodeSummary> nodes = new ArrayList<>();
        for (JsonNode node : raw) {
            if (nodes.size() >= pageSize) {
                break;
            }
            nodes.add(toSummary(node));
        }
        return new CanvasNodesResponse(canvas.id(), nodes);
    }

    /** read_canvas_node：单个画布节点详情（含原始 data）。 */
    public CanvasNodeDetail readCanvasNode(Long runId, String workerId, String nodeId) {
        AgentRun run = runLeaseGuard.requireLeasedRun(runId, workerId);
        if (nodeId == null || nodeId.isBlank()) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        for (JsonNode node : parseNodes(canvasService.getByProject(run.getProjectId()).nodes())) {
            if (nodeId.equals(textOrNull(node, "id"))) {
                JsonNode data = node.path("data");
                return new CanvasNodeDetail(
                        nodeId,
                        textOrNull(node, "type"),
                        longOrNull(data, "assetId"),
                        data.isMissingNode() || data.isNull() ? null : data);
            }
        }
        throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
    }

    /** read_asset：仅放行画布引用 ∪ 本 Run 产物范围内的 Asset，叠加三元组校验。 */
    public AgentAssetResponse readAsset(Long runId, String workerId, Long assetId) {
        AgentRun run = runLeaseGuard.requireLeasedRun(runId, workerId);
        if (assetId == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        if (!allowedAssetIds(run, runId).contains(assetId)) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        Asset asset = assetMapper.selectById(assetId);
        if (asset == null
                || !Objects.equals(asset.getProjectId(), run.getProjectId())
                || !Objects.equals(asset.getUserId(), run.getUserId())
                || !Asset.STATUS_NORMAL.equals(asset.getStatus())) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        return new AgentAssetResponse(
                asset.getId(),
                asset.getType(),
                asset.getSource(),
                asset.getStatus(),
                asset.getMime(),
                asset.getSize(),
                asset.getWidth(),
                asset.getHeight(),
                asset.getDuration(),
                asset.getUrl());
    }

    /** read_generation_job_status：单个生成任务紧凑状态（限 Project + User 归属）。 */
    public GenerationJobStatusResponse readGenerationJobStatus(Long runId, String workerId, Long jobId) {
        AgentRun run = runLeaseGuard.requireLeasedRun(runId, workerId);
        if (jobId == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        GenerationJob job = generationJobMapper.selectById(jobId);
        if (job == null
                || !Objects.equals(job.getProjectId(), run.getProjectId())
                || !Objects.equals(job.getUserId(), run.getUserId())
                || !Objects.equals(job.getAgentRunId(), runId)) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        return new GenerationJobStatusResponse(
                job.getId(),
                job.getType(),
                job.getStatus(),
                job.getProgress(),
                job.getError(),
                job.getOutputAssetIds());
    }

    /**
     * §7 list_creative_skills（IK3NPI）：Creative Skill 推荐查询，租约鉴权后走 Skill Library。
     *
     * <p>数据源已从 Run 固定 Bundle 快照迁到 Java Skill Library，响应为契约封闭形状
     * （4 字段，恒 {@code requires_user_use}），不含版本 ID / 摘要 / 正文。
     */
    public List<CreativeSkillRecommendationResponse> listCreativeSkills(Long runId, String workerId) {
        return queryRecommendations(runLeaseGuard.requireLeasedRun(runId, workerId));
    }

    /**
     * §7 Web 公开推荐查询（IK3NPI）：产品侧 {@code X-User-Id} 身份 + Run 绑定 Project 归属校验，
     * 不存在与越权统一 {@code RESOURCE_NOT_FOUND}（不泄漏资源存在性），响应同内部路由形状。
     */
    public List<CreativeSkillRecommendationResponse> listCreativeSkillRecommendationsForUser(
            Long runId, Long userId) {
        AgentRun run = agentRunMapper.selectById(runId);
        if (run == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        projectService.requireOwned(run.getProjectId(), userId);
        return queryRecommendations(run);
    }

    /**
     * §7 推荐集合：user 可见 Creative Skill（user_skill JOIN creative_skill，同候选冻结的
     * JOIN 语义，去掉 auto 过滤）减去本 Run 冻结的 auto 候选。仅取 active_version_id 非空
     * （无发布版本的 Skill 不可推荐），按 creative_skill_id 稳定排序。
     */
    private List<CreativeSkillRecommendationResponse> queryRecommendations(AgentRun run) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
                SELECT creative_skill.creative_skill_id AS creative_skill_id,
                       creative_skill.name AS name,
                       creative_skill.description AS description,
                       creative_skill.active_version_id AS active_version_id
                FROM user_skill
                JOIN creative_skill ON creative_skill.source_skill_id = user_skill.skill_id
                WHERE user_skill.user_id = ? AND user_skill.is_delete = 0
                ORDER BY creative_skill.creative_skill_id
                """, run.getUserId());
        Set<String> frozenIds = frozenCandidateIds(run.getAutoCreativeSkillCandidates());
        List<CreativeSkillRecommendationResponse> recommendations = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            String creativeSkillId = (String) row.get("creative_skill_id");
            String activeVersionId = (String) row.get("active_version_id");
            String name = (String) row.get("name");
            String description = (String) row.get("description");
            // 契约 CreativeSkillRecommendation 要求 name/description 非空（SkillName pattern /
            // SkillDescription minLength 1）；不合规行 fail closed 剔除，不输出非法推荐项。
            if (activeVersionId == null || activeVersionId.isBlank()
                    || name == null || name.isBlank()
                    || description == null || description.isBlank()
                    || frozenIds.contains(creativeSkillId)) {
                continue;
            }
            recommendations.add(new CreativeSkillRecommendationResponse(
                    creativeSkillId,
                    name,
                    description,
                    ACTIVATION_ELIGIBILITY_REQUIRES_USER_USE));
        }
        return recommendations;
    }

    /** 解析 Run 冻结的 auto 候选（JSON 文本）为 creative_skill_id 集合；空 / 缺省 → 空集。 */
    private Set<String> frozenCandidateIds(String json) {
        if (json == null || json.isBlank()) {
            return Set.of();
        }
        JsonNode array;
        try {
            array = objectMapper.readTree(json);
        } catch (Exception exception) {
            throw new IllegalStateException("AgentRun 的 Creative Skill 候选已损坏", exception);
        }
        if (!array.isArray()) {
            throw new IllegalStateException("AgentRun 的 Creative Skill 候选已损坏");
        }
        Set<String> ids = new HashSet<>();
        for (JsonNode candidate : array) {
            String creativeSkillId = textOrNull(candidate, "creative_skill_id");
            if (creativeSkillId != null) {
                ids.add(creativeSkillId);
            }
        }
        return ids;
    }

    /** §6 read_creative_skill_body：按 Run pin 固定版本派生正文（content_digest 供 Worker 双重校验）。 */
    public CreativeSkillBodyResponse readCreativeSkillBody(Long runId, String workerId) {
        AgentRun run = runLeaseGuard.requireLeasedRun(runId, workerId);
        CreativeSkillActivationPin pin = resolveActivatedPin(run);
        CreativeSkillVersion version = creativeSkillVersionMapper.selectOne(
                Wrappers.<CreativeSkillVersion>lambdaQuery()
                        .eq(CreativeSkillVersion::getCreativeSkillVersionId, pin.versionId())
                        .eq(CreativeSkillVersion::getCreativeSkillId, pin.skillId()));
        if (version == null) {
            // 固定版本不存在 / 不再可读 → VERSION_UNAVAILABLE（契约 §8：fail closed，不换版本）。
            throw new GlobalException(SystemCode.CREATIVE_SKILL_VERSION_UNAVAILABLE_CODE, "Creative Skill 版本不可读");
        }
        if (version.getBody() == null || version.getBody().isBlank()) {
            throw new GlobalException(SystemCode.CREATIVE_SKILL_CONTENT_MISSING_CODE, "Creative Skill 正文缺失");
        }
        String mediaType = version.getMediaType() == null || version.getMediaType().isBlank()
                ? "text/markdown" : version.getMediaType();
        return new CreativeSkillBodyResponse(
                pin.skillId(), pin.versionId(), mediaType, version.getBody(), version.getContentDigest());
    }

    /** §6 read_creative_skill_reference：单个引用资源（首批 seed 无引用资源 → CONTENT_MISSING，不伪造）。 */
    public CreativeSkillReferenceResourceResponse readCreativeSkillReference(
            Long runId, String workerId, String resourcePath) {
        AgentRun run = runLeaseGuard.requireLeasedRun(runId, workerId);
        // 确认 Run 已激活固定版本（身份从 pin 派生，客户端不能指定版本）；首批 seed 无引用资源，
        // 请求任何引用资源 fail closed（契约 §6/§8），不伪造引用内容。
        resolveActivatedPin(run);
        throw new GlobalException(SystemCode.CREATIVE_SKILL_CONTENT_MISSING_CODE, "引用资源不存在");
    }

    /**
     * 从 Run pin 的 {@code activatedCreativeSkillVersions}（JSON 文本，0/1 单例）派生固定激活记录。
     *
     * <p>Java 按 {@code runId} 寻址、从 Run pin 派生精确 Skill 与版本——客户端不能改读其他版本
     * （契约 §6）。无激活（空数组 / 缺省 / 解析失败）→ {@code CREATIVE_SKILL_CONTENT_MISSING}，
     * 不回退默认提示词。
     */
    private CreativeSkillActivationPin resolveActivatedPin(AgentRun run) {
        String json = run.getActivatedCreativeSkillVersions();
        if (json == null || json.isBlank()) {
            throw new GlobalException(SystemCode.CREATIVE_SKILL_CONTENT_MISSING_CODE, "Run 未激活 Creative Skill");
        }
        JsonNode array;
        try {
            array = objectMapper.readTree(json);
        } catch (Exception exception) {
            throw new GlobalException(SystemCode.CREATIVE_SKILL_CONTENT_MISSING_CODE, "Creative Skill 激活 pin 解析失败");
        }
        if (!array.isArray() || array.isEmpty()) {
            throw new GlobalException(SystemCode.CREATIVE_SKILL_CONTENT_MISSING_CODE, "Run 未激活 Creative Skill");
        }
        JsonNode activation = array.get(0);
        return new CreativeSkillActivationPin(
                textOrNull(activation, "creative_skill_id"),
                textOrNull(activation, "creative_skill_version_id"));
    }

    private record CreativeSkillActivationPin(String skillId, String versionId) {}

    /**
     * 当前 Run 的放行 Asset 白名单三源并集：
     * <ol>
     * <li>画布节点 {@code data.assetId}；
     * <li>本 Run 的 {@code agent_run} 来源生成任务输出 {@code outputAssetIds}；
     * <li>同 Conversation 全部消息 @ 引用的 assetId（IK39RU）——范围按 {@code conversationId}
     * 而非当前 Run，使追问轮次的新 Run 即使自身不带引用，仍能读早先 Run 落的引用素材。
     * 不加 userId 过滤：写路径 {@code filterOwnedReferenceAssetIds} 已保证落库引用同 user，
     * 跨 user 由 {@code readAsset} 三元组兜底。
     * </ol>
     */
    private Set<Long> allowedAssetIds(AgentRun run, Long runId) {
        Set<Long> allowed = new HashSet<>();
        for (JsonNode node : parseNodes(canvasService.getByProject(run.getProjectId()).nodes())) {
            Long assetId = longOrNull(node.path("data"), "assetId");
            if (assetId != null) {
                allowed.add(assetId);
            }
        }
        List<GenerationJob> jobs = generationJobMapper.selectList(
                Wrappers.<GenerationJob>lambdaQuery()
                        .eq(GenerationJob::getAgentRunId, runId)
                        .eq(GenerationJob::getSource, GenerationJob.SOURCE_AGENT_RUN));
        for (GenerationJob job : jobs) {
            List<Long> outputs = job.getOutputAssetIds();
            if (outputs != null) {
                allowed.addAll(outputs);
            }
        }
        List<MessageAssetReference> references = messageAssetReferenceMapper.selectList(
                Wrappers.<MessageAssetReference>lambdaQuery()
                        .eq(MessageAssetReference::getConversationId, run.getConversationId())
                        .eq(MessageAssetReference::getProjectId, run.getProjectId()));
        for (MessageAssetReference reference : references) {
            allowed.add(reference.getAssetId());
        }
        return allowed;
    }

    private List<JsonNode> parseNodes(String nodesJson) {
        if (nodesJson == null || nodesJson.isBlank()) {
            return List.of();
        }
        try {
            JsonNode tree = objectMapper.readTree(nodesJson);
            return tree.isArray() ? toList(tree) : List.of();
        } catch (Exception exception) {
            // nodesJson 由前端写入，理论合法；畸形时降级为空列表，不阻断 Agent 推进。
            return List.of();
        }
    }

    private List<JsonNode> toList(JsonNode array) {
        List<JsonNode> nodes = new ArrayList<>(array.size());
        for (JsonNode node : array) {
            nodes.add(node);
        }
        return nodes;
    }

    private CanvasNodeSummary toSummary(JsonNode node) {
        JsonNode data = node.path("data");
        return new CanvasNodeSummary(
                textOrNull(node, "id"),
                textOrNull(node, "type"),
                longOrNull(data, "assetId"));
    }

    private int clampNodeLimit(Integer limit) {
        if (limit == null || limit < 1) {
            return DEFAULT_NODE_LIMIT;
        }
        return Math.min(limit, MAX_NODE_LIMIT);
    }

    private static String textOrNull(JsonNode parent, String field) {
        JsonNode node = parent.path(field);
        return node.isMissingNode() || node.isNull() ? null : node.asText();
    }

    private static Long longOrNull(JsonNode parent, String field) {
        JsonNode node = parent.path(field);
        if (node.isMissingNode() || node.isNull() || !node.canConvertToLong()) {
            return null;
        }
        return node.asLong();
    }
}
