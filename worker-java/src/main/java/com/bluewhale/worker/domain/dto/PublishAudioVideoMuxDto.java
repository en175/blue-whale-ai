package com.bluewhale.worker.domain.dto;

/**
 * 音视频合成成功发布输入（IKIHPJ，附录 C 触点⑤；镜像 {@link PublishMediaExtractDto}）。
 * <p>
 * 视频产物：type='video' + 宽高由 {@code resolution} 解析（缺失回落源视频资产）、
 * duration 秒入 duration_ms（缺失回落源视频资产）；结果资产命名与回落查询以
 * {@code sourceVideoAssetId} 指向的源资产为准（迁移契约 §20.4）。
 */
public record PublishAudioVideoMuxDto(
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
        /** 产物字节的 md5（32 位小写 hex），落 assets.md5 供去重。 */
        String md5,
        /** 官方 result.duration（秒，可 null——缺失回落源视频资产时长）。 */
        Double durationSec,
        /** 官方 result.resolution（如 "1920x1080"，可 null——缺失/解析失败回落源视频资产宽高）。 */
        String resolution,
        /** 冻结快照里的源视频 Asset id（命名与元数据回落的查询锚点）。 */
        String sourceVideoAssetId
) {}
