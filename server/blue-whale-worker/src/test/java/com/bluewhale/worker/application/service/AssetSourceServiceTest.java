package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AssetSourceResolverTest {

    @Mock
    private AssetMapper assetMapper;

    private AssetEntity asset(String storageKey) {
        AssetEntity a = new AssetEntity();
        a.setStorageKey(storageKey);
        a.setUrl("https://bucket.tos.example/v.mp4");
        a.setMime("video/mp4");
        return a;
    }

    @Test
    @DisplayName("IKDD4Z：linked 关联 id 必须透传给归属查询（asset-ops.ts:84,92）")
    void passesLinkedIdsToOwnershipQuery() {
        when(assetMapper.findLinkedAssetIds(9L, 42L)).thenReturn(List.of(777L, 888L));
        when(assetMapper.resolveSourceAssetWithLinked(555L, 9L, 42L, List.of(777L, 888L)))
                .thenReturn(asset("videos/v.mp4"));

        assertThat(new AssetSourceService(assetMapper).resolve(555L, 9L, 42L)).isNotNull();
        verify(assetMapper).findLinkedAssetIds(9L, 42L);
    }

    @Test
    @DisplayName("行不存在 → null（source_asset_unavailable）")
    void missingRowReturnsNull() {
        when(assetMapper.findLinkedAssetIds(anyLong(), anyLong())).thenReturn(List.of());
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(null);

        assertThat(new AssetSourceService(assetMapper).resolve(555L, 9L, 42L)).isNull();
    }

    @Test
    @DisplayName("storage_key 为 null（passthrough 残留行）→ 判不可用，禁止拉上游过期签名 URL（asset-ops.ts:99）")
    void nullStorageKeyTreatedAsUnavailable() {
        when(assetMapper.findLinkedAssetIds(anyLong(), anyLong())).thenReturn(List.of());
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(asset(null));

        assertThat(new AssetSourceService(assetMapper).resolve(555L, 9L, 42L)).isNull();
    }


    @Test
    @DisplayName("resolveInputAssets: 空列表 → 空映射")
    void resolveInputAssets_empty() {
        var result = new AssetSourceService(assetMapper)
                .resolveInputAssets(List.of(), "9", "42");
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("resolveInputAssets: linked 分支必须传参（IKDD4Z，与 resolve 同源）")
    void resolveInputAssets_passesLinkedIds() {
        when(assetMapper.findLinkedAssetIds(9L, 42L)).thenReturn(List.of(777L));

        AssetEntity a1 = new AssetEntity();
        a1.setId(100L);
        a1.setType("audio");
        a1.setUrl("https://example.com/audio.mp3");

        when(assetMapper.resolveInputAssetsWithLinked(
                eq(List.of(100L)), eq(9L), eq(42L), eq(List.of(777L))))
                .thenReturn(List.of(a1));

        var result = new AssetSourceService(assetMapper)
                .resolveInputAssets(List.of("100"), "9", "42");

        assertThat(result).containsKey("100");
        assertThat(result.get("100").getType()).isEqualTo("audio");
        verify(assetMapper).findLinkedAssetIds(9L, 42L);
    }

    @Test
    @DisplayName("resolveInputAssets: 缺失项不在 map 中")
    void resolveInputAssets_missingNotInMap() {
        when(assetMapper.findLinkedAssetIds(anyLong(), anyLong())).thenReturn(List.of());
        when(assetMapper.resolveInputAssetsWithLinked(anyList(), anyLong(), anyLong(), anyList()))
                .thenReturn(List.of());

        var result = new AssetSourceService(assetMapper)
                .resolveInputAssets(List.of("100", "101"), "9", "42");

        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("resolveInputAssets: 多资产按 id 映射")
    void resolveInputAssets_multipleAssets() {
        when(assetMapper.findLinkedAssetIds(anyLong(), anyLong())).thenReturn(List.of());

        AssetEntity audio = new AssetEntity();
        audio.setId(100L);
        audio.setType("audio");
        audio.setUrl("https://example.com/audio.mp3");

        AssetEntity image = new AssetEntity();
        image.setId(101L);
        image.setType("image");
        image.setUrl("https://example.com/image.png");

        when(assetMapper.resolveInputAssetsWithLinked(anyList(), anyLong(), anyLong(), anyList()))
                .thenReturn(List.of(audio, image));

        var result = new AssetSourceService(assetMapper)
                .resolveInputAssets(List.of("100", "101"), "9", "42");

        assertThat(result).hasSize(2);
        assertThat(result.get("100").getType()).isEqualTo("audio");
        assertThat(result.get("101").getType()).isEqualTo("image");
    }
}
