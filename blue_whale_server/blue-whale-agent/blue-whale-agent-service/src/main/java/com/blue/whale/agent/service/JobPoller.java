package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.model.entity.GenerationJob;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 任务轮询器：{@code @Scheduled} 5s 扫 {@code status='processing' AND next_poll_at<=NOW()}，
 * 逐个调 {@link GenerationJobService#pollJob(GenerationJob)} 查 Ark 推进状态。
 *
 * <p>单任务异常不影响其他任务；poller 重启后从 MySQL 扫到期任务续跑（状态持久化）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class JobPoller {

    private final GenerationJobService generationJobService;
    private final GenerationJobMapper jobMapper;

    @Scheduled(fixedDelay = 5000)
    public void pollDueJobs() {
        List<GenerationJob> jobs = jobMapper.selectList(new LambdaQueryWrapper<GenerationJob>()
                .eq(GenerationJob::getStatus, GenerationJob.STATUS_PROCESSING)
                .le(GenerationJob::getNextPollAt, LocalDateTime.now()));
        if (jobs.isEmpty()) {
            return;
        }
        log.debug("polling {} due jobs", jobs.size());
        for (GenerationJob job : jobs) {
            try {
                generationJobService.pollJob(job);
            } catch (Exception e) {
                log.error("poll job {} failed", job.getId(), e);
            }
        }
    }
}
