package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.model.dto.GenerationFailureCommand;
import com.blue.whale.agent.model.dto.GenerationJobClaim;
import com.blue.whale.agent.service.GenerationJobClaimService;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GenerationWorkerTest {

    @Test
    void storageFailureIsAcceptedAsStableJobFailure() {
        GenerationJobClaimService claimService = mock(GenerationJobClaimService.class);
        GenerationResultAcceptanceService acceptanceService = mock(GenerationResultAcceptanceService.class);
        GenerationProvider provider = mock(GenerationProvider.class);
        GenerationStorage storage = mock(GenerationStorage.class);
        GenerationJobClaim claim = new GenerationJobClaim(
                5L, 7L, 11L, 3, 9L, "worker-1", Map.of("prompt", "whale"));
        when(claimService.claim("worker-1")).thenReturn(claim);
        when(provider.generate(new GenerationProviderRequest(7L, 11L, claim.input())))
                .thenReturn(GenerationProviderResult.success(new byte[]{1}, "image/png", 1, 1));
        PreparedGenerationObject prepared = new PreparedGenerationObject(
                "test/key", "0".repeat(64), "image/png", 1);
        when(storage.prepare(any(byte[].class), eq("image/png"))).thenReturn(prepared);
        when(storage.store(eq(prepared), any(byte[].class)))
                .thenThrow(new IllegalStateException("tos secret detail"));
        GenerationWorker worker = new GenerationWorker(claimService, acceptanceService, provider, storage);

        assertThat(worker.runOnce("worker-1")).isTrue();

        ArgumentCaptor<GenerationFailureCommand> captor =
                ArgumentCaptor.forClass(GenerationFailureCommand.class);
        verify(acceptanceService).acceptFailure(captor.capture());
        assertThat(captor.getValue().errorCode()).isEqualTo("storage_failed");
        assertThat(captor.getValue().errorMessage()).doesNotContain("tos secret detail");
    }
}
