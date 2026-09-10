package com.bluewhale.worker.service;

import com.bluewhale.worker.persistence.Asset;
import com.bluewhale.worker.persistence.AssetMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * AssetSourceResolver 移植测试（generation-worker-asset-ops.ts:81-101）。
 * 钉两件事：IKDD4Z linked 分支传参完整；storage_key 为 null 一律判不可用。
 */
@ExtendWith(MockitoExtension.class)
class AssetSourceResolverTest {

    @Mock
    private AssetMapper assetMapper;

    private Asset asset(String storageKey) {
        Asset a = new Asset();
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

        assertThat(new AssetSourceResolver(assetMapper).resolve(555L, 9L, 42L)).isNotNull();
        verify(assetMapper).findLinkedAssetIds(9L, 42L);
    }

    @Test
    @DisplayName("行不存在 → null（source_asset_unavailable）")
    void missingRowReturnsNull() {
        when(assetMapper.findLinkedAssetIds(anyLong(), anyLong())).thenReturn(List.of());
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(null);

        assertThat(new AssetSourceResolver(assetMapper).resolve(555L, 9L, 42L)).isNull();
    }

    @Test
    @DisplayName("storage_key 为 null（passthrough 残留行）→ 判不可用，禁止拉上游过期签名 URL（asset-ops.ts:99）")
    void nullStorageKeyTreatedAsUnavailable() {
        when(assetMapper.findLinkedAssetIds(anyLong(), anyLong())).thenReturn(List.of());
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(asset(null));

        assertThat(new AssetSourceResolver(assetMapper).resolve(555L, 9L, 42L)).isNull();
    }
}
