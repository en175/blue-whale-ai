package com.bluewhale.worker.domain.dto;

/**
 * 视频插帧成功发布输入（IKHLKJ，父需求 IKHLES，附录 C 触点⑤）。镜像
 * {@link PublishVideoEnhanceDto}，差异按插帧契约（IKHLK3 已冻结）：
 * <ul>
 *   <li><b>无 resolution 门槛派生</b>：官方明示「插帧不改变分辨率，跟随原片」，故宽高取
 *       **源 Asset 近似值**（HD 的「档位短边 + 源宽高比推导」不复制，插帧无档位表）。</li>
 *   <li>结果四键中 duration / resolution / fps 由终态收口落 generation_job_logs payload
 *       （assets 无对应列）——fps 只作结果契约字段，**不新增卡片 / 资产 fps 元数据链**（ADR-0113）。</li>
 * </ul>
 */
public record PublishVideoFrameInterpolationDto(
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
        /** 宽（插帧不改变分辨率 → 取源 Asset 宽；源宽高缺失时 null，§8 静默容忍）。 */
        Integer width,
        /** 高（同上；可 null）。 */
        Integer height,
        /** 时长（秒；优先官方 result.duration 精确值，缺失回落源 duration_ms 换算）。 */
        Double durationSec,
        /** 输出分辨率档位（官方 result.resolution，跟随原片；仅落终态日志 payload，可 null）。 */
        String resolution,
        /** 输出帧率（官方 result.fps——与提交时目标帧率一致，缺失回落冻结 input fps；可 null）。 */
        Double fps
) {}
