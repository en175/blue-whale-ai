package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract;

/**
 * 视频插帧（火山 MediaKit video-frame-interpolation）供应商错误（IKHLK3，父需求 IKHLES）。
 * <p>
 * 按 code 落 error JSON。content / quota 类信号沿用 NewApiErrorClassifier 分类
 * （§5 优先级不变），其余一律在处理器归并兜底码
 * {@link VideoFrameInterpolationContract#ERROR_VIDEO_FRAME_INTERPOLATION_FAILED}
 * （无 worker 级自动重试；火山任务 failed——含目标帧率越界、输入规格不符、文件大小或时长超上游
 * 限制等入口未前置判定的官方门槛拒绝——也归并该码，上游可读原因随 message 透传前端投影）。
 * <p>
 * 执行面（消费者、处理器）由 IKHLKJ 按附录 C 触点注册；本类先随契约票落常量镜像，
 * 使双端字符串码在跨进程面同源（防漂移断言读本文件源码文本）。
 */
public class VideoFrameInterpolationError extends RuntimeException {

    /** 执行兜底失败码（数值 1049 = TS error-codes.ts ERROR_VIDEO_FRAME_INTERPOLATION_FAILED）。 */
    public static final String VIDEO_FRAME_INTERPOLATION_FAILED = "video_frame_interpolation_failed";

    private final String code;

    public VideoFrameInterpolationError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
