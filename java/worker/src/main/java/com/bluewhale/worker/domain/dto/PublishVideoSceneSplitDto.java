package com.bluewhale.worker.domain.dto;

import java.util.List;

/**
 * 视频场景切分成功发布输入（IKH8BP，父规格 IKH86V，附录 C 触点⑤；镜像
 * {@link PublishVideoSubtitleEraseDto}，差异 = 一对多：段列表代替单视频，每段一份
 * TOS 转存产物 + 段序与起止秒）。
 * <p>
 * 段序 / 起止秒 / 段资产引用 / 总时长在 {@link com.bluewhale.worker.application.service.JobFinalizer}
 * 的 publish 事务内按契约 result 键（VideoSceneSplitContract.RESULT_KEY_* / SEGMENT_KEY_*）
 * 组装进终态日志 payload 与 status_changed 事件 payload 跨进程回传（前端按 segments[]
 * 扇出段卡，1 段与 N 段同构不特判）。
 */
public record PublishVideoSceneSplitDto(
        /** 目标任务 id（字符串承载 BigInt） */
        String jobId,
        String projectId,
        String userId,
        String workerId,
        long fencingToken,
        /** 视频总时长（秒；官方 result.duration，缺失回落源 duration_ms 换算；可 null）。 */
        Double durationSec,
        /** 场景段列表（按官方 segments[] 返回顺序；恒非空——空段在 processor 侧已落兜底失败）。 */
        List<Segment> segments
) {

    /** 单段转存产物 + 段元数据（契约段内四要素：段序 / 起止秒 / 资产引用在 publish 侧落）。 */
    public record Segment(
            /** 段序（1 起正整数，按官方 segments[] 返回顺序编号）。 */
            int segmentIndex,
            /** 段起始秒（官方 start_time）。 */
            double startTimeSec,
            /** 段结束秒（官方 end_time）。 */
            double endTimeSec,
            String url,
            String storageKey,
            String mime,
            long size,
            /** IKGS73：产物字节的 md5（32 位小写 hex，TOS 上传出口），落 assets.md5 供去重。 */
            String md5,
            /** 宽（源视频近似值：切片不改变分辨率，官方不返回段元数据；可 null）。 */
            Integer width,
            /** 高（同上；可 null）。 */
            Integer height
    ) {}
}
