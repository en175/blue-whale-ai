package com.bluewhale.worker.application.service;

import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
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

/**
 * recovery 扫描测试（IKF3AT；TS recovery.service.ts:38-106 行为对账）。
 * <p>
 * 覆盖：到点 job 逐条重投（id 字符串 + 1000ms 延迟）、生产者缺失（防御分支）跳过该 tag、
 * 单条投递失败不中断本轮、扫描参数（limit=100 / 窗口分钟数透传）、整轮异常兜底。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class RecoveryServiceTest {

    private static final int MAX_AGE_MINUTES = 120;

    @Mock private GenerationJobMapper jobMapper;
    @Mock private ObjectProvider<GenerationMessageProducer> videoProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> imageProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> audioProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> extractProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> imageEnhanceProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> imageEraseProvider;
    @Mock private ObjectProvider<GenerationMessageProducer> imageOutpaintProvider;
    @Mock private GenerationMessageProducer videoProducer;
    @Mock private GenerationMessageProducer imageProducer;
    @Mock private GenerationMessageProducer audioProducer;
    @Mock private GenerationMessageProducer extractProducer;
    @Mock private GenerationMessageProducer imageEnhanceProducer;
    @Mock private GenerationMessageProducer imageEraseProducer;
    @Mock private GenerationMessageProducer imageOutpaintProducer;

    private RecoveryService service;

    @BeforeEach
    void setUp() {
        when(videoProvider.getIfAvailable()).thenReturn(videoProducer);
        when(imageProvider.getIfAvailable()).thenReturn(imageProducer);
        when(audioProvider.getIfAvailable()).thenReturn(audioProducer);
        when(extractProvider.getIfAvailable()).thenReturn(extractProducer);
        when(imageEnhanceProvider.getIfAvailable()).thenReturn(imageEnhanceProducer);
        when(imageEraseProvider.getIfAvailable()).thenReturn(imageEraseProducer);
        when(imageOutpaintProvider.getIfAvailable()).thenReturn(imageOutpaintProducer);
        when(jobMapper.listDueVideoJobIds(anyInt(), anyInt())).thenReturn(List.of());
        when(jobMapper.listDueImageJobIds(anyInt(), anyInt())).thenReturn(List.of());
        when(jobMapper.listDueAudioJobIds(anyInt(), anyInt())).thenReturn(List.of());
        when(jobMapper.listDueMediaExtractJobIds(anyInt(), anyInt())).thenReturn(List.of());
        when(jobMapper.listDueImageEnhanceJobIds(anyInt(), anyInt())).thenReturn(List.of());
        when(jobMapper.listDueImageEraseJobIds(anyInt(), anyInt())).thenReturn(List.of());
        when(jobMapper.listDueImageOutpaintJobIds(anyInt(), anyInt())).thenReturn(List.of());
        service = new RecoveryService(jobMapper, videoProvider, imageProvider,
                audioProvider, extractProvider, imageEnhanceProvider, imageEraseProvider,
                imageOutpaintProvider, MAX_AGE_MINUTES);
    }

    @Test
    @DisplayName("到点 job 逐条重投：id 字符串 + 1000ms 延迟（对齐 TS enqueue 语义）")
    void reenqueuesDueJobsPerTag() {
        when(jobMapper.listDueImageJobIds(anyInt(), anyInt())).thenReturn(List.of(1821L, 1822L));

        service.recover();

        ArgumentCaptor<String> idCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Long> delayCaptor = ArgumentCaptor.forClass(Long.class);
        verify(imageProducer, times(2)).enqueue(idCaptor.capture(), delayCaptor.capture());
        assertThat(idCaptor.getAllValues()).containsExactly("1821", "1822");
        assertThat(delayCaptor.getAllValues()).containsExactly(1000L, 1000L);
    }

    @Test
    @DisplayName("扫描参数：limit=100 + 窗口分钟数透传（2h 政策）")
    void passesScanParameters() {
        service.recover();

        verify(jobMapper).listDueVideoJobIds(100, MAX_AGE_MINUTES);
        verify(jobMapper).listDueImageJobIds(100, MAX_AGE_MINUTES);
        verify(jobMapper).listDueAudioJobIds(100, MAX_AGE_MINUTES);
        verify(jobMapper).listDueMediaExtractJobIds(100, MAX_AGE_MINUTES);
        verify(jobMapper).listDueImageEnhanceJobIds(100, MAX_AGE_MINUTES);
        verify(jobMapper).listDueImageEraseJobIds(100, MAX_AGE_MINUTES);
        verify(jobMapper).listDueImageOutpaintJobIds(100, MAX_AGE_MINUTES);
    }

    @Test
    @DisplayName("生产者缺失（防御分支）→ 该 tag 不投，其余照常")
    void skipsDisabledTag() {
        when(imageProvider.getIfAvailable()).thenReturn(null);
        when(jobMapper.listDueImageJobIds(anyInt(), anyInt())).thenReturn(List.of(1821L));

        service.recover();

        verify(imageProducer, never()).enqueue(anyString(), anyLong());
        verify(jobMapper).listDueAudioJobIds(100, MAX_AGE_MINUTES);
    }

    @Test
    @DisplayName("单条投递失败不中断本轮（TS 逐条 catch 同款）")
    void singleEnqueueFailureDoesNotAbortRound() {
        when(jobMapper.listDueImageJobIds(anyInt(), anyInt())).thenReturn(List.of(1L, 2L));
        doThrow(new RuntimeException("mq down")).when(imageProducer).enqueue(eq("1"), anyLong());

        service.recover();

        verify(imageProducer).enqueue(eq("2"), anyLong());
        verify(jobMapper).listDueAudioJobIds(100, MAX_AGE_MINUTES);
    }

    @Test
    @DisplayName("整轮异常兜底：扫描抛错不逃逸（调度线程保活）")
    void scanFailureIsSwallowed() {
        when(jobMapper.listDueVideoJobIds(anyInt(), anyInt()))
                .thenThrow(new RuntimeException("db down"));

        service.recover(); // 不抛

        verify(jobMapper, never()).listDueImageJobIds(anyInt(), anyInt());
    }
}
