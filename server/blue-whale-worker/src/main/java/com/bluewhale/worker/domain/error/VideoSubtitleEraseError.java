package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;

/**
 * 视频去字幕供应商错误（迁移契约 §17 / IKGZ7Z）。
 * <p>
 * 按 code 落 error JSON。content / quota 类信号沿用 NewApiErrorClassifier 分类
 * （契约 §5 优先级不变），其余一律在处理器归并兜底码
 * {@link VideoSubtitleEraseContract#ERROR_VIDEO_SUBTITLE_ERASE_FAILED}
 * （无 worker 级自动重试）。
 */
public class VideoSubtitleEraseError extends RuntimeException {

    private final String code;

    public VideoSubtitleEraseError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
