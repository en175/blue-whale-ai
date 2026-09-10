package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.domain.error.MediaExtractError;

import com.bluewhale.worker.infrastructure.media.FfmpegExtractor;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.CanvasNodeService;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.dto.UpdateMediaExtractProgressDto;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * media_extract 作业处理器（media-extract-runner.ts:176-325 逐字移植）。
 * <p>
 * 编排流程：claim → 解析源资产 → 下载 → ffmpeg 抽音轨 → 上传 TOS → 发布资产 → 画布节点更新。
 * <p>
 * 错误码映射（media-extract-runner.ts:304-315 + error-codes.ts:20-70）：
 * <ul>
 *   <li>invalid_input：缺少 source_asset_id</li>
 *   <li>source_asset_unavailable：源资产不可用</li>
 *   <li>video_download_failed：下载失败</li>
 *   <li>video_too_large：超过大小上限</li>
 *   <li>video_has_no_audio_track：无音轨</li>
 *   <li>extract_failed：ffmpeg 失败</li>
 *   <li>upload_failed：上传失败</li>
 *   <li>media_extract_failed：兜底</li>
 * </ul>
 * <p>
 * 进度映射（media-extract-runner.ts:131-134）：
 * 0=排队，1-20=下载，21-90=提取，91-99=上传，100=完成。
 */
@Component
public class MediaExtractJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(MediaExtractJobProcessor.class);

    /** 下载大小上限：200MiB（media-extract-runner.ts:117 缺省值）。 */
    private static final long MAX_VIDEO_BYTES = 200L * 1024 * 1024;

    /** 前端阶段映射基准（media-extract-runner.ts:131-134）。 */
    private static final int DOWNLOAD_DONE_PROGRESS = 20;
    private static final int EXTRACT_PROGRESS_RANGE = 70;
    private static final int UPLOAD_START_PROGRESS = 91;

    private final JobStateMachineService stateMachine;
    private final AssetSourceService assetSource;
    private final TosMediaStorage tosService;
    private final FfmpegExtractor ffmpeg;
    private final CanvasNodeService canvasNodeService;
    private final String workerId;

    public MediaExtractJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            TosMediaStorage tosService,
            FfmpegExtractor ffmpeg,
            CanvasNodeService canvasNodeService
    ) {
        this.stateMachine = stateMachine;
        this.assetSource = assetSource;
        this.tosService = tosService;
        this.ffmpeg = ffmpeg;
        this.canvasNodeService = canvasNodeService;
        // workerId = extract-{hostname}-{pid}（media-extract-worker.service.ts:18）
        this.workerId = "extract-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return "media_extract";
    }

    /**
     * 处理一个 media_extract job（media-extract-runner.ts:176-325 逐字移植）。
     * <p>
     * claim 必须在 try 外（IKC9EJ：DB 异常上抛 → consumer 不 ack → 重投）。
     */
    @Override
    public void handle(String jobId) {
        // IKC9EJ：claim 在 try 外，DB 异常上抛至 consumer（media-extract-runner.ts:182-195）
        Optional<ClaimedMediaExtractJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimMediaExtract(jobId, workerId);
        } catch (Exception error) {
            log.error("runMediaExtractStep claim 失败 jobId={}: {}",
                    jobId, error.getMessage());
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // null = 无可认领 / 重复唤醒

        ClaimedMediaExtractJobDto claim = claimOpt.get();

        // 临时文件路径（media-extract-runner.ts:198-201）
        String runId = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        Path inputPath = Path.of(System.getProperty("java.io.tmpdir"), "me-" + runId + "-in");
        Path outputPath = Path.of(System.getProperty("java.io.tmpdir"), "me-" + runId + "-out.mp3");

        try {
            // 1. 解析 source_asset_id（media-extract-runner.ts:203-211）
            Object sourceAssetIdObj = claim.input().get("source_asset_id");
            String sourceAssetIdStr = (sourceAssetIdObj instanceof String s) ? s
                    : (sourceAssetIdObj instanceof Number n) ? String.valueOf(n.longValue())
                    : "";
            if (sourceAssetIdStr.isEmpty()) {
                failMediaExtract(claim, MediaExtractError.INVALID_INPUT, "缺少源视频资产 id");
                return;
            }

            // 2. 解析源资产（media-extract-runner.ts:213-227）
            AssetEntity source = assetSource.resolve(
                    Long.parseLong(sourceAssetIdStr),
                    Long.parseLong(claim.userId()),
                    Long.parseLong(claim.projectId())
            );
            if (source == null) {
                failMediaExtract(claim, MediaExtractError.SOURCE_ASSET_UNAVAILABLE, "源视频资产不可用");
                return;
            }

            // 3. 下载视频（media-extract-runner.ts:229-244）
            tosService.download(source.getUrl(), source.getStorageKey(), inputPath, MAX_VIDEO_BYTES);
            updateProgress(claim, DOWNLOAD_DONE_PROGRESS);

            // 4. ffmpeg 抽音轨（media-extract-runner.ts:247-259）
            FfmpegExtractor.ExtractResult extractResult = ffmpeg.extract(
                    inputPath.toString(),
                    outputPath.toString(),
                    percent -> {
                        // 提取进度映射到 21-90 带（media-extract-runner.ts:251-258）
                        // 浮点计算避免整型截断偏差（与 TS 逐字一致）
                        int mapped = (int) Math.min(
                                DOWNLOAD_DONE_PROGRESS + EXTRACT_PROGRESS_RANGE,
                                DOWNLOAD_DONE_PROGRESS +
                                        (EXTRACT_PROGRESS_RANGE * Math.max(0.0, Math.min(100.0, percent))) / 100.0
                        );
                        updateProgress(claim, mapped);
                    }
            );
            updateProgress(claim, UPLOAD_START_PROGRESS);

            // 5. 上传 mp3（media-extract-runner.ts:262-266）
            TosMediaStorage.UploadResult stored = tosService.upload(outputPath, "audio/mpeg");

            // 6. 发布结果（media-extract-runner.ts:267-278）
            boolean published = stateMachine.publishMediaExtractResult(
                    new PublishMediaExtractDto(
                            claim.id(),
                            claim.projectId(),
                            claim.userId(),
                            claim.workerId(),
                            claim.fencingToken(),
                            stored.url(),
                            stored.storageKey(),
                            stored.mime(),
                            stored.size(),
                            extractResult.duration()
                    )
            );

            if (!published) {
                log.warn("runMediaExtractStep 发布守卫失败 jobId={}（stale worker 或已终态）", claim.id());
            } else {
                // 7. 画布节点更新（best-effort，失败不阻断：media-extract-runner.ts:284-301）
                try {
                    canvasNodeService.updateMediaExtractNodeToAudio(
                            claim.id(), claim.projectId(),
                            stored.url(), stored.mime(), stored.size(),
                            extractResult.duration()
                    );
                } catch (Exception e) {
                    log.warn("runMediaExtractStep 画布节点更新失败 jobId={}: {}",
                            claim.id(), e.getMessage());
                }
            }
        } catch (Exception error) {
            // 错误映射（media-extract-runner.ts:303-315）
            String code = (error instanceof MediaExtractError mee)
                    ? mee.getCode()
                    : MediaExtractError.MEDIA_EXTRACT_FAILED;
            String message = error.getMessage() != null ? error.getMessage() : "媒体提取失败";

            log.error("runMediaExtractStep 异常 jobId={} code={}: {}",
                    claim.id(), code, error.getMessage(), error);

            failMediaExtract(claim, code, message);
        } finally {
            // 尽力清理临时文件（media-extract-runner.ts:317-324）
            deleteQuietly(inputPath);
            deleteQuietly(outputPath);
        }
    }

    /** 失败处理（media-extract-runner.ts:136-160 failMediaExtract）。 */
    private void failMediaExtract(ClaimedMediaExtractJobDto claim, String code, String message) {
        stateMachine.failMediaExtractJob(new FailMediaExtractDto(
                claim.id(),
                claim.workerId(),
                claim.fencingToken(),
                code,
                message,
                Map.of("raw", message)
        ));
        // 画布占位节点置 failed（best-effort，失败不阻断）
        try {
            canvasNodeService.failMediaExtractNode(
                    claim.id(), claim.projectId(), code, message);
        } catch (Exception ignored) {
            // 与 TS .catch(() => {}) 一致
        }
    }

    /** 进度更新（media-extract-runner.ts:162-173 updateProgress）。 */
    private void updateProgress(ClaimedMediaExtractJobDto claim, int progress) {
        stateMachine.updateMediaExtractProgress(new UpdateMediaExtractProgressDto(
                claim.id(),
                claim.workerId(),
                claim.fencingToken(),
                progress
        ));
    }

    private static void deleteQuietly(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
            // 与 TS fs.rm({ force: true }).catch(() => {}) 一致
        }
    }

    private static String hostname() {
        try {
            return java.net.InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "unknown";
        }
    }
}
