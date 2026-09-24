package com.bluewhale.worker.domain.dto;

/**
 * 图片抠图成功发布输入（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXM2；
 * 镜像 PublishImageEraseDto，差异 = 无——Asset 同为 type=image/source=generated 且带宽高。
 * 宽高优先取官方响应 result.image_width/image_height，缺失时结果图 ImageIO 解析兜底，
 * 解析失败静默 null，契约 §8 等价标准）。
 */
public record PublishImageCutoutDto(
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
