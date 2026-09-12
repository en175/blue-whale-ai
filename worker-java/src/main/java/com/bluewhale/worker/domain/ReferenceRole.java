package com.bluewhale.worker.domain;

/**
 * 参考素材角色枚举（视频模型能力校验：参考图角色）。
 * <p>
 * 契约 / TS：references 数组 role 字段合法值（video-job-runner / capabilities 校验）。
 * 变化轴：视频模型参考能力（首帧 / 尾帧 / 普通参考图）。
 */
public enum ReferenceRole {

    /** 普通参考图。 */
    REFERENCE("reference"),

    /** 视频首帧（必须 image，契约校验）。 */
    FIRST_FRAME("first_frame"),

    /** 视频尾帧（必须 image）。 */
    LAST_FRAME("last_frame");

    private final String value;

    ReferenceRole(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
