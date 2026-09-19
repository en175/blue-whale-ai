package com.bluewhale.worker.domain.dto;

/**
 * 视频去字幕成功发布输入（迁移契约 §17.5 / IKGZ81，附录 C 触点⑤；镜像
 * {@link PublishImageEraseDto}，差异 = Asset type='video' 且带宽 durationSec）。
 */
public record PublishVideoSubtitleEraseDto(
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
        /** IKGS73：产物字节的 md5（32 位小写 hex，TOS 上传出口），落 assets.md5 供去重。 */
        String md5,
        /** 宽（源视频近似值：输出=输入、输入超 1080P 压 1080P，官方不返回输出元数据；可 null）。 */
        Integer width,
        /** 高（同上；可 null）。 */
        Integer height,
        /** 时长（秒；优先官方 result.duration 精确值，缺失回落源 duration_ms 换算）。 */
        Double durationSec
) {}
