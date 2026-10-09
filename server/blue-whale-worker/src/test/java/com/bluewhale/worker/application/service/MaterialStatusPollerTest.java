package com.bluewhale.worker.application.service;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.config.SystemSettingEnvelopeVectors;
import com.bluewhale.worker.domain.entity.MaterialAssetEntity;
import com.bluewhale.worker.infrastructure.gateway.NewApiMaterialClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMaterialClient.MaterialStatusResult;
import com.bluewhale.worker.infrastructure.mapper.MaterialAssetMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MaterialStatusPollerTest {

    private static final int MAX_AGE_MINUTES = 10;
    private static final String UNIFIED_KEY = SystemSettingEnvelopeVectors.FAKE_KEY;

    @Mock private MaterialAssetMapper assetMapper;
    @Mock private NewApiMaterialClient client;

    private MaterialStatusPoller poller;

    private static MaterialAssetEntity row(long userId, String materialId) {
        MaterialAssetEntity e = new MaterialAssetEntity();
        e.setUserId(userId);
        e.setMaterialId(materialId);
        e.setStatus("Processing");
        return e;
    }

    @BeforeEach
    void setUp() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt())).thenReturn(List.of());
        poller = new MaterialStatusPoller(assetMapper, upstreamCredential(), client,
                MAX_AGE_MINUTES);
    }

    private static UpstreamCredential upstreamCredential() {
        return new UpstreamCredential(
                key -> SystemSettingEnvelopeVectors.ENVELOPE,
                SystemSettingEnvelopeVectors.FAKE_SECRET_HEX);
    }

    @Test
    @DisplayName("窗口内 Processing 行：取统一 key → 查上游 → 回写 Active")
    void mirrorsActiveStatus() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-abc")));
        when(client.getAsset(UNIFIED_KEY, "asset-abc"))
                .thenReturn(new MaterialStatusResult("Active", null, null));

        poller.poll();

        verify(assetMapper).mirrorStatus(9L, "asset-abc", "Active", null, null);
    }

    @Test
    @DisplayName("统一 key 与行归属用户无关：不同 userId 的行都用同一把 key 查上游")
    void unifiedKeyIsUsedRegardlessOfRowUserId() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-a"), row(77L, "asset-b")));
        when(client.getAsset(eq(UNIFIED_KEY), anyString()))
                .thenReturn(new MaterialStatusResult("Active", null, null));

        poller.poll();

        verify(client).getAsset(UNIFIED_KEY, "asset-a");
        verify(client).getAsset(UNIFIED_KEY, "asset-b");
        verify(client, times(2)).getAsset(eq(UNIFIED_KEY), anyString());
    }

    @Test
    @DisplayName("上游 Failed：状态与失败原文一起回写（原文留痕，不解释）")
    void mirrorsFailedWithRawError() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-abc")));
        when(client.getAsset(UNIFIED_KEY, "asset-abc"))
                .thenReturn(new MaterialStatusResult("Failed", "InvalidParameter", "素材不合规"));

        poller.poll();

        verify(assetMapper).mirrorStatus(9L, "asset-abc", "Failed", "InvalidParameter", "素材不合规");
    }

    @Test
    @DisplayName("上游判 Failed：清本地资产关联 + 删上游素材（与 backend 同一口径）")
    void failedTriggersCleanup() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-bad")));
        when(client.getAsset(UNIFIED_KEY, "asset-bad"))
                .thenReturn(new MaterialStatusResult("Failed", "Sensitive", "命中审核"));

        poller.poll();

        verify(assetMapper).mirrorStatus(9L, "asset-bad", "Failed", "Sensitive", "命中审核");
        verify(assetMapper).clearMaterialLink(9L, "asset-bad");
        verify(client).deleteAsset(UNIFIED_KEY, "asset-bad");
    }

    @Test
    @DisplayName("上游 Active：不触发任何清理（别把正常素材删了）")
    void activeTriggersNoCleanup() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-ok")));
        when(client.getAsset(UNIFIED_KEY, "asset-ok"))
                .thenReturn(new MaterialStatusResult("Active", null, null));

        poller.poll();

        verify(assetMapper, never()).clearMaterialLink(anyLong(), anyString());
        verify(client, never()).deleteAsset(anyString(), anyString());
    }

    @Test
    @DisplayName("清理抛错不中断本轮跟进（单条素材的清理失败不该拖垮整轮）")
    void cleanupFailureDoesNotAbortRound() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-bad"), row(9L, "asset-ok2")));
        when(client.getAsset(UNIFIED_KEY, "asset-bad"))
                .thenReturn(new MaterialStatusResult("Failed", null, null));
        when(assetMapper.clearMaterialLink(9L, "asset-bad"))
                .thenThrow(new RuntimeException("db down"));
        when(client.getAsset(UNIFIED_KEY, "asset-ok2"))
                .thenReturn(new MaterialStatusResult("Active", null, null));

        poller.poll();

        verify(assetMapper).mirrorStatus(9L, "asset-ok2", "Active", null, null);
    }

    @Test
    @DisplayName("认不出的上游状态收敛成 Processing（不误判为可用，也不误杀）")
    void normalizesUnknownStatusToProcessing() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-abc")));
        when(client.getAsset(UNIFIED_KEY, "asset-abc"))
                .thenReturn(new MaterialStatusResult("Pending", null, null));

        poller.poll();

        verify(assetMapper).mirrorStatus(9L, "asset-abc", "Processing", null, null);
    }

    @Test
    @DisplayName("上游查不到（网络/信封异常）→ 不写库，状态保持 Processing")
    void keepsProcessingWhenUpstreamUnknown() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-abc")));
        when(client.getAsset(UNIFIED_KEY, "asset-abc")).thenReturn(null);

        poller.poll();

        verify(assetMapper, never()).mirrorStatus(anyLong(), anyString(), anyString(), any(), any());
    }

    @Test
    @DisplayName("单条失败不中断本轮（后续行照常跟进）")
    void singleRowFailureDoesNotAbortRound() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-aaa"), row(9L, "asset-bbb")));
        when(client.getAsset(UNIFIED_KEY, "asset-aaa"))
                .thenThrow(new RuntimeException("gateway down"));
        when(client.getAsset(UNIFIED_KEY, "asset-bbb"))
                .thenReturn(new MaterialStatusResult("Active", null, null));

        poller.poll();

        verify(assetMapper).mirrorStatus(9L, "asset-bbb", "Active", null, null);
    }

    @Test
    @DisplayName("回写落空（跟进期间行被删）不视为错误：本轮继续")
    void zeroAffectedRowsIsNotAnError() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-abc")));
        when(client.getAsset(UNIFIED_KEY, "asset-abc"))
                .thenReturn(new MaterialStatusResult("Active", null, null));
        when(assetMapper.mirrorStatus(anyLong(), anyString(), anyString(), any(), any()))
                .thenReturn(0);

        poller.poll();

        verify(assetMapper).mirrorStatus(9L, "asset-abc", "Active", null, null);
    }

    @Test
    @DisplayName("扫描参数：limit=100 + 跟进窗口分钟数透传")
    void passesScanParameters() {
        poller.poll();

        verify(assetMapper).listProcessingWithin(100, MAX_AGE_MINUTES);
    }

    @Test
    @DisplayName("整轮异常兜底：扫库抛错不逃逸（调度线程保活）")
    void scanFailureIsSwallowed() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenThrow(new RuntimeException("db down"));

        poller.poll();

        verifyNoInteractions(client);
    }
}
