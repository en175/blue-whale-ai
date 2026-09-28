package com.bluewhale.worker.domain.dto;

import java.util.List;

/**
 * 人声背景分离成功发布输入（IKHA2J，附录 C 触点⑤；镜像 {@link PublishMediaExtractDto}
 * 的多轨形态——与先例的最大契约差异：scene 二分法两轨 / 三分法三轨，每轨一条音频 Asset）。
 * <p>
 * 轨序 = {@link com.bluewhale.worker.domain.contract.VocalSplitContract#SCENE_TRACKS} 的
 * 任务 scene 轨序（voice 恒首轨），processor 按 SCENE_TRACKS 展开逐轨转存后以轨序传入；
 * 终态收口按本列表顺序 insert 资产并拼 output_asset_ids（前端按下标与轨类型双通道对位）。
 */
public record PublishVocalSplitDto(
        /** 目标任务 id（字符串承载 BigInt） */
        String jobId,
        String projectId,
        String userId,
        String workerId,
        long fencingToken,
        /** 逐轨结果（轨序传入，长度 2 或 3 = expected_output_count） */
        List<PublishVocalSplitTrackDto> tracks
) {

    /** 单轨发布输入（一轨一资产：轨类型 + 转存产物字段，形态对齐 TosAudioMediaRelay.StoredAudio + 轨语义）。 */
    public record PublishVocalSplitTrackDto(
            /** 轨类型（契约 TRACK_TYPES 四值之一；scene 决定哪些轨出现与轨序）。 */
            String trackType,
            String url,
            String storageKey,
            String mime,
            long size,
            /** 产物字节的 md5（32 位小写 hex，TOS 上传出口），落 assets.md5 供去重。 */
            String md5,
            /** 时长（秒；官方 result.duration 单值，逐轨冗余同一值，缺失回落源时长换算；可 null）。 */
            Double durationSec
    ) {}
}
