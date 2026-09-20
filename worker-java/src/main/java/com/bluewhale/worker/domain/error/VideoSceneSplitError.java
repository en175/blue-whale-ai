package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.VideoSceneSplitContract;

/**
 * 视频场景切分供应商错误（IKH8BP，父规格 IKH86V）。
 * <p>
 * 按 code 落 error JSON。content / quota 类信号沿用 NewApiErrorClassifier 分类
 * （契约 §5 优先级不变），其余一律在处理器归并兜底码
 * {@link VideoSceneSplitContract#ERROR_VIDEO_SCENE_SPLIT_FAILED}
 * （数值 1046，无 worker 级自动重试，用户在任务占位卡手动重试沿用冻结 input）。
 */
public class VideoSceneSplitError extends RuntimeException {

    private final String code;

    public VideoSceneSplitError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
