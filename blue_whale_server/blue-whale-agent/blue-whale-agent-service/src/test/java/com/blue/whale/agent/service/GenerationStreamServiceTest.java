package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.model.dto.ProviderImageGenerationRequest;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import com.blue.whale.agent.service.provider.ImageGenerationProvider;
import com.blue.whale.agent.service.provider.ImageGenerationProviderRegistry;
import io.reactivex.Flowable;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
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
                providerRegistry, bus, projectEventService, transactionManager);

        service.runImageStream(7L, capability, org.mockito.Mockito.mock(ProviderImageGenerationRequest.class));

        verify(projectEventService).appendEvent(eq(3L), eq("generation_job.status_changed"),
                eq("generation_job"), eq("7"), any(), any(), any(), any());
        verify(transactionManager).commit(transactionStatus);
    }
}
