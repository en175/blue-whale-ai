package com.bluewhale.worker.application.service;

import com.bluewhale.worker.config.WorkerProperties;
import com.bluewhale.worker.domain.entity.MaterialAssetEntity;
import com.bluewhale.worker.infrastructure.gateway.NewApiMaterialClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMaterialClient.MaterialStatusResult;
import com.bluewhale.worker.infrastructure.mapper.MaterialAssetMapper;
import com.bluewhale.worker.infrastructure.mapper.UserInfoMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 素材校验状态定时跟进（ADR-0087 决策 4）。
 * <p>
 * 背景：前端点「合规校验」= 上传素材库，上游 {@code CreateAsset} 是异步注册，返回时素材还在
 * {@code Processing}。用户上传达标不代表校验通过——只有上游判定 {@code Active} 才算，那时才
 * 能拿去生成视频。而「上传完就关页面」是常态，没人会再来问一次上游，本地行就会永远停在
 * {@code Processing}。本服务每 {@code MATERIAL_STATUS_POLL_INTERVAL_MS}（默认 5s）扫一轮，
 * 替这些没人管的行去问上游。
 * <p>
 * 跟进窗口 = {@code gmt_create} 起 {@code MATERIAL_STATUS_POLL_MAX_AGE_MINUTES}（默认 10 分钟）。
 * 超窗仍 {@code Processing} 的行不再跟进，也不改写状态——本表不引入第四种状态。这类素材若被
 * 拿来生成，拦截点（backend 创建期/重试期）会自己实时查一次上游，正确性不打折。
 * <p>
 * 凭据来源：网关 {@code /api/material/*} 只认用户 sk-，没有服务级通道，而定时跟进发生在任何
 * 请求之外，没有会话可借。登录时 backend 把 sk- 落 {@code user_info}，这里按 user_id 取回。
 * <p>
 * 与 {@link RecoveryService} 同一套调度约定：启动即扫一次，整轮异常兜底不逃逸；
 * {@code WORKER_ENABLED_TAGS} 为空时完全跳过（stub DataSource 形态，不连库不刷错误日志）。
 */
@Service
public class MaterialStatusPoller {

    private static final Logger log = LoggerFactory.getLogger(MaterialStatusPoller.class);

    /** 每轮批大小（与 recovery 同口径）。 */
    private static final int SCAN_LIMIT = 100;

    /** 本地仅认这三种；其余一律收敛成 Processing（继续跟进，不误判为可用，也不误杀）。 */
    private static final String STATUS_ACTIVE = "Active";
    private static final String STATUS_FAILED = "Failed";
    private static final String STATUS_PROCESSING = "Processing";

    private final MaterialAssetMapper assetMapper;
    private final UserInfoMapper userInfoMapper;
    private final NewApiMaterialClient client;
    private final WorkerProperties workerProps;
    private final int maxAgeMinutes;

    /** 空 tags 提示只打一次（避免安全拉起形态下每轮刷屏）。 */
    private boolean emptyTagsLogged;

    public MaterialStatusPoller(
            MaterialAssetMapper assetMapper,
            UserInfoMapper userInfoMapper,
            NewApiMaterialClient client,
            WorkerProperties workerProps,
            @Value("${MATERIAL_STATUS_POLL_MAX_AGE_MINUTES:10}") int maxAgeMinutes
    ) {
        this.assetMapper = assetMapper;
        this.userInfoMapper = userInfoMapper;
        this.client = client;
        this.workerProps = workerProps;
        this.maxAgeMinutes = maxAgeMinutes;
    }

    /**
     * 跟进一轮：扫窗口内 Processing 行，逐行实时查上游并回写。
     * <p>
     * 逐行而非批量：上游没有批量按 id 查的 Action（ListAssets 是全量分页），且单行失败
     * 不应拖垮整批——单条 catch，下轮再试。
     */
    @Scheduled(
            initialDelayString = "${MATERIAL_STATUS_POLL_INITIAL_DELAY_MS:0}",
            fixedDelayString = "${MATERIAL_STATUS_POLL_INTERVAL_MS:5000}"
    )
    public void poll() {
        if (workerProps.enabledTags().isEmpty()) {
            if (!emptyTagsLogged) {
                emptyTagsLogged = true;
                log.info("素材状态跟进跳过：WORKER_ENABLED_TAGS 为空（安全拉起形态，不连库不扫库）");
            }
            return;
        }
        try {
            List<MaterialAssetEntity> rows =
                    assetMapper.listProcessingWithin(SCAN_LIMIT, maxAgeMinutes);
            for (MaterialAssetEntity row : rows) {
                followUp(row);
            }
        } catch (Exception e) {
            log.error("素材状态跟进扫描失败: {}", e.getMessage(), e);
        }
    }

    /** 单行跟进：取凭证 → 查上游 → 回写。任何一步未知就保持 Processing，下轮再试。 */
    private void followUp(MaterialAssetEntity row) {
        String materialId = row.getMaterialId();
        try {
            String token = userInfoMapper.findCredential(row.getUserId());
            if (token == null || token.isBlank()) {
                // 用户从未在本栈登录（或登录发生在 user_info 上线之前）→ 没有凭证可查。
                // 不删行、不改状态：拦截点仍会实时查，用户下次登录起本行就能被跟进。
                log.warn("素材状态跟进跳过：user_info 无凭证 userId={} materialId={}",
                        row.getUserId(), materialId);
                return;
            }

            MaterialStatusResult upstream = client.getAsset(token, materialId);
            if (upstream == null) {
                return; // 本轮未知（网络/信封异常），保持 Processing
            }

            String status = normalizeStatus(upstream.status());
            int updated = assetMapper.mirrorStatus(
                    row.getUserId(), materialId, status,
                    upstream.errorCode(), upstream.errorMessage());
            if (updated == 0) {
                // 跟进期间该行被 DeleteAsset 清掉——正常竞态，不是错误。
                log.debug("素材状态跟进回写落空（行已删除）materialId={}", materialId);
            } else if (!STATUS_PROCESSING.equals(status)) {
                log.info("素材状态跟进收敛 materialId={} {}: {}",
                        materialId, row.getUserId(), status);
            }
        } catch (Exception e) {
            // 单条失败只记错：本轮后续继续、下轮扫描再试。
            log.error("素材状态跟进单条失败 materialId={}: {}", materialId, e.getMessage(), e);
        }
    }

    /** 上游 Status 收敛：认不出的值一律当 Processing（继续跟进，不误判为可用）。 */
    private static String normalizeStatus(String raw) {
        return STATUS_ACTIVE.equals(raw) || STATUS_FAILED.equals(raw) ? raw : STATUS_PROCESSING;
    }
}
