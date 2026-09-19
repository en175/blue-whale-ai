package com.bluewhale.worker.domain.error;

/**
 * 视频 HD 高清（火山 MediaKit 画质增强大模型版）供应商错误（IKH3VF，父规格 IKH3VB）。
 * <p>
 * 按 code 落 error JSON。content / quota 类信号沿用 NewApiErrorClassifier 分类
 * （§5 优先级不变），其余一律在处理器归并兜底码
 * {@link com.bluewhale.worker.domain.entity.VideoEnhanceContract#ERROR_VIDEO_ENHANCE_FAILED}
 * （无 worker 级自动重试；火山任务 failed——含 SDR 限制、短边/长边超限等供应商侧官方门槛
 * 拒绝——也归并该码，上游可读原因随 message 透传前端投影）。
 */
public class VideoEnhanceError extends RuntimeException {

    /** 执行兜底失败码（数值 1045 = TS error-codes.ts ERROR_VIDEO_ENHANCE_FAILED）。 */
    public static final String VIDEO_ENHANCE_FAILED = "video_enhance_failed";

    private final String code;

    public VideoEnhanceError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
