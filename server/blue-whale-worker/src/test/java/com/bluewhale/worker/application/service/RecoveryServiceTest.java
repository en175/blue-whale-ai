package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class RecoveryServiceTest {

    @Mock private GenerationJobMapper jobMapper;
    @Mock private JobFinalizer jobFinalizer;
    @Mock private TerminalEventOutbox outbox;
    @Mock private ObjectProvider<GenerationMessageProducer> videoProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> imageProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> audioProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> extractProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> audioTrimProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> audioMixProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> audioVideoMuxProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> audioSpeedProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> imageEnhanceProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> imageEraseProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> imageCutoutProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> imageOutpaintProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> videoSubtitleEraseProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> videoEnhanceProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> vocalSplitProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> videoSceneSplitProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> videoMattingProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> videoFrameInterpolationProvider;
    @Mock private GenerationMessageProducer videoProducer;
    @Mock private GenerationMessageProducer imageProducer;
    @Mock private GenerationMessageProducer audioProducer;
    @Mock private GenerationMessageProducer extractProducer;
    @Mock private GenerationMessageProducer audioTrimProducer;
    @Mock private GenerationMessageProducer audioMixProducer;
    @Mock private GenerationMessageProducer audioVideoMuxProducer;
    @Mock private GenerationMessageProducer audioSpeedProducer;
    @Mock private GenerationMessageProducer imageEnhanceProducer;
    @Mock private GenerationMessageProducer imageEraseProducer;
    @Mock private GenerationMessageProducer imageCutoutProducer;
    @Mock private GenerationMessageProducer imageOutpaintProducer;
    @Mock private GenerationMessageProducer videoSubtitleEraseProducer;
    @Mock private GenerationMessageProducer videoEnhanceProducer;
    @Mock private GenerationMessageProducer vocalSplitProducer;
    @Mock private GenerationMessageProducer videoSceneSplitProducer;
    @Mock private GenerationMessageProducer videoMattingProducer;
    @Mock private GenerationMessageProducer videoFrameInterpolationProducer;

    private RecoveryService service;

    private static GenerationJobEntity pendingJob(long id, String type) {
        GenerationJobEntity job = new GenerationJobEntity();
        job.setId(id);
        job.setType(type);
        return job;
    }

    @BeforeEach
    void setUp() {
        when(videoProvider.getIfAvailable()).thenReturn(videoProducer);
        when(imageProvider.getIfAvailable()).thenReturn(imageProducer);
        when(audioProvider.getIfAvailable()).thenReturn(audioProducer);
        when(extractProvider.getIfAvailable()).thenReturn(extractProducer);
        when(audioTrimProvider.getIfAvailable()).thenReturn(audioTrimProducer);
        when(audioMixProvider.getIfAvailable()).thenReturn(audioMixProducer);
        when(audioVideoMuxProvider.getIfAvailable()).thenReturn(audioVideoMuxProducer);
        when(audioSpeedProvider.getIfAvailable()).thenReturn(audioSpeedProducer);
        when(imageEnhanceProvider.getIfAvailable()).thenReturn(imageEnhanceProducer);
        when(imageEraseProvider.getIfAvailable()).thenReturn(imageEraseProducer);
        when(imageCutoutProvider.getIfAvailable()).thenReturn(imageCutoutProducer);
        when(imageOutpaintProvider.getIfAvailable()).thenReturn(imageOutpaintProducer);
        when(videoSubtitleEraseProvider.getIfAvailable()).thenReturn(videoSubtitleEraseProducer);
        when(videoEnhanceProvider.getIfAvailable()).thenReturn(videoEnhanceProducer);
        when(vocalSplitProvider.getIfAvailable()).thenReturn(vocalSplitProducer);
        when(videoSceneSplitProvider.getIfAvailable()).thenReturn(videoSceneSplitProducer);
        when(videoMattingProvider.getIfAvailable()).thenReturn(videoMattingProducer);
        when(videoFrameInterpolationProvider.getIfAvailable()).thenReturn(videoFrameInterpolationProducer);
        when(jobMapper.listDueVideoJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueImageJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueAudioJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueMediaExtractJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueAudioTrimJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueAudioMixJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueAudioVideoMuxJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueAudioSpeedJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueImageEnhanceJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueImageEraseJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueImageCutoutJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueImageOutpaintJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueVideoSubtitleEraseJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueVideoEnhanceJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueVocalSplitJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueVideoSceneSplitJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueVideoMattingJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listDueVideoFrameInterpolationJobIds(anyInt())).thenReturn(List.of());
        when(jobMapper.listCancelPendingJobs(anyInt())).thenReturn(List.of());
        when(jobMapper.listExpiredJobIds(anyInt())).thenReturn(List.of());
        service = new RecoveryService(jobMapper, jobFinalizer, outbox, videoProvider, imageProvider,
                audioProvider, extractProvider, audioTrimProvider, audioMixProvider, audioVideoMuxProvider,
                audioSpeedProvider,
                imageEnhanceProvider,
                imageEraseProvider, imageCutoutProvider, imageOutpaintProvider,
                videoSubtitleEraseProvider, videoEnhanceProvider, vocalSplitProvider,
                videoSceneSplitProvider, videoMattingProvider, videoFrameInterpolationProvider);
    }

    @Test
    @DisplayName("到点 job 逐条重投：id 字符串 + 1000ms 延迟（对齐 TS enqueue 语义）")
    void reenqueuesDueJobsPerTag() {
        when(jobMapper.listDueImageJobIds(anyInt())).thenReturn(List.of(1821L, 1822L));

        service.recover();

        ArgumentCaptor<String> idCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Long> delayCaptor = ArgumentCaptor.forClass(Long.class);
        verify(imageProducer, times(2)).enqueue(idCaptor.capture(), delayCaptor.capture());
        assertThat(idCaptor.getAllValues()).containsExactly("1821", "1822");
        assertThat(delayCaptor.getAllValues()).containsExactly(1000L, 1000L);
    }

    @Test
    @DisplayName("重投不再按年龄过滤：所有类型统一只传 limit")
    void scansWithoutAgeWindow() {
        service.recover();

        verify(jobMapper).listDueVideoJobIds(100);
        verify(jobMapper).listDueImageJobIds(100);
        verify(jobMapper).listDueAudioJobIds(100);
        verify(jobMapper).listDueMediaExtractJobIds(100);
        verify(jobMapper).listDueAudioTrimJobIds(100);
        verify(jobMapper).listDueAudioMixJobIds(100);
        verify(jobMapper).listDueAudioVideoMuxJobIds(100);
        verify(jobMapper).listDueAudioSpeedJobIds(100);
        verify(jobMapper).listDueImageEnhanceJobIds(100);
        verify(jobMapper).listDueImageEraseJobIds(100);
        verify(jobMapper).listDueImageCutoutJobIds(100);
        verify(jobMapper).listDueImageOutpaintJobIds(100);
        verify(jobMapper).listDueVideoSubtitleEraseJobIds(100);
        verify(jobMapper).listDueVideoEnhanceJobIds(100);
        verify(jobMapper).listDueVocalSplitJobIds(100);
        verify(jobMapper).listDueVideoSceneSplitJobIds(100);
        verify(jobMapper).listDueVideoMattingJobIds(100);
        verify(jobMapper).listDueVideoFrameInterpolationJobIds(100);
    }

    @Test
    @DisplayName("★ 取消补投：排队中已请求取消的任务按 type 找回生产者重投")
    void reenqueuesRequestedCancels() {
        when(jobMapper.listCancelPendingJobs(100))
                .thenReturn(List.of(pendingJob(3307L, "video"), pendingJob(3308L, "image")));

        service.recover();

        verify(videoProducer).enqueue("3307", 1000L);
        verify(imageProducer).enqueue("3308", 1000L);
    }

    @Test
    @DisplayName("★ 到期扫描：越过执行截止时间的任务交给收口置失败")
    void expiresOverdueJobs() {
        when(jobMapper.listExpiredJobIds(100)).thenReturn(List.of(41L, 42L));

        service.recover();

        verify(jobFinalizer).expireJob("41");
        verify(jobFinalizer).expireJob("42");
    }

    @Test
    @DisplayName("★ 发件箱投递：每轮把 pending 终态事件发出去")
    void drainsOutbox() {
        service.recover();

        verify(outbox).drain(100);
    }

    @Test
    @DisplayName("生产者缺失（防御分支）→ 该 tag 不投，其余照常")
    void skipsDisabledTag() {
        when(imageProvider.getIfAvailable()).thenReturn(null);
        when(jobMapper.listDueImageJobIds(anyInt())).thenReturn(List.of(1821L));

        service.recover();

        verify(imageProducer, never()).enqueue(anyString(), anyLong());
        verify(jobMapper).listDueAudioJobIds(100);
    }

    @Test
    @DisplayName("单条重投失败不中断本轮（TS 逐条 catch 同款）")
    void singleEnqueueFailureDoesNotAbortRound() {
        when(jobMapper.listDueImageJobIds(anyInt())).thenReturn(List.of(1L, 2L));
        doThrow(new RuntimeException("mq down")).when(imageProducer).enqueue(eq("1"), anyLong());

        service.recover();

        verify(imageProducer).enqueue(eq("2"), anyLong());
        verify(jobMapper).listDueAudioJobIds(100);
    }

    @Test
    @DisplayName("★ 取消补投抛错只记日志：不中断本轮，也不把任务判死")
    void cancelReenqueueFailureIsSwallowed() {
        when(jobMapper.listCancelPendingJobs(100)).thenReturn(List.of(pendingJob(3307L, "video")));
        doThrow(new RuntimeException("mq down")).when(videoProducer).enqueue(eq("3307"), anyLong());

        service.recover();

        verify(jobFinalizer, never()).expireJob(anyString());
        verify(outbox).drain(100);
    }

    @Test
    @DisplayName("★ 收口单条抛错不中断本轮其余任务")
    void expireFailureDoesNotAbortRound() {
        when(jobMapper.listExpiredJobIds(100)).thenReturn(List.of(41L, 42L));
        when(jobFinalizer.expireJob("41")).thenThrow(new RuntimeException("db down"));

        service.recover();

        verify(jobFinalizer).expireJob("42");
    }

    @Test
    @DisplayName("整轮异常兜底：扫描抛错不逃逸（调度线程保活）")
    void scanFailureIsSwallowed() {
        when(jobMapper.listDueVideoJobIds(anyInt()))
                .thenThrow(new RuntimeException("db down"));

        service.recover();

        verify(jobMapper, never()).listDueImageJobIds(anyInt());
    }
}
