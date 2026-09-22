package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSubtitleEraseError;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * new-api 网关 MediaKit 视频去字幕客户端（迁移契约 §17 / IKGZ81；**家族内首个异步任务**：
 * 提交返 task_id + 查询端点轮询取结果，区别于高清/擦除/抠图的单次同步路由。
 * HTTP 骨架自 IKHKMK 起收敛入 {@link NewApiMediaKitAsyncTaskClient}，本类只保留
 * 契约枚举校验、出站 payload 构造与 completed 结果解析）。
 * <p>
 * 端点（网关**对客**路由；网关内部转发火山上游 POST /api/v1/tools/erase-video-subtitle-pro，
 * 参数名与响应形状以火山官方 PDF「提交字幕擦除（精细化版）任务 API」为准）：
 * <ul>
 *   <li>submit：POST /v1/mediakit/erase-video-subtitle-pro（30s 超时，异步提交秒级入队）</li>
 *   <li>poll：GET /v1/mediakit/tasks/{task_id}（10s 超时，视频轮询同窗口）</li>
 * </ul>
 * ⚠️ 网关路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）。
 * 三个 MediaKit 异步工具共用同一条查询路由 /v1/mediakit/tasks/，路径**不含 async 段**。
 * <p>
 * 鉴权与同步家族同构（契约 §5 / ADR-0080）：Authorization: Bearer 任务冻结的用户 sk-
 * （processor 从 job.input.provider_credential 取出传入）+ X-Trace-Id + X-Client-System: bluewhale。
 * <p>
 * 出站请求映射（§17.3，值单处定义在 {@link VideoSubtitleEraseContract}）：
 * <ul>
 *   <li>model：对客模型名 mediakit-erase-video-subtitle-pro（网关按模型名路由 MediaKit 渠道，
 *       本期 model_price 配 0）</li>
 *   <li>video_url：源视频公网对象存储地址</li>
 *   <li>model_version / output_encode_mode：服务端常量（v5 / Quality），不从前端传入</li>
 *   <li>mode：detect_mode 经 {@link VideoSubtitleEraseContract#MODE} 映射（Subtitle / Text）</li>
 *   <li>erase_ratio_location：框列表**非空才发**（空数组走官方默认行为不发键，≤20）</li>
 * </ul>
 * <p>
 * 响应形状（官方 PDF「响应说明」+「异步任务结果」节）：submit = {success, task_id, request_id}
 * （success=false 时带 error{code,type,message,param}）；poll 顶层含 task_id / status
 * （轮询至 completed 或 failed）与 result{video_url, duration}——result.video_url 是
 * 24h 有效临时链接，processor 须立即下载转存。status 大小写与中间态枚举官方 PDF 未
 * 逐字冻结，按小写归一容错解析（completed→succeeded、failed→failed、其余→processing）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content &gt; quota &gt; provider_failed，§5 优先级）；
 * poll 的网络超时 / 连接失败 / HTTP 429/5xx 抛错时以 cause 携带状态（{@link NewApiVideoClient.HttpStatusException}
 * 复用），供 processor 按视频骨架 isTransientPollError 语义判定瞬时重排。
 */
@Component
public class NewApiMediaKitSubtitleEraseClient extends NewApiMediaKitAsyncTaskClient {

    /** 网关异步提交路由路径（对客；网关按路径末段决定工具，见类注释）。 */
    static final String SUBMIT_PATH = "/v1/mediakit/erase-video-subtitle-pro";

    /** 网关异步任务查询路由路径前缀（拼 taskId）：三个 MediaKit 异步工具共用同一条查询
     *  路由，路径不含 async 段。 */
    static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

    /** 对客模型名（§17.1：网关渠道路由 + model_price 配 0 免费口径）。 */
    static final String MODEL = "mediakit-erase-video-subtitle-pro";

    public NewApiMediaKitSubtitleEraseClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiMediaKitSubtitleEraseClient(String baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "去字幕";
    }

    @Override
    protected String fallbackCode() {
        return VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VideoSubtitleEraseError(code, message);
    }

    /**
     * 提交去字幕异步任务（官方「响应说明」：成功返回 task_id）。
     *
     * @param token      per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param videoUrl   源视频公网对象存储地址
     * @param detectMode 本仓检测模式（subtitle_smart / text_full，§17.2 冻结枚举）
     * @param eraseBoxes 归一化框列表（官方 Location 键名同构原样透传；空列表不发 erase_ratio_location 键）
     * @return 上游任务 id（processor 存 provider_task_id 后转轮询）
     * @throws VideoSubtitleEraseError 按错误分类抛错
     */
    public String submit(String token, String videoUrl, String detectMode,
                         List<Map<String, Object>> eraseBoxes) {
        String mode = VideoSubtitleEraseContract.MODE.get(detectMode);
        if (mode == null) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "去字幕检测模式非法: " + detectMode);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("model_version", VideoSubtitleEraseContract.MODEL_VERSION);
        payload.put("mode", mode);
        payload.put("output_encode_mode", VideoSubtitleEraseContract.OUTPUT_ENCODE_MODE);
        // §17.3：空数组 = 不拉框走智能默认，出站不传 erase_ratio_location 键（≤20 由创建入口复核）
        if (eraseBoxes != null && !eraseBoxes.isEmpty()) {
            payload.put("erase_ratio_location", eraseBoxes);
        }
        return executeSubmit(token, payload);
    }

    /**
     * 查询去字幕异步任务（官方「异步任务结果」节：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带 result.video_url
     *         与 result.duration 秒；failed 时带上游错误文本供 §5 分类与透传）
     * @throws VideoSubtitleEraseError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public SubtitleEraseTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new SubtitleEraseTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode videoUrl = body.data().path("result").path("video_url");
            JsonNode duration = body.data().path("result").path("duration");
            return new SubtitleEraseTaskObservation("succeeded",
                    videoUrl.isTextual() ? videoUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new SubtitleEraseTaskObservation("processing", null, null, null, null);
    }

    /**
     * 去字幕任务观测（对齐 NewApiVideoClient.VideoTaskObservation 形态，差异 = 官方
     * result.duration 秒与上游错误文本）。
     * status: succeeded | processing | failed
     */
    public record SubtitleEraseTaskObservation(
            String status,
            /** completed 时的 result.video_url（24h 有效临时链接，调用方须立即下载转存）。 */
            String videoUrl,
            /** completed 时的 result.duration（秒，官方精确值；可 null）。 */
            Double durationSec,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) {}
}
