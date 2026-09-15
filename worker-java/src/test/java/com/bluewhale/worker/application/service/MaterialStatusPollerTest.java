package com.bluewhale.worker.application.service;

import com.bluewhale.worker.config.WorkerProperties;
import com.bluewhale.worker.domain.entity.MaterialAssetEntity;
import com.bluewhale.worker.infrastructure.gateway.NewApiMaterialClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMaterialClient.MaterialStatusResult;
import com.bluewhale.worker.infrastructure.mapper.MaterialAssetMapper;
import com.bluewhale.worker.infrastructure.mapper.UserInfoMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Set;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 素材状态定时跟进测试（ADR-0087 决策 4）。
 * <p>
 * 覆盖：窗口内 Processing 行逐条实时查并回写、无凭证跳过、上游未知不写库（保持 Processing）、
 * 认不出的状态收敛成 Processing、单条失败不中断本轮、安全拉起完全跳过、扫描参数透传、
 * 回写落空（行被删）不视为错误。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MaterialStatusPollerTest {

    private static final int MAX_AGE_MINUTES = 10;

    @Mock private MaterialAssetMapper assetMapper;
    @Mock private UserInfoMapper userInfoMapper;
    @Mock private NewApiMaterialClient client;

    private MaterialStatusPoller poller;

    private static WorkerProperties props(Set<String> tags) {
        return new WorkerProperties(tags, "-java", null);
    }

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
        poller = new MaterialStatusPoller(assetMapper, userInfoMapper, client,
                props(Set.of("video")), MAX_AGE_MINUTES);
    }

    @Test
    @DisplayName("窗口内 Processing 行：取凭证 → 查上游 → 回写 Active")
    void mirrorsActiveStatus() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-abc")));
        when(userInfoMapper.findCredential(9L)).thenReturn("sk-user9");
        when(client.getAsset("sk-user9", "asset-abc"))
                .thenReturn(new MaterialStatusResult("Active", null, null));

        poller.poll();

        verify(assetMapper).mirrorStatus(9L, "asset-abc", "Active", null, null);
    }

    @Test
    @DisplayName("上游 Failed：状态与失败原文一起回写（原文留痕，不解释）")
    void mirrorsFailedWithRawError() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-abc")));
        when(userInfoMapper.findCredential(9L)).thenReturn("sk-user9");
        when(client.getAsset("sk-user9", "asset-abc"))
                .thenReturn(new MaterialStatusResult("Failed", "InvalidParameter", "素材不合规"));

        poller.poll();

        verify(assetMapper).mirrorStatus(9L, "asset-abc", "Failed", "InvalidParameter", "素材不合规");
    }

    @Test
    @DisplayName("认不出的上游状态收敛成 Processing（不误判为可用，也不误杀）")
    void normalizesUnknownStatusToProcessing() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-abc")));
        when(userInfoMapper.findCredential(9L)).thenReturn("sk-user9");
        when(client.getAsset("sk-user9", "asset-abc"))
                .thenReturn(new MaterialStatusResult("Pending", null, null));

        poller.poll();

        verify(assetMapper).mirrorStatus(9L, "asset-abc", "Processing", null, null);
    }

    @Test
    @DisplayName("user_info 无凭证 → 跳过该行：不查上游也不写库（保持 Processing 等下轮）")
    void skipsWhenNoCredential() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-abc")));
        when(userInfoMapper.findCredential(9L)).thenReturn(null);

        poller.poll();

        verify(client, never()).getAsset(anyString(), anyString());
        verify(assetMapper, never()).mirrorStatus(anyLong(), anyString(), anyString(), any(), any());
    }

    @Test
    @DisplayName("上游查不到（网络/信封异常）→ 不写库，状态保持 Processing")
    void keepsProcessingWhenUpstreamUnknown() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-abc")));
        when(userInfoMapper.findCredential(9L)).thenReturn("sk-user9");
        when(client.getAsset("sk-user9", "asset-abc")).thenReturn(null);

        poller.poll();

        verify(assetMapper, never()).mirrorStatus(anyLong(), anyString(), anyString(), any(), any());
    }

    @Test
    @DisplayName("单条失败不中断本轮（后续行照常跟进）")
    void singleRowFailureDoesNotAbortRound() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-aaa"), row(9L, "asset-bbb")));
        when(userInfoMapper.findCredential(9L)).thenReturn("sk-user9");
        when(client.getAsset("sk-user9", "asset-aaa"))
                .thenThrow(new RuntimeException("gateway down"));
        when(client.getAsset("sk-user9", "asset-bbb"))
                .thenReturn(new MaterialStatusResult("Active", null, null));

        poller.poll();

        verify(assetMapper).mirrorStatus(9L, "asset-bbb", "Active", null, null);
    }

    @Test
    @DisplayName("回写落空（跟进期间行被删）不视为错误：本轮继续")
    void zeroAffectedRowsIsNotAnError() {
        when(assetMapper.listProcessingWithin(anyInt(), anyInt()))
                .thenReturn(List.of(row(9L, "asset-abc")));
        when(userInfoMapper.findCredential(9L)).thenReturn("sk-user9");
        when(client.getAsset("sk-user9", "asset-abc"))
                .thenReturn(new MaterialStatusResult("Active", null, null));
        when(assetMapper.mirrorStatus(anyLong(), anyString(), anyString(), any(), any()))
                .thenReturn(0);

        poller.poll(); // 不抛

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

        poller.poll(); // 不抛

        verifyNoInteractions(userInfoMapper);
    }

    @Test
    @DisplayName("安全拉起（enabledTags 为空）→ 完全不碰库（stub DataSource 形态不刷错误日志）")
    void skipsEntirelyWhenNoTagsEnabled() {
        MaterialStatusPoller idle = new MaterialStatusPoller(assetMapper, userInfoMapper, client,
                props(Set.of()), MAX_AGE_MINUTES);

        idle.poll();

        verifyNoInteractions(assetMapper);
        verifyNoInteractions(userInfoMapper);
        verifyNoInteractions(client);
    }
}
