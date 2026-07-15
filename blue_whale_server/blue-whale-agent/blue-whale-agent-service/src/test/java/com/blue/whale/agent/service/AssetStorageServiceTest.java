package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.upload.model.OssConfig;
import com.blue.whale.tool.upload.service.AbstractStorageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link AssetStorageService} 单测：转存（downloadAndStore）+ 上传中转（storeUploaded）切 TOS。
 * 全 mock {@link AbstractStorageService} + {@link AssetMapper}，不连 TOS / DB。
 * {@code download} 用 Testable 子类 override，避免发真网络请求。
 */
@ExtendWith(MockitoExtension.class)
class AssetStorageServiceTest {

    @Mock
    private AssetMapper assetMapper;
    @Mock
    private AbstractStorageService storageService;

    private TestableAssetStorageService service;

    @BeforeEach
    void setUp() {
        service = new TestableAssetStorageService(assetMapper, storageService);
        service.fakeBytes = new byte[]{1, 2, 3};
    }

    @Test
    void downloadAndStoreUploadsToTosAndInsertsAsset() {
        when(storageService.upload(any(byte[].class), anyString()))
                .thenReturn("https://bluewhale-assets.tos-cn-beijing.volces.com/assets/1/image/uuid.png");
        when(assetMapper.insert(any(Asset.class))).thenAnswer(inv -> {
            ((Asset) inv.getArgument(0)).setId(100L);
            return 1;
        });

        Asset asset = service.downloadAndStore("https://volc.com/x.png", 10L, 1L, Asset.TYPE_IMAGE, null);

        ArgumentCaptor<Asset> captor = ArgumentCaptor.forClass(Asset.class);
        verify(storageService).upload(eq(service.fakeBytes),
                argThat(path -> path.startsWith("assets/1/image/") && path.endsWith(".png")));
        verify(assetMapper).insert(captor.capture());
        Asset saved = captor.getValue();
        assertThat(saved.getUserId()).isEqualTo(10L);
        assertThat(saved.getProjectId()).isEqualTo(1L);
        assertThat(saved.getType()).isEqualTo("image");
        assertThat(saved.getStorageKey()).startsWith("assets/1/image/");
        assertThat(saved.getUrl()).startsWith("https://bluewhale-assets");
        assertThat(saved.getSource()).isEqualTo(Asset.SOURCE_GENERATED);
        assertThat(saved.getStatus()).isEqualTo(Asset.STATUS_NORMAL);
        assertThat(saved.getSize()).isEqualTo(3L);
        assertThat(saved.getMime()).isEqualTo("image/png");
        assertThat(asset.getId()).isEqualTo(100L);
    }

    @Test
    void downloadAndStoreUsesExplicitMimeForVideo() {
        when(storageService.upload(any(byte[].class), anyString())).thenReturn("https://tos/v.mp4");
        when(assetMapper.insert(any(Asset.class))).thenReturn(1);

        service.downloadAndStore("https://volc.com/task/abc", 10L, 1L, Asset.TYPE_VIDEO, "video/mp4");

        verify(storageService).upload(any(byte[].class),
                argThat(path -> path.startsWith("assets/1/video/") && path.endsWith(".mp4")));
    }

    @Test
    void downloadAndStoreThrowsWhenTosDisabled() {
        TestableAssetStorageService noTos = new TestableAssetStorageService(assetMapper, null);

        assertThatThrownBy(() -> noTos.downloadAndStore("https://x", 10L, 1L, "image", null))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.ASSET_UNAVAILABLE_CODE);
        verify(assetMapper, never()).insert(any(Asset.class));
    }

    @Test
    void downloadAndStoreThrowsWhenProjectIdNull() {
        assertThatThrownBy(() -> service.downloadAndStore("https://x", 10L, null, "image", null))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.PARAM_VALID_ERROR_CODE);
        verify(storageService, never()).upload(any(byte[].class), anyString());
    }

    @Test
    void downloadAndStorePropagatesTosUploadError() {
        when(storageService.upload(any(byte[].class), anyString()))
                .thenThrow(new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "TOS 500"));

        assertThatThrownBy(() -> service.downloadAndStore("https://x", 10L, 1L, "image", null))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.ASSET_UNAVAILABLE_CODE);
        verify(assetMapper, never()).insert(any(Asset.class));
    }

    @Test
    void storeUploadedInsertsAssetWithSourceUploaded() throws IOException {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getContentType()).thenReturn("image/png");
        when(file.getBytes()).thenReturn(new byte[]{4, 5});
        when(storageService.upload(any(byte[].class), anyString())).thenReturn("https://tos/x.png");
        when(assetMapper.insert(any(Asset.class))).thenAnswer(inv -> {
            ((Asset) inv.getArgument(0)).setId(200L);
            return 1;
        });

        Asset asset = service.storeUploaded(file, 10L, 1L, Asset.TYPE_IMAGE);

        ArgumentCaptor<Asset> captor = ArgumentCaptor.forClass(Asset.class);
        verify(assetMapper).insert(captor.capture());
        assertThat(captor.getValue().getSource()).isEqualTo(Asset.SOURCE_UPLOADED);
        assertThat(captor.getValue().getProjectId()).isEqualTo(1L);
        assertThat(captor.getValue().getMime()).isEqualTo("image/png");
        assertThat(captor.getValue().getSize()).isEqualTo(2L);
        assertThat(asset.getId()).isEqualTo(200L);
    }

    @Test
    void storeUploadedThrowsWhenTosDisabled() {
        TestableAssetStorageService noTos = new TestableAssetStorageService(assetMapper, null);

        assertThatThrownBy(() -> noTos.storeUploaded(mock(MultipartFile.class), 10L, 1L, "image"))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.ASSET_UNAVAILABLE_CODE);
    }

    @Test
    void downloadAndStorePrefixesPathWithConfiguredPrefix() {
        OssConfig cfg = new OssConfig();
        cfg.setPrefix("blue-whale");
        TestableAssetStorageService withPrefix = new TestableAssetStorageService(assetMapper, storageService, cfg);
        withPrefix.fakeBytes = new byte[]{1};
        when(storageService.upload(any(byte[].class), anyString())).thenReturn("https://tos/x.png");
        when(assetMapper.insert(any(Asset.class))).thenReturn(1);

        withPrefix.downloadAndStore("https://volc.com/x.png", 10L, 1L, Asset.TYPE_IMAGE, null);

        verify(storageService).upload(any(byte[].class),
                argThat(path -> path.startsWith("blue-whale/assets/1/image/") && path.endsWith(".png")));
    }

    /** Testable：override download 返假 bytes，避免单测发真网络请求。ossConfig 可选注入测 prefix。 */
    static class TestableAssetStorageService extends AssetStorageService {
        byte[] fakeBytes = new byte[0];

        TestableAssetStorageService(AssetMapper mapper, AbstractStorageService storageService) {
            this(mapper, storageService, null);
        }

        TestableAssetStorageService(AssetMapper mapper, AbstractStorageService storageService, OssConfig ossConfig) {
            super(mapper, storageService, ossConfig);
        }

        @Override
        protected byte[] download(String sourceUrl) {
            return fakeBytes;
        }
    }
}
