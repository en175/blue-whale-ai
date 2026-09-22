package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.entity.StoryboardPreviewEntity;
import com.bluewhale.worker.domain.contract.JobStatusEnum;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.StoryboardPreviewMapper;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * StoryboardPreview 摘要同步（刀④ 拆分自 JobStateMachineService syncStoryboardPreviewSummary）。
 * <p>
 * 按 first_generation_job_id 反查预览，聚合该 job 的 output_slots 推进汇总态
 * （generation-worker-internals.ts:67-113）。与 SceneCardGenerationRecordSync 对偶：
 * 视频走 record 外键，图片 job 不设该外键故走本路径。
 */
@Service
public class StoryboardPreviewSync {

    private final GenerationOutputSlotMapper slotMapper;
    private final StoryboardPreviewMapper previewMapper;
    private final ProjectEventPublisher eventPublisher;

    public StoryboardPreviewSync(
            GenerationOutputSlotMapper slotMapper,
            StoryboardPreviewMapper previewMapper,
            ProjectEventPublisher eventPublisher
    ) {
        this.slotMapper = slotMapper;
        this.previewMapper = previewMapper;
        this.eventPublisher = eventPublisher;
    }

    /**
     * 回写 preview summary_status（internals.ts:67-113 syncStoryboardPreviewSummary）。
     * null-guard：findFirst 无命中 → 立即返回（internals.ts:75）。
     */
    public void sync(Long jobId) {
        StoryboardPreviewEntity preview = previewMapper.findByFirstGenerationJobId(jobId);
        if (preview == null) return;

        List<GenerationOutputSlotEntity> slots = slotMapper.findByJobId(jobId);
        if (slots.isEmpty()) return;

        String summary = JobStatusEnum.aggregateSlotStatus(JobStatusEnum.resolveLogicalSlots(slots));
        int affected = previewMapper.updateSummaryStatus(preview.getId(), summary);
        if (affected != 1) return;

        if (preview.getProjectId() != null) {
            StoryboardPreviewEntity updated = previewMapper.selectById(preview.getId());
            int version = updated != null && updated.getVersion() != null
                    ? updated.getVersion() : 0;
            eventPublisher.publish(preview.getProjectId(),
                    "storyboard_preview.summary_changed",
                    "storyboard_preview",
                    preview.getId().toString(),
                    version,
                    "preview_" + preview.getId(),
                    Map.of("preview_id", preview.getId().toString(),
                            "summary_status", summary));
        }
    }
}
