package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.model.dto.AssetObjectDeletionClaim;
import com.blue.whale.agent.service.AssetObjectLifecycleService;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AssetObjectGarbageCollectorTest {

    @Test
    void storageFailureReleasesDeletionClaim() {
        AssetObjectLifecycleService lifecycle = mock(AssetObjectLifecycleService.class);
        GenerationObjectDeletionStorage storage = mock(GenerationObjectDeletionStorage.class);
        AssetObjectDeletionClaim claim = new AssetObjectDeletionClaim(1L, "asset/key", "gc-worker");
        when(lifecycle.claimDeletion("gc-worker")).thenReturn(claim);
        doThrow(new IllegalStateException("storage unavailable"))
                .when(storage).delete(claim.storageKey());

        AssetObjectGarbageCollector collector = new AssetObjectGarbageCollector(lifecycle, storage);

        assertThatThrownBy(() -> collector.runOnce("gc-worker"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("storage unavailable");
        verify(lifecycle).releaseDeletion(claim);
        verify(lifecycle, never()).completeDeletion(claim);
    }

    @Test
    void databaseCompletionFailureKeepsDeletionClaimLeased() {
        AssetObjectLifecycleService lifecycle = mock(AssetObjectLifecycleService.class);
        GenerationObjectDeletionStorage storage = mock(GenerationObjectDeletionStorage.class);
        AssetObjectDeletionClaim claim = new AssetObjectDeletionClaim(1L, "asset/key", "gc-worker");
        when(lifecycle.claimDeletion("gc-worker")).thenReturn(claim);
        doThrow(new IllegalStateException("database unavailable"))
                .when(lifecycle).completeDeletion(claim);

        AssetObjectGarbageCollector collector = new AssetObjectGarbageCollector(lifecycle, storage);

        assertThatThrownBy(() -> collector.runOnce("gc-worker"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("database unavailable");
        verify(storage).delete(claim.storageKey());
        verify(lifecycle, never()).releaseDeletion(claim);
    }
}
