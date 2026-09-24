package com.bluewhale.worker.domain.dto;

/**
 * 视频 HD 高清成功发布输入（IKH3VF，父规格 IKH3VB，附录 C 触点⑤；镜像
 * {@link PublishVideoSubtitleEraseDto}，差异 = 宽高按目标分辨率档位推导（官方不返回输出
 * 像素）并带宽 resolution / fps——assets 无对应列，两值由终态收口落 generation_job_logs
 * payload）。
 */
public record PublishVideoEnhanceDto(
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
        /** 产物字节的 md5（32 位小写 hex，TOS 上传出口），落 assets.md5 供去重。 */
        String md5,
        /** 宽（官方 result 仅档位字符串，按档位短边 + 源宽高比推导；源宽高缺失时 null）。 */
        Integer width,
        /** 高（同上；可 null）。 */
        Integer height,
        /** 时长（秒；优先官方 result.duration 精确值，缺失回落源 duration_ms 换算）。 */
        Double durationSec,
        /** 输出分辨率档位（官方 result.resolution，缺失回落任务冻结 resolution；可 null）。 */
        String resolution,
        /** 输出帧率（官方 result.fps——出站 fps 不传保持原片；可 null）。 */
        Double fps
) {}
