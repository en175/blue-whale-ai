package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.entity.StoryboardPreviewEntity;
import com.bluewhale.worker.domain.contract.JobStatusEnum;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.StoryboardPreviewMapper;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

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
