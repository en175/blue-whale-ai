package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoFrameInterpolationError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * new-api 网关 MediaKit 视频插帧客户端（IKHLKJ，父需求 IKHLES；以
 * {@link NewApiMediaKitEnhanceVideoClient} 为模板——家族内 MediaKit 异步任务：提交返
 * task_id + 查询端点轮询取 result.video_url / duration / resolution / fps）。HTTP 骨架
 * 自 IKHKMK 起收敛入 {@link NewApiMediaKitAsyncTaskClient}，本类只保留契约枚举校验、
 * 出站 payload 构造与 completed 结果解析。
 * <p>
 * 端点（网关**对客**路径；网关内部转发火山上游
 * POST /api/v1/tools/video-frame-interpolation。路径常量单源在
 * {@link VideoFrameInterpolationContract}，契约票 IKHLK3 已冻结）：
 * <ul>
 *   <li>submit：POST {SUBMIT_PATH}（30s 超时，异步提交秒级入队）</li>
 *   <li>poll：GET {POLL_PATH_PREFIX}{task_id}（10s 超时）——MediaKit 异步工具共用
 *       同一条查询路由，路径不含 async 段（IKH67T 实测校准）</li>
 * </ul>
 * ⚠️ 网关路径 ≠ 火山上游路径：混用即 404 Invalid URL，任务卡在提交相（IKH67T）。
 * 鉴权与家族同构（契约 §5 / ADR-0080）：Authorization: Bearer 任务冻结的用户 sk-
 * （processor 从 job.input.provider_credential 取出传入）+ X-Trace-Id +
 * X-Client-System: bluewhale。
 * <p>
 * 出站请求映射（官方参数级 API 参考页 Body 参数节 + 本仓口径）：model（对客模型名，网关按
 * 模型名路由 MediaKit 渠道，本期 model_price 配 0）+ video_url（源视频公网对象存储地址）+
 * fps（**整型原样透传**，值域 = 任务冻结的 30/60/120 三档）。官方其余可选参数一律不发
 * （media_output_destination / client_token / callback_* / queue_id——走默认 24h 临时链接 +
 * 自家 TOS 转存，无幂等与回调需求，契约冻结口径）。
 * <p>
 * 响应形状（官方提交 / 查询 API 逐字）：submit = {success, task_id, request_id}
 * （success=false 时带 error{code,type,message,param}）；poll 顶层含 task_id / status
 * （running / completed / failed）与 result{video_url, duration, resolution, fps}——
 * result.video_url 是 24h 有效 HTTPS 临时下载链接（官方「须及时下载保存」），processor
 * 须立即转存自家 TOS。status 大小写官方未逐字冻结，按小写归一容错解析
 * （completed→succeeded、failed→failed、其余→processing）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content &gt; quota &gt; provider_failed，§5 优先级，
 * 网关错误不透传英文）；poll 的网络超时 / 连接失败 / HTTP 429/5xx 抛错时以 cause 携带状态
 * （{@link NewApiVideoClient.HttpStatusException} 复用），供 processor 按 isTransientPollError
 * 语义判定瞬时重排。
 */
@Component
public class NewApiMediaKitInterpolateVideoClient extends NewApiMediaKitAsyncTaskClient {

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；去字幕 / HD 高清 / 人声分离客户端
     * MODEL 同款集中一处）。候选值 mediakit-video-frame-interpolation——最终以网关票 IKHLLB
     * 确认为准，有出入只改本常量。
     */
    static final String MODEL = "mediakit-video-frame-interpolation";

    public NewApiMediaKitInterpolateVideoClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiMediaKitInterpolateVideoClient(String baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return VideoFrameInterpolationContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return VideoFrameInterpolationContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "视频插帧";
    }

    @Override
    protected String fallbackCode() {
        return VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VideoFrameInterpolationError(code, message);
    }

    /**
     * 提交插帧异步任务（官方响应说明：成功返回 task_id）。
     *
     * @param token    per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param videoUrl 源视频公网对象存储地址
     * @param fps      任务冻结的目标帧率（整型三档 30 / 60 / 120，出站同名同值透传官方 fps 参数；
     *                 官方值域 [15,120]，本仓只暴露产品三档）
     * @return 上游任务 id（processor 存 provider_task_id 后转轮询）
     * @throws VideoFrameInterpolationError 按错误分类抛错
     */
    public String submit(String token, String videoUrl, int fps) {
        if (!VideoFrameInterpolationContract.SUPPORTED_FPS.contains(fps)) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "插帧目标帧率非法: " + fps);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        // 整型直传（ADR-0113 契约与代码层命名对齐火山命名，fps 直传整型；字符串 "60" 在
        // 创建入口已被 zod / worker 侧校验拒绝）
        payload.put("fps", fps);
        return executeSubmit(token, payload);
    }

    /**
     * 查询插帧异步任务（官方查询任务 API：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带官方 result 四键
     *         video_url / duration 秒 / resolution 档位 / fps；failed 时带上游错误文本供 §5 分类与透传）
     * @throws VideoFrameInterpolationError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public InterpolateVideoTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new InterpolateVideoTaskObservation("failed", null, null, null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            // 官方 result 四键（键名单源 = 契约 RESULT_KEYS，禁止另行发明字段名）
            JsonNode result = body.data().path("result");
            JsonNode videoUrl = result.path(
                    VideoFrameInterpolationContract.RESULT_KEY_VIDEO_URL);
            JsonNode duration = result.path(
                    VideoFrameInterpolationContract.RESULT_KEY_DURATION);
            JsonNode resolution = result.path(
                    VideoFrameInterpolationContract.RESULT_KEY_RESOLUTION);
            JsonNode fps = result.path(VideoFrameInterpolationContract.RESULT_KEY_FPS);
            return new InterpolateVideoTaskObservation("succeeded",
                    videoUrl.isTextual() ? videoUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    resolution.isTextual() ? resolution.asText() : null,
                    fps.isNumber() ? fps.asDouble() : null,
                    null, null);
        }

        // running / queued 等中间态 → 继续轮询（官方中间态枚举：running；其余统一 processing）
        return new InterpolateVideoTaskObservation("processing", null, null, null, null, null, null);
    }

    /**
     * 插帧任务观测（对齐 {@link NewApiMediaKitEnhanceVideoClient.EnhanceVideoTaskObservation}
     * 形态，字段面 = 官方 result 四键：video_url / duration / resolution / fps）。
     * status: succeeded | processing | failed
     */
    public record InterpolateVideoTaskObservation(
            String status,
            /** completed 时的 result.video_url（24h 有效临时链接，调用方须立即下载转存）。 */
            String videoUrl,
            /** completed 时的 result.duration（秒，官方精确值；可 null）。 */
            Double durationSec,
            /** completed 时的 result.resolution（档位字符串，跟随原片；可 null）。 */
            String resolution,
            /** completed 时的 result.fps（与提交时目标帧率一致；可 null）。 */
            Double fps,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
