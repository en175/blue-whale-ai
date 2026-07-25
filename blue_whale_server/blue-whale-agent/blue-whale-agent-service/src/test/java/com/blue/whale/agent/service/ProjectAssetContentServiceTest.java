package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.service.generation.GenerationObjectReader;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ProjectAssetContentServiceTest {

    @Test
    void mapsPrivateStorageReadFailureToAssetUnavailable() {
        ProjectService projectService = mock(ProjectService.class);
        AssetMapper assetMapper = mock(AssetMapper.class);
        GenerationObjectReader reader = mock(GenerationObjectReader.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<GenerationObjectReader> readerProvider = mock(ObjectProvider.class);
        when(readerProvider.getIfAvailable()).thenReturn(reader);
        when(assetMapper.selectById(91L)).thenReturn(new Asset()
                .setProjectId(7L)
                .setUserId(11L)
                .setStorageKey("generation/sha256/a.png")
                .setStatus(Asset.STATUS_NORMAL));
        when(reader.read("generation/sha256/a.png"))
                .thenThrow(new IllegalStateException("sdk secret detail"));
        ProjectAssetContentService contentService =
                new ProjectAssetContentService(projectService, assetMapper, readerProvider);

        assertThatThrownBy(() -> contentService.read(7L, 91L, 11L))
                .isInstanceOfSatisfying(GlobalException.class,
                        exception -> {
                            assertThat(exception.getCode()).isEqualTo(SystemCode.ASSET_UNAVAILABLE_CODE);
                            assertThat(exception.getMessage()).doesNotContain("sdk secret detail");
                        });
    }
}
