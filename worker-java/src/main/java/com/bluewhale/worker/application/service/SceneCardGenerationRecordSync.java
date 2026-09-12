package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.entity.SceneCardGenerationRecordEntity;
import com.bluewhale.worker.domain.entity.JobStatus;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.SceneCardGenerationRecordMapper;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * SceneCardGenerationRecord 摘要同步（刀④ 拆分自 JobStateMachineService syncRecordSummary）。
 * <p>
 * 聚合 record 下全部输出槽状态 → summary_status 回写 + summary_changed 事件
 * （generation-worker-internals.ts:21-62）。在 complete/fail 事务内调用，保证原子一致。
 */
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

    /**
     * 回写 record summary_status（internals.ts:21-62 syncRecordSummary 逐字移植）。
     * null-guard：无槽 / 无 record FK 时不调用。
     */
    public void sync(Long recordId) {
        List<GenerationOutputSlotEntity> slots = slotMapper.findBySceneCardRecordId(recordId);
        if (slots.isEmpty()) return;

        String summary = JobStatus.aggregateSlotStatus(JobStatus.resolveLogicalSlots(slots));
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
