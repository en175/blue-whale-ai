package com.bluewhale.worker.domain.dto;

/**
 * 智能扩图成功发布输入（IKGOQW；镜像 PublishImageEnhanceDto，
 * Asset type=image 且带宽高——结果图 ImageIO 解析，解析失败静默 null，契约 §8）。
 */
public record PublishImageOutpaintDto(
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
        /** IKGS73：产物字节的 md5（32 位小写 hex），落 assets.md5 供去重。 */
        String md5,
        Integer width,
        Integer height
) {}
