package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.dto.AssetResponse;
import com.blue.whale.agent.model.dto.UploadAssetResponse;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.multipart.MultipartFile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link AssetService} 单测：上传中转（uploadAsset，归属/类型/大小校验）+ 按 id 取资产（getAsset，归属校验）。
 * 全 mock {@link AssetStorageService} + {@link ProjectService} + {@link AssetMapper}。
 */
@ExtendWith(MockitoExtension.class)
class AssetServiceTest {

    @Mock
    private AssetMapper assetMapper;
    @Mock
    private AssetStorageService assetStorageService;
    @Mock
    private ProjectService projectService;

    private AssetService assetService;

    @BeforeEach
    void setUp() {
        assetService = new AssetService(assetMapper, assetStorageService, projectService);
    }

    @Test
    void uploadAssetStoresAndReturnsIdUrl() {
        Asset stored = new Asset().setUrl("https://tos/x.png");
        stored.setId(50L);
        when(assetStorageService.storeUploaded(any(), eq(10L), eq(1L), eq("image"))).thenReturn(stored);
        MultipartFile file = mock(MultipartFile.class);
        when(file.getContentType()).thenReturn("image/png");
        when(file.getSize()).thenReturn(1024L);

        UploadAssetResponse resp = assetService.uploadAsset(10L, 1L, file, "image");

        verify(projectService).requireOwned(1L, 10L);
        assertThat(resp.id()).isEqualTo(50L);
        assertThat(resp.url()).isEqualTo("https://tos/x.png");
    }

    @Test
    void uploadAssetPropagatesOwnershipViolation() {
        when(projectService.requireOwned(1L, 999L))
                .thenThrow(new GlobalException(SystemCode.DATA_NO_PERMISSION_OPERATE_CODE, "无权限"));
        MultipartFile file = mock(MultipartFile.class);

        assertThatThrownBy(() -> assetService.uploadAsset(999L, 1L, file, "image"))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.DATA_NO_PERMISSION_OPERATE_CODE);
        verify(assetStorageService, never()).storeUploaded(any(), any(), any(), any());
    }

    @Test
    void uploadAssetRejectsInvalidType() {
        MultipartFile file = mock(MultipartFile.class);

        assertThatThrownBy(() -> assetService.uploadAsset(10L, 1L, file, "audio"))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.PARAM_VALID_ERROR_CODE);
        verify(assetStorageService, never()).storeUploaded(any(), any(), any(), any());
    }

    @Test
    void uploadAssetRejectsMimeMismatch() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getContentType()).thenReturn("video/mp4");

        assertThatThrownBy(() -> assetService.uploadAsset(10L, 1L, file, "image"))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.PARAM_VALID_ERROR_CODE);
    }

    @Test
    void uploadAssetRejectsOversize() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getContentType()).thenReturn("image/png");
        when(file.getSize()).thenReturn(3 * 1024 * 1024L);

        assertThatThrownBy(() -> assetService.uploadAsset(10L, 1L, file, "image"))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.PARAM_VALID_ERROR_CODE);
    }

    @Test
    void getAssetReturnsDtoWhenOwned() {
        Asset a = new Asset().setUserId(10L).setProjectId(1L)
                .setType("image").setUrl("https://tos/x").setSource("uploaded");
        a.setId(1L);
        when(assetMapper.selectById(1L)).thenReturn(a);

        AssetResponse resp = assetService.getAsset(10L, 1L);

        assertThat(resp.id()).isEqualTo(1L);
        assertThat(resp.projectId()).isEqualTo(1L);
        assertThat(resp.url()).isEqualTo("https://tos/x");
    }

    @Test
    void getAssetThrowsWhenNotExist() {
        when(assetMapper.selectById(99L)).thenReturn(null);

        assertThatThrownBy(() -> assetService.getAsset(10L, 99L))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.DATA_NOT_EXIST_CODE);
    }

    @Test
    void getAssetThrowsWhenNotOwned() {
        Asset a = new Asset().setUserId(10L);
        a.setId(1L);
        when(assetMapper.selectById(1L)).thenReturn(a);

        assertThatThrownBy(() -> assetService.getAsset(999L, 1L))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.DATA_NO_PERMISSION_OPERATE_CODE);
    }
}
