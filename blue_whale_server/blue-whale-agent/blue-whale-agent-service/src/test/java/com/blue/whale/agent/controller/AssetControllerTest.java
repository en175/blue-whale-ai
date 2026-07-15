package com.blue.whale.agent.controller;

import com.blue.whale.agent.model.dto.AssetResponse;
import com.blue.whale.agent.model.dto.UploadAssetResponse;
import com.blue.whale.agent.service.AssetService;
import com.blue.whale.global.base.resp.Result;
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
import static org.mockito.Mockito.when;

/**
 * {@link AssetController} 单测：直调方法（非 @WebMvcTest），验证 {@code X-User-Id} 缺失 401
 * 与 {@link Result} 包装，不起 web 容器。{@link AssetService} 全 mock。
 */
@ExtendWith(MockitoExtension.class)
class AssetControllerTest {

    @Mock
    private AssetService assetService;

    private AssetController controller;

    @BeforeEach
    void setUp() {
        controller = new AssetController(assetService);
    }

    @Test
    void uploadThrowsWhenMissingUserId() {
        assertThatThrownBy(() -> controller.upload(null, 1L, "image", mock(MultipartFile.class)))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.UNAUTHORIZED_CODE);
    }

    @Test
    void uploadReturnsOkResult() {
        when(assetService.uploadAsset(eq(10L), eq(1L), any(), eq("image")))
                .thenReturn(new UploadAssetResponse(50L, "https://tos/x.png"));

        Result<UploadAssetResponse> result = controller.upload(10L, 1L, "image", mock(MultipartFile.class));

        assertThat(result.isSuccess()).isTrue();
        assertThat(result.getData().id()).isEqualTo(50L);
        assertThat(result.getData().url()).isEqualTo("https://tos/x.png");
    }

    @Test
    void getAssetThrowsWhenMissingUserId() {
        assertThatThrownBy(() -> controller.getAsset(null, 1L))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.UNAUTHORIZED_CODE);
    }

    @Test
    void getAssetReturnsOkResult() {
        AssetResponse dto = new AssetResponse(1L, 1L, "image", "https://tos/x", null, null, null, "uploaded", null);
        when(assetService.getAsset(10L, 1L)).thenReturn(dto);

        Result<AssetResponse> result = controller.getAsset(10L, 1L);

        assertThat(result.isSuccess()).isTrue();
        assertThat(result.getData().id()).isEqualTo(1L);
        assertThat(result.getData().projectId()).isEqualTo(1L);
    }

    @Test
    void listAssetsThrowsWhenMissingUserId() {
        assertThatThrownBy(() -> controller.listAssets(null, null, null, 1, 24))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.UNAUTHORIZED_CODE);
    }
}
