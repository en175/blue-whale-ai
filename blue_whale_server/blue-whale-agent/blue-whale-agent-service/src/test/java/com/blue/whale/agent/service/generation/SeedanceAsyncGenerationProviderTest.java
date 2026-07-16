package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.service.ProjectAssetAccessService;
import com.blue.whale.agent.service.generation.GenerationAdapterProperties.Seedance;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskResult;
import com.volcengine.ark.runtime.service.ArkService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SeedanceAsyncGenerationProviderTest {

    @Test
    @SuppressWarnings("unchecked")
    void missingLocalCredentialsIsAConfirmedPreProviderFailure() {
        ObjectProvider<ArkService> serviceProvider = mock(ObjectProvider.class);
        when(serviceProvider.getIfAvailable()).thenReturn(null);
        SeedanceAsyncGenerationProvider provider = new SeedanceAsyncGenerationProvider(
                serviceProvider,
                mock(ProjectAssetAccessService.class),
                new GenerationAdapterProperties());

        assertThatThrownBy(() -> provider.submit(new AsyncGenerationSpec(
                7L, 11L, "蓝鲸跃出海面", null,
                "16:9", "480p", 4,
                "https://callback.example.test/api/webhooks/seedance/a/9?capability=secret")))
                .isInstanceOf(ProviderSubmissionException.class)
                .satisfies(error -> {
                    ProviderSubmissionException failure = (ProviderSubmissionException) error;
                    assertThat(failure.isAmbiguous()).isFalse();
                    assertThat(failure.getRawCode()).isEqualTo("provider_not_configured");
                });
    }

    @Test
    @SuppressWarnings("unchecked")
    void submissionFreezesOfficialModelAndPassesCapabilityCallback() {
        ObjectProvider<ArkService> serviceProvider = mock(ObjectProvider.class);
        ArkService arkService = mock(ArkService.class);
        when(serviceProvider.getIfAvailable()).thenReturn(arkService);
        when(arkService.createContentGenerationTask(any(CreateContentGenerationTaskRequest.class)))
                .thenReturn(new CreateContentGenerationTaskResult("provider-task-1"));
        GenerationAdapterProperties properties = new GenerationAdapterProperties();
        properties.getSeedance().setAccountId("account-a");
        SeedanceAsyncGenerationProvider provider = new SeedanceAsyncGenerationProvider(
                serviceProvider, mock(ProjectAssetAccessService.class), properties);

        ProviderTaskReference reference = provider.submit(new AsyncGenerationSpec(
                7L, 11L, "蓝鲸跃出海面", null,
                "16:9", "480p", 4,
                "https://callback.example.test/api/webhooks/seedance/a/9?capability=secret"));

        assertThat(reference).isEqualTo(
                new ProviderTaskReference("seedance", "account-a", "provider-task-1"));
        ArgumentCaptor<CreateContentGenerationTaskRequest> requestCaptor =
                ArgumentCaptor.forClass(CreateContentGenerationTaskRequest.class);
        verify(arkService).createContentGenerationTask(requestCaptor.capture());
        CreateContentGenerationTaskRequest request = requestCaptor.getValue();
        assertThat(request.getModel()).isEqualTo(Seedance.MODEL);
        assertThat(request.getRatio()).isEqualTo("16:9");
        assertThat(request.getResolution()).isEqualTo("480p");
        assertThat(request.getDuration()).isEqualTo(4L);
        assertThat(request.getCallbackUrl()).contains("capability=secret");
        assertThat(request.getContent()).singleElement().satisfies(content -> {
            assertThat(content.getType()).isEqualTo("text");
            assertThat(content.getText()).isEqualTo("蓝鲸跃出海面");
        });
    }
}
