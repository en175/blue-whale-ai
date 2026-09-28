package com.bluewhale.worker.domain.contract;

/**
 * 生成任务失败 {@code error.details} 的跨族共享键（迁移契约 §20 / IKIMN8；起源于 IKIHGQ audio_mix）。
 * <p>
 * 键名双端单源：本类是 worker-java 的唯一来源，backend 侧对应
 * {@code backend/libs/contracts/error-codes.ts} 的 {@code GENERATION_ERROR_DETAIL_HTTP_STATUS}，
 * 两处同值，禁止在别处发明字面量。适用家族与缺省家族清单以迁移契约 §20 为准。
 */
public final class GenerationErrorDetailContract {
    private GenerationErrorDetailContract() {}

    /** 任务失败 error.details 的上游 HTTP 状态键：上游非 2xx（失败异常链带
     *  {@code HttpStatusException} cause）时写入数值状态，非 HTTP 失败不写该键；
     *  backend 重试换凭证判定读它（401 = 凭证失效），message 文案正则仅兼容旧任务数据。 */
    public static final String ERROR_DETAIL_HTTP_STATUS = "http_status";
}
