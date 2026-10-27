package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.entity.StoryboardPreviewEntity;
import com.bluewhale.worker.domain.contract.JobStatusEnum;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.StoryboardPreviewMapper;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class StoryboardPreviewSync {

    private final GenerationOutputSlotMapper slotMapper;
    private final StoryboardPreviewMapper previewMapper;

    public StoryboardPreviewSync(
            GenerationOutputSlotMapper slotMapper,
            StoryboardPreviewMapper previewMapper
    ) {
        this.slotMapper = slotMapper;
        this.previewMapper = previewMapper;
    }

    public void sync(Long jobId) {
        StoryboardPreviewEntity preview = previewMapper.findByFirstGenerationJobId(jobId);
        if (preview == null) return;

        List<GenerationOutputSlotEntity> slots = slotMapper.findByJobId(jobId);
        if (slots.isEmpty()) return;

        String summary = JobStatusEnum.aggregateSlotStatus(JobStatusEnum.resolveLogicalSlots(slots));
        previewMapper.updateSummaryStatus(preview.getId(), summary);
    }
}
