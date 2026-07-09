package com.bluewhale.agent.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.bluewhale.agent.mapper.AssetMapper;
import com.bluewhale.agent.model.dto.AssetResponse;
import com.bluewhale.agent.model.entity.Asset;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * {@link AssetService} 测试：mock mapper，验分页查询与 DTO 映射。{@code AssetResponse} 无 {@code storageKey} 字段，结构上保证不泄露。
 */
@ExtendWith(MockitoExtension.class)
class AssetServiceTest {

    @Mock
    private AssetMapper assetMapper;

    @InjectMocks
    private AssetService service;

    @Test
    void listAssetsMapsToResponseFields() {
        Asset a = new Asset().setUrl("/assets/x.png").setType(Asset.TYPE_IMAGE).setWidth(512).setHeight(512)
                .setSource(Asset.SOURCE_GENERATED);
        a.setId(9L);
        Page<Asset> page = new Page<>(1, 24, 1);
        page.setRecords(List.of(a));
        when(assetMapper.selectPage(any(Page.class), any())).thenReturn(page);

        Page<AssetResponse> result = service.listAssets(7L, null, 1, 24);

        assertThat(result.getRecords()).hasSize(1);
        AssetResponse resp = result.getRecords().get(0);
        assertThat(resp.id()).isEqualTo(9L);
        assertThat(resp.url()).isEqualTo("/assets/x.png");
        assertThat(resp.type()).isEqualTo(Asset.TYPE_IMAGE);
        assertThat(resp.source()).isEqualTo(Asset.SOURCE_GENERATED);
    }
}
