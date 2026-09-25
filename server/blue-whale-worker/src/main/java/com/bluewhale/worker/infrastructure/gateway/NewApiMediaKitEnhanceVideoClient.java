package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoEnhanceContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoEnhanceError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * new-api 网关 MediaKit 视频画质增强客户端（IKH3VF；以 NewApiMediaKitSubtitleEraseClient
 * 为模板——家族内第三个 MediaKit 异步任务：提交返 task_id + 查询端点轮询取
 * result.video_url / duration / resolution / fps。HTTP 骨架自 IKHKMK 起收敛入
 * {@link NewApiMediaKitAsyncTaskClient}，本类只保留契约枚举校验、出站 payload 构造
 * 与 completed 结果解析）。
 * <p>
 * 端点（网关**对客**路径，常量单源在 {@link VideoEnhanceContract}）：
 * <ul>
 *   <li>submit：POST {SUBMIT_PATH}（30s 超时，异步提交秒级入队）</li>
 *   <li>poll：GET {POLL_PATH_PREFIX}{task_id}（10s 超时）——三个 MediaKit 异步工具共用
 *       同一条查询路由，路径不含 async 段（IKH67T 实测校准）</li>
 * </ul>
 * ⚠️ 网关路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）。
 * 鉴权与家族同构（契约 §5 / ADR-0080）：Authorization: Bearer 任务冻结的用户 sk-
 * （processor 从 job.input.provider_credential 取出传入）+ X-Trace-Id +
 * X-Client-System: bluewhale。
 * <p>
 * 出站请求映射（官方 PDF「第 1 步：提交任务」节）：model（对客模型名，网关按模型名路由
 * MediaKit 渠道，本期 model_price 配 0）+ video_url（源视频公网对象存储地址）+
 * resolution（= 任务冻结的目标分辨率，三值枚举同名同值透传）+ bitrate_level（服务端
 * 常量，不从前端传入）。不发 media_output_destination（走默认临时链接 + 自家 TOS 转存，
 * 家族口径）、client_token / callback_* / queue_id（无幂等与回调需求）。
 * <p>
 * 响应形状（官方 PDF「响应说明」+「异步任务结果」节）：submit = {success, task_id,
 * request_id}（success=false 时带 error{code,type,message,param}）；poll 顶层含
 * task_id / status（轮询至 completed 或 failed）与 result{video_url, duration,
 * resolution, fps}——result.video_url 是 24h 有效 HTTPS 临时下载链接（官方「请及时下载保存」），
 * processor 须立即下载转存自家 TOS。status 大小写与中间态枚举官方 PDF 未逐字冻结，
 * 按小写归一容错解析（completed→succeeded、failed→failed、其余→processing）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content &gt; quota &gt; provider_failed，§5 优先级）；
 * poll 的网络超时 / 连接失败 / HTTP 429/5xx 抛错时以 cause 携带状态
 * （{@link NewApiVideoClient.HttpStatusException} 复用），供 processor 按
 * isTransientPollError 语义判定瞬时重排。
 */
@Component
public class NewApiMediaKitEnhanceVideoClient extends NewApiMediaKitAsyncTaskClient {

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；去字幕 / 音视频分离客户端 MODEL
     * 同款集中一处）。候选值 mediakit-enhance-video-generative——最终以网关票确认为准，
     * 有出入只改本常量。
     */
    static final String MODEL = "mediakit-enhance-video-generative";

    public NewApiMediaKitEnhanceVideoClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return VideoEnhanceContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return VideoEnhanceContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "画质增强";
    }

    @Override
    protected String fallbackCode() {
        return VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VideoEnhanceError(code, message);
    }

    /**
     * 提交画质增强异步任务（官方「响应说明」：成功返回 task_id）。
     *
     * @param token      per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param videoUrl   源视频公网对象存储地址
     * @param resolution 任务冻结的目标分辨率（三值枚举 1080p / 2k / 4k，出站同名同值透传官方
     *                   resolution 参数）
     * @return 上游任务 id（processor 存 provider_task_id 后转轮询）
     * @throws VideoEnhanceError 按错误分类抛错
     */
    public String submit(String token, String videoUrl, String resolution) {
        if (resolution == null || !VideoEnhanceContract.SUPPORTED_RESOLUTIONS.contains(resolution)) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "画质增强目标分辨率非法: " + resolution);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("resolution", resolution);
        payload.put("bitrate_level", VideoEnhanceContract.BITRATE_LEVEL);
        return executeSubmit(token, payload);
    }

    /**
     * 查询画质增强异步任务（官方「异步任务结果」节：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带
     *         result.video_url / duration 秒 / resolution 档位 / fps；failed 时带上游错误
     *         文本供 §5 分类与透传）
     * @throws VideoEnhanceError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public EnhanceVideoTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new EnhanceVideoTaskObservation("failed", null, null, null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode videoUrl = body.data().path("result").path("video_url");
            JsonNode duration = body.data().path("result").path("duration");
            JsonNode resolution = body.data().path("result").path("resolution");
            JsonNode fps = body.data().path("result").path("fps");
            return new EnhanceVideoTaskObservation("succeeded",
                    videoUrl.isTextual() ? videoUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    resolution.isTextual() ? resolution.asText() : null,
                    fps.isNumber() ? fps.asDouble() : null,
                    null, null);
        }

        // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new EnhanceVideoTaskObservation("processing", null, null, null, null, null, null);
    }

    /**
     * 画质增强任务观测（对齐去字幕 SubtitleEraseTaskObservation 形态，差异 = 官方
     * result.resolution 档位与 result.fps 帧率——assets 无对应列，processor 按档位推导输出
     * 宽高、帧率落 generation_job_logs payload）。
     * status: succeeded | processing | failed
     */
    public record EnhanceVideoTaskObservation(
            String status,
            /** completed 时的 result.video_url（24h 有效临时链接，调用方须立即下载转存）。 */
            String videoUrl,
            /** completed 时的 result.duration（秒，官方精确值；可 null）。 */
            Double durationSec,
            /** completed 时的 result.resolution（档位字符串如 "1080p"，官方示例值；可 null）。 */
            String resolution,
            /** completed 时的 result.fps（帧率，官方精确值——fps 未传时保持原片；可 null）。 */
            Double fps,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
