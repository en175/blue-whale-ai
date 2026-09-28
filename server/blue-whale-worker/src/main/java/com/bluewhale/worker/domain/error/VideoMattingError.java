package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.VideoMattingContract;

/**
 * 智能抠像（video_matting，火山 MediaKit 双端点人像/绿幕抠像）供应商错误（IKHK99，父规格
 * IKHJRC，契约 IKHK7F）。
 * <p>
 * 按 code 落 error JSON。content / quota 类信号沿用 NewApiErrorClassifier 分类
 * （§5 优先级不变），其余一律在处理器归并兜底码
 * {@link VideoMattingContract#ERROR_VIDEO_MATTING_FAILED}
 * （无 worker 级自动重试；火山任务 failed——error 对象 code / message / param / type——
 * 与结果转存失败也归并该码，双模式共享一码、错误信息透传区分，上游可读原因随 message
 * 透传前端投影）。
 */
public class VideoMattingError extends RuntimeException {

    private final String code;

    public VideoMattingError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
