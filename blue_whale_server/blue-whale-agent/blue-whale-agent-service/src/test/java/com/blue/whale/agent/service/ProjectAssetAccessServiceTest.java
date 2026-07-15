package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.service.generation.GenerationObjectSigner;
import com.blue.whale.agent.service.generation.SignedGenerationObject;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ProjectAssetAccessServiceTest {

    private ProjectService projectService;
    private AssetMapper assetMapper;
    private GenerationObjectSigner signer;
    private ObjectProvider<GenerationObjectSigner> signerProvider;
    private ProjectAssetAccessService accessService;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        projectService = mock(ProjectService.class);
        assetMapper = mock(AssetMapper.class);
        signer = mock(GenerationObjectSigner.class);
        signerProvider = mock(ObjectProvider.class);
        when(signerProvider.getIfAvailable()).thenReturn(signer);
        accessService = new ProjectAssetAccessService(projectService, assetMapper, signerProvider);
    }

    @Test
    void signsOwnedNormalAssetWithoutPersistingUrl() {
        Asset asset = new Asset()
                .setProjectId(7L)
                .setUserId(11L)
                .setStorageKey("generation/sha256/a.png")
                .setStatus(Asset.STATUS_NORMAL);
        when(assetMapper.selectById(91L)).thenReturn(asset);
        SignedGenerationObject expected = new SignedGenerationObject(
                "https://tos.example/signed", Instant.parse("2026-07-15T04:02:00Z"));
        when(signer.sign("generation/sha256/a.png")).thenReturn(expected);

        SignedGenerationObject actual = accessService.sign(7L, 91L, 11L);

        assertThat(actual).isEqualTo(expected);
        assertThat(asset.getUrl()).isNull();
        verify(projectService).requireOwned(7L, 11L);
        verify(signer).sign("generation/sha256/a.png");
    }

    @Test
    void rejectsAssetFromAnotherProjectBeforeSigning() {
        when(assetMapper.selectById(91L)).thenReturn(new Asset()
                .setProjectId(8L)
                .setUserId(11L)
                .setStorageKey("generation/sha256/a.png")
                .setStatus(Asset.STATUS_NORMAL));

        assertThatThrownBy(() -> accessService.sign(7L, 91L, 11L))
                .isInstanceOfSatisfying(GlobalException.class,
                        exception -> assertThat(exception.getCode())
                                .isEqualTo(SystemCode.RESOURCE_NOT_FOUND_CODE));
        verifyNoInteractions(signer);
    }

    @Test
    void rejectsAssetOwnedByAnotherUserBeforeSigning() {
        when(assetMapper.selectById(91L)).thenReturn(new Asset()
                .setProjectId(7L)
                .setUserId(12L)
                .setStorageKey("generation/sha256/a.png")
                .setStatus(Asset.STATUS_NORMAL));

        assertThatThrownBy(() -> accessService.sign(7L, 91L, 11L))
                .isInstanceOfSatisfying(GlobalException.class,
                        exception -> assertThat(exception.getCode())
                                .isEqualTo(SystemCode.RESOURCE_NOT_FOUND_CODE));
        verifyNoInteractions(signer);
    }

    @Test
    void failsClosedWhenPrivateStorageSignerIsDisabled() {
        when(assetMapper.selectById(91L)).thenReturn(new Asset()
                .setProjectId(7L)
                .setUserId(11L)
                .setStorageKey("generation/sha256/a.png")
                .setStatus(Asset.STATUS_NORMAL));
        when(signerProvider.getIfAvailable()).thenReturn(null);

        assertThatThrownBy(() -> accessService.sign(7L, 91L, 11L))
                .isInstanceOfSatisfying(GlobalException.class,
                        exception -> assertThat(exception.getCode())
                                .isEqualTo(SystemCode.ASSET_UNAVAILABLE_CODE));
    }

    @Test
    void mapsSigningFailureToAssetUnavailable() {
        when(assetMapper.selectById(91L)).thenReturn(new Asset()
                .setProjectId(7L)
                .setUserId(11L)
                .setStorageKey("generation/sha256/a.png")
                .setStatus(Asset.STATUS_NORMAL));
        when(signer.sign("generation/sha256/a.png"))
                .thenThrow(new IllegalStateException("sdk secret detail"));

        assertThatThrownBy(() -> accessService.sign(7L, 91L, 11L))
                .isInstanceOfSatisfying(GlobalException.class,
                        exception -> {
                            assertThat(exception.getCode()).isEqualTo(SystemCode.ASSET_UNAVAILABLE_CODE);
                            assertThat(exception.getMessage()).doesNotContain("sdk secret detail");
                        });
    }
}
