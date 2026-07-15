package com.blue.whale.agent.model.dto;

import com.blue.whale.agent.model.entity.GenerationJob;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 文生图统一响应：
 * <ul>
 *   <li>流式模型：{@code {job_id, status:"processing", stream:true}}，逐张图走 SSE。</li>
 *   <li>非流式模型：{@code {asset_id, url, stream:false}}，同步一次性返回。</li>
 * </ul>
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ImageGenerateDto(Long jobId, String status, Boolean stream, Long assetId, String url) {

    /** 流式：建 job 后立即返回，逐张图由前端 EventSource 订阅。 */
    public static ImageGenerateDto streaming(Long jobId) {
        return new ImageGenerateDto(jobId, GenerationJob.STATUS_PROCESSING, Boolean.TRUE, null, null);
    }

    /** 非流式：同步生成完成返回 asset id + url。 */
    public static ImageGenerateDto sync(Long assetId, String url) {
        return new ImageGenerateDto(null, null, Boolean.FALSE, assetId, url);
    }
}
