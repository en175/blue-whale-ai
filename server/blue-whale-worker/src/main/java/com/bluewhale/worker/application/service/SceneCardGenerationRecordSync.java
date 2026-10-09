package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.entity.SceneCardGenerationRecordEntity;
import com.bluewhale.worker.domain.contract.JobStatusEnum;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.SceneCardGenerationRecordMapper;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class SceneCardGenerationRecordSync {

    private final GenerationOutputSlotMapper slotMapper;
    private final SceneCardGenerationRecordMapper recordMapper;
    private final ProjectEventPublisher eventPublisher;

    public SceneCardGenerationRecordSync(
            GenerationOutputSlotMapper slotMapper,
            SceneCardGenerationRecordMapper recordMapper,
            ProjectEventPublisher eventPublisher
    ) {
        this.slotMapper = slotMapper;
        this.recordMapper = recordMapper;
        this.eventPublisher = eventPublisher;
    }

    public void sync(Long recordId) {
        List<GenerationOutputSlotEntity> slots = slotMapper.findBySceneCardRecordId(recordId);
        if (slots.isEmpty()) return;

        String summary = JobStatusEnum.aggregateSlotStatus(JobStatusEnum.resolveLogicalSlots(slots));
        int affected = recordMapper.updateSummaryStatus(recordId, summary);
        if (affected != 1) return;

        SceneCardGenerationRecordEntity record = recordMapper.selectById(recordId);
        if (record != null && record.getProjectId() != null) {
            eventPublisher.publish(record.getProjectId(),
                    "scene_card_generation_record.summary_changed",
                    "scene_card_generation_record",
                    recordId.toString(),
                    record.getVersion(),
                    "record_" + recordId,
                    Map.of("record_id", recordId.toString(),
                            "summary_status", summary));
        }
    }
}
