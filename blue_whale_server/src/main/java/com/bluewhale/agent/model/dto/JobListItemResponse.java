package com.bluewhale.agent.model.dto;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 生成任务列表项（生成流页 {@code /generate}）。
 *
 * @param jobId        任务 id
 * @param type         image / video
 * @param status       queued / processing / succeeded / failed
 * @param progress     进度 0-100
 * @param input        生成输入参数（prompt/model 等），整存整取透传
 * @param createdAt    创建时间
 * @param outputAssets 产出资源（仅 succeeded 非空）
 */
public record JobListItemResponse(
        Long jobId,
        String type,
        String status,
        Integer progress,
        Map<String, Object> input,
        LocalDateTime createdAt,
        List<OutputAsset> outputAssets) {

    /** 产出资源摘要。 */
    public record OutputAsset(Long id, String url, String type, Integer width, Integer height) {
    }
}
