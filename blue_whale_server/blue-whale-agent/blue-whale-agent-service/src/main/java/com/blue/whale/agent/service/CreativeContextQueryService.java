package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.MessageAssetReferenceMapper;
import com.blue.whale.agent.model.dto.AgentAssetResponse;
import com.blue.whale.agent.model.dto.CanvasDto;
import com.blue.whale.agent.model.dto.CanvasNodeDetail;
import com.blue.whale.agent.model.dto.CanvasNodeSummary;
import com.blue.whale.agent.model.dto.CanvasNodesResponse;
import com.blue.whale.agent.model.dto.CreativeSkillResponse;
import com.blue.whale.agent.model.dto.GenerationJobStatusResponse;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.MessageAssetReference;
import com.blue.whale.agent.runtimebundle.RuntimeBundleService;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
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

    private final RunLeaseGuard runLeaseGuard;
    private final AssetMapper assetMapper;
    private final GenerationJobMapper generationJobMapper;
    private final MessageAssetReferenceMapper messageAssetReferenceMapper;
    private final CanvasService canvasService;
    private final RuntimeBundleService runtimeBundleService;
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

    /** list_creative_skills：Run 固定 Bundle 快照里的 Creative Skill 紧凑元数据列表。 */
    public List<CreativeSkillResponse> listCreativeSkills(Long runId, String workerId) {
        AgentRun run = runLeaseGuard.requireLeasedRun(runId, workerId);
        String bundleVersionId = run.getBundleVersionId();
        if (bundleVersionId == null || bundleVersionId.isBlank()) {
            return List.of();
        }
        JsonNode snapshot = runtimeBundleService.readVersion(bundleVersionId);
        JsonNode resources = snapshot.path("composition").path("resourceManifest").path("resources");
        List<CreativeSkillResponse> skills = new ArrayList<>();
        for (JsonNode resource : resources) {
            if (!"creative_skill".equals(textOrNull(resource, "kind"))) {
                continue;
            }
            JsonNode metadata = resource.path("metadata");
            skills.add(new CreativeSkillResponse(
                    textOrNull(resource, "creative_skill_id"),
                    textOrNull(resource, "version"),
                    textOrNull(metadata, "name"),
                    textOrNull(metadata, "description"),
                    booleanOrNull(metadata, "allow_implicit_invocation")));
        }
        return skills;
    }

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

    private static Boolean booleanOrNull(JsonNode parent, String field) {
        JsonNode node = parent.path(field);
        if (node.isMissingNode() || node.isNull()) {
            return null;
        }
        return node.asBoolean();
    }
}
