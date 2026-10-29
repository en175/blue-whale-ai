package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.contract.JobStatusEnum;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.SceneCardGenerationRecordMapper;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class SceneCardGenerationRecordSync {

    private final GenerationOutputSlotMapper slotMapper;
    private final SceneCardGenerationRecordMapper recordMapper;

    public SceneCardGenerationRecordSync(
            GenerationOutputSlotMapper slotMapper,
            SceneCardGenerationRecordMapper recordMapper
    ) {
        this.slotMapper = slotMapper;
        this.recordMapper = recordMapper;
    }

    public void sync(Long recordId) {
        List<GenerationOutputSlotEntity> slots = slotMapper.findBySceneCardRecordId(recordId);
        if (slots.isEmpty()) return;

        String summary = JobStatusEnum.aggregateSlotStatus(JobStatusEnum.resolveLogicalSlots(slots));
        recordMapper.updateSummaryStatus(recordId, summary);
    }
}
