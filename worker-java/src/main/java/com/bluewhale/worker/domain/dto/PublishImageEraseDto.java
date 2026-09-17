package com.bluewhale.worker.domain.dto;

/**
 * 图片擦除成功发布输入（契约 §15.5 / 附录 C 触点⑤；镜像 PublishImageEnhanceDto，
 * 差异 = 无——Asset 同为 type=image/source=generated 且带宽高，结果图 ImageIO 解析，
 * 解析失败静默 null，契约 §8）。
 */
public record PublishImageEraseDto(
        /** 目标任务 id（字符串承载 BigInt） */
        String jobId,
        String projectId,
        String userId,
        String workerId,
        long fencingToken,
        String url,
        String storageKey,
        String mime,
        long size,
        Integer width,
        Integer height
) {}
