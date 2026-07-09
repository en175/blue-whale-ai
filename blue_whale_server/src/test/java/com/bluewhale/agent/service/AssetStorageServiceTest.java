package com.bluewhale.agent.service;

import com.bluewhale.agent.common.exception.GlobalException;
import com.bluewhale.agent.mapper.AssetMapper;
import com.bluewhale.agent.model.entity.Asset;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link AssetStorageService} 测试：用 {@code file://} 临时文件模拟下载，验落盘 + asset 字段 + insert 调用。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AssetStorageServiceTest {

    @Mock
    private AssetMapper assetMapper;

    @InjectMocks
    private AssetStorageService service;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(service, "storageDir", tempDir.toString());
        ReflectionTestUtils.setField(service, "urlPrefix", "/assets");
        when(assetMapper.insert(any(Asset.class))).thenAnswer(inv -> {
            ((Asset) inv.getArgument(0)).setId(1L);
            return 1;
        });
    }

    @Test
    void downloadAndStoreWritesFileAndInsertsAsset() throws Exception {
        Path source = tempDir.resolve("src.mp4");
        Files.writeString(source, "video-bytes");

        Asset asset = service.downloadAndStore(source.toUri().toString(), 7L, Asset.TYPE_VIDEO, "video/mp4");

        assertThat(asset.getUserId()).isEqualTo(7L);
        assertThat(asset.getType()).isEqualTo(Asset.TYPE_VIDEO);
        assertThat(asset.getMime()).isEqualTo("video/mp4");
        assertThat(asset.getSize()).isEqualTo(Files.size(source));
        assertThat(asset.getUrl()).startsWith("/assets/");
        assertThat(asset.getUrl()).endsWith(".mp4");
        assertThat(asset.getSource()).isEqualTo(Asset.SOURCE_GENERATED);

        ArgumentCaptor<Asset> captor = ArgumentCaptor.forClass(Asset.class);
        verify(assetMapper).insert(captor.capture());
        assertThat(captor.getValue().getStorageKey()).endsWith(".mp4");
    }

    @Test
    void downloadAndStoreImageUsesPngExtension() throws Exception {
        Path source = tempDir.resolve("src.png");
        Files.writeString(source, "png-bytes");

        Asset asset = service.downloadAndStore(source.toUri().toString(), 7L, Asset.TYPE_IMAGE, "image/png");
        assertThat(asset.getUrl()).endsWith(".png");
    }

    @Test
    void downloadFailsThrowsAssetUnavailable() {
        assertThatThrownBy(() -> service.downloadAndStore("http://invalid..invalid.invalid/x", 7L, Asset.TYPE_VIDEO, "video/mp4"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("资源下载转存失败");
    }
}
