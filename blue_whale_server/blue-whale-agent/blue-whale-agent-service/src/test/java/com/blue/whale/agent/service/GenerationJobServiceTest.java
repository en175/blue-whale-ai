package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationModelCapabilityMapper;
import com.blue.whale.agent.model.dto.ImageGenerateRequest;
import com.blue.whale.agent.model.dto.ImageGenerationResult;
import com.blue.whale.agent.model.dto.JobStatusResponse;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.governance.BudgetEffect;
import com.blue.whale.agent.service.governance.AuthorizedGenerationAction;
import com.blue.whale.agent.service.provider.ImageGenerationProviderRegistry;
import com.blue.whale.agent.service.provider.ImageGenerationProvider;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.agent.service.governance.CostReservationService;
import com.blue.whale.agent.service.governance.GenerationCostAdmissionService;
import com.blue.whale.agent.service.governance.PriceQuote;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class GenerationJobServiceTest {

    @Mock private GenerationJobMapper jobMapper;
    @Mock private AssetMapper assetMapper;
    @Mock private AssetStorageService assetStorageService;
    @Mock private GenerationModelCapabilityMapper capabilityMapper;
    @Mock private ImageGenerationProviderRegistry providerRegistry;
    @Mock private GenerationStreamService generationStreamService;
    @Mock private ProjectEventService projectEventService;
    @Mock private ProjectService projectService;
    @Mock private GenerationCostAdmissionService costAdmissionService;
    @Mock private CostReservationService costReservationService;

    private GenerationJobService service;
    private DataSourceTransactionManager transactionManager;

    @BeforeEach
    void setUp() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:h2:mem:generation-job-service;DB_CLOSE_DELAY=-1", "sa", "");
        transactionManager = new DataSourceTransactionManager(dataSource);
        service = new GenerationJobService(jobMapper, assetMapper,
                assetStorageService, capabilityMapper, providerRegistry, generationStreamService,
                projectEventService, projectService, costAdmissionService, costReservationService,
                transactionManager);
    }

    @Test
    void confirmedLegacyGenerationUsesTheInputRequestContinuationIdentity() {
        GenerationModelCapability.SizeOption size = new GenerationModelCapability.SizeOption();
        size.setId("2k");
        size.setApiValue("2048x2048");
        GenerationModelCapability.Features features = new GenerationModelCapability.Features();
        features.setStream(true);
        features.setQuantityMax(1);
        GenerationModelCapability capability = new GenerationModelCapability()
                .setModelId("model")
                .setProviderId("provider")
                .setSupportedSizes(List.of(size))
                .setSupportedFormats(List.of())
                .setDefaultSize("2k")
                .setFeatures(features);
        when(capabilityMapper.selectEnabledByModelId("model")).thenReturn(Optional.of(capability));
        when(projectService.requireOwned(3L, 10L)).thenReturn(new Project().setOwnerId(10L));
        when(costAdmissionService.authorizeRequest(
                org.mockito.ArgumentMatchers.eq(10L), org.mockito.ArgumentMatchers.eq(3L),
                org.mockito.ArgumentMatchers.eq("LegacyGenerationRequest"), nullable(String.class),
                isNull(),
                org.mockito.ArgumentMatchers.eq("generate_image"), any(),
                org.mockito.ArgumentMatchers.eq(false), org.mockito.ArgumentMatchers.eq(99L)))
                .thenReturn(new AuthorizedGenerationAction(
                        "legacy-action", new PriceQuote(
                        25L, "provider", "price-v1", "fx-v1", "model-v1")));
        when(jobMapper.insert(any(GenerationJob.class))).thenAnswer(invocation -> {
            GenerationJob job = invocation.getArgument(0);
            job.setId(7L);
            job.setVersion(0);
            return 1;
        });
        ImageGenerateRequest request = new ImageGenerateRequest(
                "prompt", "model", "2k", "1:1", null, 1, false, List.<String>of(), 3L);

        service.createImageJob(request, 10L, 99L);

        ArgumentCaptor<GenerationJob> inserted = ArgumentCaptor.forClass(GenerationJob.class);
        verify(jobMapper).insert(inserted.capture());
        assertThat(inserted.getValue().getProjectId()).isEqualTo(3L);
        verify(projectService).requireOwned(3L, 10L);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> admissionArguments = ArgumentCaptor.forClass(Map.class);
        verify(costAdmissionService).authorizeRequest(
                org.mockito.ArgumentMatchers.eq(10L), org.mockito.ArgumentMatchers.eq(3L),
                org.mockito.ArgumentMatchers.eq("LegacyGenerationRequest"), nullable(String.class),
                isNull(),
                org.mockito.ArgumentMatchers.eq("generate_image"), admissionArguments.capture(),
                org.mockito.ArgumentMatchers.eq(false), org.mockito.ArgumentMatchers.eq(99L));
        assertThat(admissionArguments.getValue()).containsEntry("_cost_provider", "provider");
        verify(costAdmissionService).reserveAuthorized(
                org.mockito.ArgumentMatchers.eq(10L), org.mockito.ArgumentMatchers.eq(3L),
                org.mockito.ArgumentMatchers.eq(7L), org.mockito.ArgumentMatchers.eq("legacy-action"),
                org.mockito.ArgumentMatchers.eq("generate_image"), any());
        verify(projectEventService, times(2)).appendEvent(
                org.mockito.ArgumentMatchers.eq(3L), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void failedJobStatusReturnsSafeErrorEnvelopeWithBudgetEffect() {
        GenerationJob job = new GenerationJob();
        job.setId(7L);
        job.setUserId(10L)
                .setProjectId(3L)
                .setType(GenerationJob.TYPE_VIDEO)
                .setStatus(GenerationJob.STATUS_FAILED)
                .setProgress(40)
                .setError(Map.of("code", "submission_unknown", "message", "provider secret"));
        when(jobMapper.selectById(7L)).thenReturn(job);
        when(costReservationService.budgetEffect(7L))
                .thenReturn(BudgetEffect.PENDING_RECONCILIATION);

        JobStatusResponse response = service.getJobStatus(7L, 10L);

        assertThat(response.error()).containsEntry("code", "submission_unknown")
                .containsEntry("message", "无法确认视频任务是否已提交")
                .containsEntry("retryable", false)
                .containsEntry("budget_effect", "pending_reconciliation")
                .containsKeys("retry_after_seconds", "request_id", "input_request_id");
        assertThat(response.error()).doesNotContainValue("provider secret");
    }

    @Test
    void providerResolutionFailureReleasesReservationBeforePaidCall() {
        GenerationModelCapability.SizeOption size = new GenerationModelCapability.SizeOption();
        size.setId("2k");
        size.setApiValue("2048x2048");
        GenerationModelCapability.Features features = new GenerationModelCapability.Features();
        features.setStream(false);
        features.setQuantityMax(1);
        GenerationModelCapability capability = new GenerationModelCapability()
                .setModelId("model")
                .setProviderId("provider")
                .setSupportedSizes(List.of(size))
                .setSupportedFormats(List.of())
                .setDefaultSize("2k")
                .setFeatures(features);
        when(capabilityMapper.selectEnabledByModelId("model")).thenReturn(Optional.of(capability));
        when(projectService.requireOwned(3L, 10L)).thenReturn(new Project().setOwnerId(10L));
        when(costAdmissionService.authorizeRequest(
                org.mockito.ArgumentMatchers.eq(10L), org.mockito.ArgumentMatchers.eq(3L),
                org.mockito.ArgumentMatchers.eq("LegacyGenerationRequest"), any(), any(),
                org.mockito.ArgumentMatchers.eq("generate_image"), any(),
                org.mockito.ArgumentMatchers.eq(false), org.mockito.ArgumentMatchers.isNull()))
                .thenReturn(new AuthorizedGenerationAction(
                        "legacy-action", new PriceQuote(
                        25L, "provider", "price-v1", "fx-v1", "model-v1")));
        when(jobMapper.insert(any(GenerationJob.class))).thenAnswer(invocation -> {
            GenerationJob inserted = invocation.getArgument(0);
            inserted.setId(7L);
            inserted.setVersion(0);
            return 1;
        });
        when(providerRegistry.getProvider("provider"))
                .thenThrow(new IllegalStateException("provider registry secret"));
        ImageGenerateRequest request = new ImageGenerateRequest(
                "prompt", "model", "2k", "1:1", null, 1, false, List.of(), 3L);

        assertThatThrownBy(() -> service.createImageJob(request, 10L, null))
                .isInstanceOf(GlobalException.class)
                .hasMessage("图像生成失败");

        verify(costReservationService).finalizeProviderFailure(7L, false);
    }

    @Test
    void providerReadinessFailureReleasesReservationBeforePaidCall() {
        GenerationModelCapability.SizeOption size = new GenerationModelCapability.SizeOption();
        size.setId("2k");
        size.setApiValue("2048x2048");
        GenerationModelCapability.Features features = new GenerationModelCapability.Features();
        features.setStream(false);
        features.setQuantityMax(1);
        GenerationModelCapability capability = new GenerationModelCapability()
                .setModelId("model")
                .setProviderId("provider")
                .setSupportedSizes(List.of(size))
                .setSupportedFormats(List.of())
                .setDefaultSize("2k")
                .setFeatures(features);
        when(capabilityMapper.selectEnabledByModelId("model")).thenReturn(Optional.of(capability));
        when(projectService.requireOwned(3L, 10L)).thenReturn(new Project().setOwnerId(10L));
        when(costAdmissionService.authorizeRequest(
                org.mockito.ArgumentMatchers.eq(10L), org.mockito.ArgumentMatchers.eq(3L),
                org.mockito.ArgumentMatchers.eq("LegacyGenerationRequest"), any(), any(),
                org.mockito.ArgumentMatchers.eq("generate_image"), any(),
                org.mockito.ArgumentMatchers.eq(false), org.mockito.ArgumentMatchers.isNull()))
                .thenReturn(new AuthorizedGenerationAction(
                        "legacy-action", new PriceQuote(
                        25L, "provider", "price-v1", "fx-v1", "model-v1")));
        when(jobMapper.insert(any(GenerationJob.class))).thenAnswer(invocation -> {
            GenerationJob inserted = invocation.getArgument(0);
            inserted.setId(7L);
            inserted.setVersion(0);
            return 1;
        });
        ImageGenerationProvider provider = org.mockito.Mockito.mock(ImageGenerationProvider.class);
        when(providerRegistry.getProvider("provider")).thenReturn(provider);
        doThrow(new GlobalException("ARK_API_KEY 未配置")).when(provider).requireReady();
        ImageGenerateRequest request = new ImageGenerateRequest(
                "prompt", "model", "2k", "1:1", null, 1, false, List.of(), 3L);

        assertThatThrownBy(() -> service.createImageJob(request, 10L, null))
                .isInstanceOf(GlobalException.class)
                .hasMessage("图像生成失败");

        verify(provider, never()).generate(any());
        verify(costReservationService).finalizeProviderFailure(7L, false);
    }

    @Test
    void paidProviderAndMediaTransferRunOutsideDatabaseTransaction() {
        GenerationModelCapability.SizeOption size = new GenerationModelCapability.SizeOption();
        size.setId("2k");
        size.setApiValue("2048x2048");
        GenerationModelCapability.Features features = new GenerationModelCapability.Features();
        features.setStream(false);
        features.setQuantityMax(1);
        GenerationModelCapability capability = new GenerationModelCapability()
                .setModelId("model")
                .setProviderId("provider")
                .setSupportedSizes(List.of(size))
                .setSupportedFormats(List.of())
                .setDefaultSize("2k")
                .setFeatures(features);
        when(capabilityMapper.selectEnabledByModelId("model")).thenReturn(Optional.of(capability));
        when(projectService.requireOwned(3L, 10L)).thenReturn(new Project().setOwnerId(10L));
        when(costAdmissionService.authorizeRequest(
                org.mockito.ArgumentMatchers.eq(10L), org.mockito.ArgumentMatchers.eq(3L),
                org.mockito.ArgumentMatchers.eq("LegacyGenerationRequest"), any(), any(),
                org.mockito.ArgumentMatchers.eq("generate_image"), any(),
                org.mockito.ArgumentMatchers.eq(false), org.mockito.ArgumentMatchers.isNull()))
                .thenReturn(new AuthorizedGenerationAction(
                        "legacy-action", new PriceQuote(
                        25L, "provider", "price-v1", "fx-v1", "model-v1")));
        when(jobMapper.insert(any(GenerationJob.class))).thenAnswer(invocation -> {
            GenerationJob inserted = invocation.getArgument(0);
            inserted.setId(7L);
            inserted.setVersion(0);
            return 1;
        });
        ImageGenerationProvider provider = org.mockito.Mockito.mock(ImageGenerationProvider.class);
        when(providerRegistry.getProvider("provider")).thenReturn(provider);
        AtomicBoolean providerTransactionActive = new AtomicBoolean();
        when(provider.generate(any())).thenAnswer(invocation -> {
            providerTransactionActive.set(
                    TransactionSynchronizationManager.isActualTransactionActive());
            return new ImageGenerationResult("https://provider.invalid/image.png");
        });
        AtomicBoolean mediaTransactionActive = new AtomicBoolean();
        when(assetStorageService.downloadAndStore(any(), any(), any(), any())).thenAnswer(invocation -> {
            mediaTransactionActive.set(
                    TransactionSynchronizationManager.isActualTransactionActive());
            Asset asset = new Asset().setUrl("/assets/image.png");
            asset.setId(8L);
            return asset;
        });

        ProxyFactory proxyFactory = new ProxyFactory(service);
        proxyFactory.addAdvice(new TransactionInterceptor(
                transactionManager, new AnnotationTransactionAttributeSource()));
        GenerationJobService proxied = (GenerationJobService) proxyFactory.getProxy();
        ImageGenerateRequest request = new ImageGenerateRequest(
                "prompt", "model", "2k", "1:1", null, 1, false, List.of(), 3L);

        proxied.createImageJob(request, 10L, null);

        assertThat(providerTransactionActive).isFalse();
        assertThat(mediaTransactionActive).isFalse();
    }
}
