package com.bluewhale.agent.service;

import com.bluewhale.agent.mapper.GenerationJobMapper;
import com.bluewhale.agent.model.entity.GenerationJob;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link JobPoller} 测试：mock jobMapper.selectList + generationJobService.pollJob，
 * 覆盖空转、逐个轮询、单任务异常不影响其他。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class JobPollerTest {

    @Mock
    private GenerationJobService generationJobService;
    @Mock
    private GenerationJobMapper jobMapper;

    @InjectMocks
    private JobPoller poller;

    private GenerationJob job(long id, String taskId) {
        GenerationJob j = new GenerationJob().setProviderTaskId(taskId);
        j.setId(id);
        return j;
    }

    @Test
    void noDueJobsDoesNothing() {
        when(jobMapper.selectList(any())).thenReturn(List.of());
        poller.pollDueJobs();
        verifyNoInteractions(generationJobService);
    }

    @Test
    void dueJobsPolledIndividually() {
        GenerationJob j1 = job(1L, "t1");
        GenerationJob j2 = job(2L, "t2");
        when(jobMapper.selectList(any())).thenReturn(List.of(j1, j2));

        poller.pollDueJobs();

        verify(generationJobService).pollJob(j1);
        verify(generationJobService).pollJob(j2);
    }

    @Test
    void pollExceptionDoesNotStopOthers() {
        GenerationJob j1 = job(1L, "t1");
        GenerationJob j2 = job(2L, "t2");
        when(jobMapper.selectList(any())).thenReturn(List.of(j1, j2));
        doThrow(new RuntimeException("fail")).when(generationJobService).pollJob(j1);

        poller.pollDueJobs();

        verify(generationJobService).pollJob(j1);
        verify(generationJobService).pollJob(j2);
    }
}
