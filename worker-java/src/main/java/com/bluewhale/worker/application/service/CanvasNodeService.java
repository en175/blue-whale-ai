package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.CanvasEntity;
import com.bluewhale.worker.infrastructure.mapper.CanvasMapper;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 画布节点操作服务（media-extract-canvas-ops.ts 逐字移植）。
 * <p>
 * 独立于 JobStateMachineService 以避免破坏现有构造器签名（23 金标测试不受影响）。
 * <p>
 * 版本守卫 CAS + 冲突重试（MAX_RETRY=3，media-extract-canvas-ops.ts:12）。
 */
@Service
public class CanvasNodeService {

    private static final Logger log = LoggerFactory.getLogger(CanvasNodeService.class);
    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();
    /** read-modify-write 冲突重试上限（media-extract-canvas-ops.ts:12）。 */
    private static final int MAX_RETRY = 3;

    private final CanvasMapper canvasMapper;
    private final GenerationJobMapper jobMapper;

    public CanvasNodeService(CanvasMapper canvasMapper, GenerationJobMapper jobMapper) {
        this.canvasMapper = canvasMapper;
        this.jobMapper = jobMapper;
    }

    /**
     * 提取成功：把占位节点更新为最终音频节点（media-extract-canvas-ops.ts:103-151）。
     * <p>
     * 读 job.output_asset_ids 取音频资产 id；版本守卫 CAS 更新画布。
     * 失败不阻断任务成功（runner 侧 catch 吞异常）。
     */
    public boolean updateMediaExtractNodeToAudio(
            String jobId, String projectId,
            String url, String mime, long size, Double duration
    ) {
        // 读 job.output_asset_ids（media-extract-canvas-ops.ts:115-121）
        GenerationJobEntity job = jobMapper.selectById(Long.parseLong(jobId));
        String audioAssetId = null;
        if (job != null && job.getOutputAssetIds() != null) {
            List<Object> ids = parseJsonArray(job.getOutputAssetIds());
            if (ids != null && !ids.isEmpty()) {
                audioAssetId = String.valueOf(ids.get(0));
            }
        }

        final String finalAudioAssetId = audioAssetId;
        return withCanvasUpdate(Long.parseLong(projectId), nodes -> {
            // media-extract-canvas-ops.ts:123-148
            String nodeId = "media-extract-" + jobId;
            int idx = findNodeIndex(nodes, nodeId);
            if (idx < 0) return null; // 找不到占位节点 → 不写

            Map<String, Object> existingNode = nodes.get(idx);
            @SuppressWarnings("unchecked")
            Map<String, Object> existingData = existingNode.containsKey("data")
                    ? (Map<String, Object>) existingNode.get("data")
                    : Map.of();

            // 保留占位节点的派生展示名（media-extract-canvas-ops.ts:128-129）
            Object pendingFileName = existingData.get("fileName");
            String fileName = (pendingFileName instanceof String s && !s.isEmpty())
                    ? s
                    : audioDisplayName(null);

            Map<String, Object> newData = new HashMap<>();
            newData.put("src", url);
            newData.put("mediaType", "audio");
            newData.put("fileName", fileName);
            if (finalAudioAssetId != null) {
                newData.put("assetId", finalAudioAssetId);
            }
            newData.put("mime", mime);
            newData.put("size", size);
            if (duration != null) {
                newData.put("duration", duration);
            }
            newData.put("progress", 100);
            newData.put("toolMode", "select");

            Map<String, Object> updatedNode = new HashMap<>(existingNode);
            updatedNode.put("data", newData);
            nodes.set(idx, updatedNode);

            return true;
        });
    }

    /**
     * 提取失败：把占位节点置 failed（media-extract-canvas-ops.ts:153-174）。
     */
    public boolean failMediaExtractNode(
            String jobId, String projectId,
            String code, String message
    ) {
        return withCanvasUpdate(Long.parseLong(projectId), nodes -> {
            String nodeId = "media-extract-" + jobId;
            int idx = findNodeIndex(nodes, nodeId);
            if (idx < 0) return null;

            Map<String, Object> existingNode = nodes.get(idx);
            @SuppressWarnings("unchecked")
            Map<String, Object> existingData = existingNode.containsKey("data")
                    ? (Map<String, Object>) existingNode.get("data")
                    : Map.of();

            Map<String, Object> newData = new HashMap<>(existingData);
            newData.put("genStatus", "failed");
            newData.put("errorText", message);
            newData.put("progress", 0);

            Map<String, Object> updatedNode = new HashMap<>(existingNode);
            updatedNode.put("data", newData);
            nodes.set(idx, updatedNode);

            return true;
        });
    }

    /**
     * 版本守卫的画布节点更新（media-extract-canvas-ops.ts:31-55 withCanvasUpdate）。
     * <p>
     * mutator 返回 null 表示不写（找不到目标节点）；否则返回结果。
     * CAS 冲突重试最多 MAX_RETRY 次。
     */
    private <T> T withCanvasUpdate(Long projectId, CanvasMutator<T> mutator) {
        for (int attempt = 0; attempt < MAX_RETRY; attempt++) {
            CanvasEntity canvas = canvasMapper.findByProjectId(projectId);
            if (canvas == null) return null;

            List<Map<String, Object>> nodes = parseNodesJson(canvas.getNodesJson());
            T result;
            try {
                result = mutator.mutate(nodes);
            } catch (Exception e) {
                log.warn("canvas mutator 异常: {}", e.getMessage(), e);
                return null;
            }
            if (result == null) return null;

            String updatedJson = toJson(nodes);
            int affected = canvasMapper.updateNodesCas(canvas.getId(), canvas.getVersion(), updatedJson);
            if (affected == 1) return result;
            // 版本冲突 → 重读重试
        }
        return null;
    }

    /** 查找节点索引（按 id 匹配）。 */
    private static int findNodeIndex(List<Map<String, Object>> nodes, String nodeId) {
        for (int i = 0; i < nodes.size(); i++) {
            Object id = nodes.get(i).get("id");
            if (nodeId.equals(String.valueOf(id))) return i;
        }
        return -1;
    }

    /** 音频展示名兜底（media-extract-canvas-ops.ts:58-63）。 */
    static String audioDisplayName(String videoFileName) {
        if (videoFileName != null && !videoFileName.trim().isEmpty()) {
            String base = videoFileName.trim().replaceFirst("\\.[^./]+$", "");
            return base + "(audio).mp3";
        }
        return "提取音频(audio).mp3";
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> parseNodesJson(String nodesJson) {
        if (nodesJson == null || nodesJson.isBlank()) return new ArrayList<>();
        try {
            Object parsed = JSON_MAPPER.readValue(nodesJson, Object.class);
            if (parsed instanceof List<?> list) {
                List<Map<String, Object>> result = new ArrayList<>();
                for (Object item : list) {
                    if (item instanceof Map<?, ?> m) {
                        result.add((Map<String, Object>) m);
                    }
                }
                return result;
            }
            return new ArrayList<>();
        } catch (JsonProcessingException e) {
            log.debug("parseNodesJson 失败(非关键): {}", e.getMessage());
            return new ArrayList<>();
        }
    }

    private List<Object> parseJsonArray(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return JSON_MAPPER.readValue(json, new TypeReference<List<Object>>() {});
        } catch (JsonProcessingException e) {
            log.debug("parseJsonArray 失败(非关键): {}", e.getMessage());
            return null;
        }
    }

    private String toJson(Object obj) {
        try {
            return JSON_MAPPER.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("JSON serialization failed", e);
        }
    }

    @FunctionalInterface
    private interface CanvasMutator<T> {
        T mutate(List<Map<String, Object>> nodes);
    }
}
