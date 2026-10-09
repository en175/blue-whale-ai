package com.bluewhale.worker.application.service;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.entity.MaterialAssetEntity;
import com.bluewhale.worker.infrastructure.gateway.NewApiMaterialClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMaterialClient.MaterialStatusResult;
import com.bluewhale.worker.infrastructure.mapper.MaterialAssetMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class MaterialStatusPoller {

    private static final Logger log = LoggerFactory.getLogger(MaterialStatusPoller.class);

    private static final int SCAN_LIMIT = 100;

    private static final String STATUS_ACTIVE = "Active";
    private static final String STATUS_FAILED = "Failed";
    private static final String STATUS_PROCESSING = "Processing";

    private final MaterialAssetMapper assetMapper;
    private final UpstreamCredential credential;
    private final NewApiMaterialClient client;
    private final int maxAgeMinutes;

    public MaterialStatusPoller(
            MaterialAssetMapper assetMapper,
            UpstreamCredential credential,
            NewApiMaterialClient client,
            @Value("${MATERIAL_STATUS_POLL_MAX_AGE_MINUTES:10}") int maxAgeMinutes
    ) {
        this.assetMapper = assetMapper;
        this.credential = credential;
        this.client = client;
        this.maxAgeMinutes = maxAgeMinutes;
    }

    @Scheduled(
            initialDelayString = "${MATERIAL_STATUS_POLL_INITIAL_DELAY_MS:0}",
            fixedDelayString = "${MATERIAL_STATUS_POLL_INTERVAL_MS:5000}"
    )
    public void poll() {
        try {
            String token;
            try {
                token = credential.requireKey();
            } catch (Exception e) {
                log.error("素材状态跟进跳过本轮：{}", e.getMessage());
                return;
            }
            List<MaterialAssetEntity> rows =
                    assetMapper.listProcessingWithin(SCAN_LIMIT, maxAgeMinutes);
            for (MaterialAssetEntity row : rows) {
                followUp(row, token);
            }
        } catch (Exception e) {
            log.error("素材状态跟进扫描失败: {}", e.getMessage(), e);
        }
    }

    private void followUp(MaterialAssetEntity row, String token) {
        String materialId = row.getMaterialId();
        try {
            MaterialStatusResult upstream = client.getAsset(token, materialId);
            if (upstream == null) {
                return;
            }

            String status = normalizeStatus(upstream.status());
            int updated = assetMapper.mirrorStatus(
                    row.getUserId(), materialId, status,
                    upstream.errorCode(), upstream.errorMessage());
            if (updated == 0) {
                log.debug("素材状态跟进回写落空（行已删除或已是终态）materialId={}", materialId);
            } else if (!STATUS_PROCESSING.equals(status)) {
                log.info("素材状态跟进收敛 materialId={} {}: {}",
                        materialId, row.getUserId(), status);
            }

            if (STATUS_FAILED.equals(status)) {
                handleFailure(row.getUserId(), materialId, token);
            }
        } catch (Exception e) {
            log.error("素材状态跟进单条失败 materialId={}: {}", materialId, e.getMessage(), e);
        }
    }

    private void handleFailure(long userId, String materialId, String token) {
        try {
            int cleared = assetMapper.clearMaterialLink(userId, materialId);
            log.info("素材失败：已清 {} 条本地资产关联 materialId={}", cleared, materialId);
        } catch (Exception e) {
            log.error("素材失败：清本地资产关联失败 materialId={}: {}", materialId, e.getMessage(), e);
        }
        try {
            client.deleteAsset(token, materialId);
        } catch (Exception e) {
            log.error("素材失败：清理上游失败 materialId={}: {}", materialId, e.getMessage(), e);
        }
    }

    private static String normalizeStatus(String raw) {
        return STATUS_ACTIVE.equals(raw) || STATUS_FAILED.equals(raw) ? raw : STATUS_PROCESSING;
    }
}
