package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 图片/音频作业领取投影（契约 附录 B：ClaimedJob，types.ts:3-16）。
 * <p>
 * <b>snake_case 字段</b>（与 TS ClaimedJob 投影逐字一致）。
 * 图片与音频共用此投影；视频投影另含 pollCount/progress/providerTaskId/parentProviderTaskId。
 */
public record ClaimedJobDto(
        /** 主键（BigInt，对外字符串化承载） */
        String id,
        /** 归属项目（claim-ops.ts:436 → toString ?? "0"） */
        String project_id,
        /** 归属用户 */
        String user_id,
        /** 类型：image / audio */
        String type,
        /** 创建时冻结参数 JSON（provider_credential / prompt / model_id / references…） */
        Map<String, Object> input,
        /** image 瞬态重试次数（<3 才可回 queued） */
        int retry_count,
        /** 取消请求标记（cancel_requested_at != null → true） */
        boolean cancelRequested,
        /** 增后 fencing_token（candidate.fencing_token + 1n → Number()） */
        long fencingToken
) {}
