package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.model.dto.ProviderImageGenerationRequest;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import com.blue.whale.agent.service.provider.ImageGenerationProvider;
import com.blue.whale.agent.service.provider.ImageGenerationProviderRegistry;
import com.blue.whale.agent.service.governance.BudgetEffect;
import com.blue.whale.agent.service.governance.CostReservationService;
import com.blue.whale.global.exception.GlobalException;
import io.reactivex.Flowable;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class GenerationStreamServiceTest {

    @Mock private GenerationJobMapper jobMapper;
    @Mock private AssetStorageService assetStorageService;
    @Mock private ImageGenerationProviderRegistry providerRegistry;
    @Mock private JobStreamBus bus;
    @Mock private ProjectEventService projectEventService;
    @Mock private PlatformTransactionManager transactionManager;
    @Mock private TransactionStatus transactionStatus;
    @Mock private ImageGenerationProvider provider;
    @Mock private CostReservationService costReservationService;

    @Test
    void terminalStreamStateAppendsProjectEventInsideSmallTransaction() {
        when(transactionManager.getTransaction(any())).thenReturn(transactionStatus);
        GenerationJob job = new GenerationJob()
                .setProjectId(3L)
                .setUserId(10L)
                .setStatus(GenerationJob.STATUS_PROCESSING)
                .setOutputAssetIds(List.of());
        job.setId(7L);
        job.setVersion(1);
        when(jobMapper.selectById(7L)).thenReturn(job);
        when(providerRegistry.getProvider("provider")).thenReturn(provider);
        when(provider.streamGenerateImages(any())).thenReturn(Flowable.empty());
        GenerationModelCapability capability = new GenerationModelCapability().setProviderId("provider");
        GenerationStreamService service = new GenerationStreamService(jobMapper, assetStorageService,
                providerRegistry, bus, projectEventService, costReservationService, transactionManager);

        service.runImageStream(7L, capability, org.mockito.Mockito.mock(ProviderImageGenerationRequest.class));

        verify(projectEventService).appendEvent(eq(3L), eq("generation_job.status_changed"),
                eq("generation_job"), eq("7"), any(), any(), any(), any());
        verify(transactionManager).commit(transactionStatus);
        verify(costReservationService).requireActiveBeforeProvider(7L);
        verify(costReservationService).settleReserved(7L, "PROVIDER_COST_PROVEN");
    }

    @Test
    void providerResolutionFailureReleasesReservationBeforeAnyPaidCall() {
        when(transactionManager.getTransaction(any())).thenReturn(transactionStatus);
        GenerationJob job = processingJob();
        when(jobMapper.selectById(7L)).thenReturn(job);
        when(providerRegistry.getProvider("missing-provider"))
                .thenThrow(new IllegalStateException("provider registry secret"));
        when(costReservationService.budgetEffect(7L))
                .thenReturn(BudgetEffect.RESERVATION_RELEASED);
        GenerationStreamService service = service();

        service.runImageStream(7L,
                new GenerationModelCapability().setProviderId("missing-provider"),
                org.mockito.Mockito.mock(ProviderImageGenerationRequest.class));

        verify(costReservationService).finalizeProviderFailure(7L, false);
    }

    @Test
    void providerReadinessFailureReleasesReservationBeforeAnyPaidCall() {
        when(transactionManager.getTransaction(any())).thenReturn(transactionStatus);
        GenerationJob job = processingJob();
        when(jobMapper.selectById(7L)).thenReturn(job);
        when(providerRegistry.getProvider("provider")).thenReturn(provider);
        doThrow(new GlobalException("ARK_API_KEY 未配置")).when(provider).requireReady();
        when(costReservationService.budgetEffect(7L))
                .thenReturn(BudgetEffect.RESERVATION_RELEASED);
        GenerationStreamService service = service();

        service.runImageStream(7L,
                new GenerationModelCapability().setProviderId("provider"),
                org.mockito.Mockito.mock(ProviderImageGenerationRequest.class));

        verify(provider, never()).streamGenerateImages(any());
        verify(costReservationService).finalizeProviderFailure(7L, false);
    }

    @Test
    void providerFailureKeepsReservationForReconciliationAndSanitizesSse() {
        when(transactionManager.getTransaction(any())).thenReturn(transactionStatus);
        GenerationJob job = processingJob();
        when(jobMapper.selectById(7L)).thenReturn(job);
        when(providerRegistry.getProvider("provider")).thenReturn(provider);
        when(provider.streamGenerateImages(any()))
                .thenThrow(new IllegalStateException("provider credential secret"));
        when(costReservationService.budgetEffect(7L))
                .thenReturn(BudgetEffect.PENDING_RECONCILIATION);
        GenerationStreamService service = service();

        service.runImageStream(7L,
                new GenerationModelCapability().setProviderId("provider"),
                org.mockito.Mockito.mock(ProviderImageGenerationRequest.class));

        verify(costReservationService).finalizeProviderFailure(7L, true);
        ArgumentCaptor<SsePayload> payload = ArgumentCaptor.forClass(SsePayload.class);
        verify(bus).emit(eq(7L), payload.capture());
        assertThat(payload.getValue().errorMessage()).isEqualTo("图像生成失败");
        assertThat(payload.getValue().error())
                .containsEntry("code", "image_generation_failed")
                .containsEntry("message", "图像生成失败")
                .doesNotContainValue("provider credential secret");
    }

    private GenerationStreamService service() {
        return new GenerationStreamService(jobMapper, assetStorageService,
                providerRegistry, bus, projectEventService, costReservationService, transactionManager);
    }

    private GenerationJob processingJob() {
        GenerationJob job = new GenerationJob()
                .setProjectId(3L)
                .setUserId(10L)
                .setStatus(GenerationJob.STATUS_PROCESSING)
                .setOutputAssetIds(List.of());
        job.setId(7L);
        job.setVersion(1);
        return job;
    }
}
