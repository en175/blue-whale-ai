package com.bluewhale.worker.domain.dto;

/**
 * 智能抠像成功发布输入（IKHK99，父规格 IKHJRC，契约 IKHK7F；镜像
 * {@link PublishVideoEnhanceDto}——一对一单产物，差异 = 契约 result 三键
 * video_url / resolution / duration 随终态跨进程回传：video_url 语义 = 转存自有存储后的
 * 公开读地址〔官方 24h 临时链接不跨进程落库〕，resolution / duration 官方同名同值透传。
 * <p>
 * 三键在 {@link com.bluewhale.worker.application.service.JobFinalizer} 的 publish 事务内按
 * VideoMattingContract.RESULT_KEY_* 组装进终态日志 payload 与 status_changed 事件 payload
 * 的 result 键（双通道承载，video_scene_split 同款），前端完成事件驱动移除任务占位卡、
 * 就地回填普通成品视频卡（ADR-0112）。
 */
public record PublishVideoMattingDto(
        /** 目标任务 id（字符串承载 BigInt） */
        String jobId,
        String projectId,
        String userId,
        String workerId,
        long fencingToken,
        /** 转存产物公开读地址（契约 result.video_url 的值源）。 */
        String url,
        String storageKey,
        String mime,
        long size,
        /** IKGS73：产物字节的 md5（32 位小写 hex，TOS 上传出口），落 assets.md5 供去重。 */
        String md5,
        /** 宽（源视频近似值：抠像不改变分辨率，官方不返回输出像素；可 null）。 */
        Integer width,
        /** 高（同上；可 null）。 */
        Integer height,
        /** 视频时长（秒；官方 result.duration，缺失回落源 duration_ms 换算；可 null）。 */
        Double durationSec,
        /** 分辨率档位（官方 result.resolution，如 "1080p"；processor 已保证非空——
         *  completed 未返回档位落兜底失败，不进发布）。 */
        String resolution
) {}
