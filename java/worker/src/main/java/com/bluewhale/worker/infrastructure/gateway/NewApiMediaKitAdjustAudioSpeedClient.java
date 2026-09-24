package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.AudioSpeedContract;
import com.bluewhale.worker.domain.error.AudioSpeedError;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * new-api 网关 MediaKit 音频调速客户端（IKHW5A，父单 IKHVYO；以
 * {@link NewApiMediaKitTrimAudioClient} 为模板——家族内又一个 MediaKit 异步任务：
 * 提交返 task_id + 查询端点轮询取 result.audio_url / result.duration。HTTP 骨架复用
 * {@link NewApiMediaKitAsyncTaskClient}，本类只保留出站 payload 构造与 completed
 * 结果解析——调速无格式参数与时间区间，出站仅 audio_url + 可选 speed）。
 * <p>
 * 端点（网关**对客**路径；网关内部转发火山上游 POST /api/v1/tools/adjust-audio-speed.
 * 路径常量单源在 {@link AudioSpeedContract}，契约票 IKHW48 已冻结）：
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
 * 出站请求映射（官方 CLI 参考文档 submit 参数节）：model（对客模型名，网关按模型名路由
 * MediaKit 渠道，本期 model_price 配 0）+ audio_url（源音频公网对象存储地址）+ speed
 * （**可选**：贴原速省略口径 ADR-0113——恰为 1.0 原速时创建入口已省略冻结，本客户端
 * null 即不出键，走官方默认 1；范围 [0.1, 4.0]、最多两位小数由创建入口复核，出站原样
 * 透传）。不发 format（父单决策无格式下拉，产物跟随官方默认 m4a）、
 * media_output_destination（走默认临时链接 + 自家 TOS 转存，家族口径）、
 * client_token / callback_* / queue_id（无幂等与回调需求）。
 * <p>
 * 响应形状（官方 CLI 参考文档「提交音频调速任务」节）：submit =
 * {success, task_id, request_id}（success=false 时带 error{code,type,message,param}）；
 * poll 顶层含 task_id / status（轮询至 completed 或 failed）与
 * result{audio_url, duration}——result.audio_url 是 24h 有效 HTTPS 临时下载链接，
 * processor 须立即转存自家 TOS；result.duration 是输出音频时长（秒）。status 大小写与
 * 中间态枚举官方文档未逐字冻结，按小写归一容错解析（completed→succeeded、
 * failed→failed、其余→processing）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content &gt; quota &gt; provider_failed，§5 优先级，
 * 兜底归并 audio_speed_failed 1051；网关错误不透传英文）；poll 的网络超时 / 连接失败 /
 * HTTP 429/5xx 抛错时以 cause 携带状态（{@link NewApiVideoClient.HttpStatusException}
 * 复用），供 processor 按 isTransientPollError 语义判定瞬时重排。
 */
@Component
public class NewApiMediaKitAdjustAudioSpeedClient extends NewApiMediaKitAsyncTaskClient {

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；音频截取客户端 MODEL 同款集中一处）。
     * 候选值 mediakit-adjust-audio-speed——最终以网关配置票确认为准，有出入只改本常量。
     */
    static final String MODEL = "mediakit-adjust-audio-speed";

    public NewApiMediaKitAdjustAudioSpeedClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiMediaKitAdjustAudioSpeedClient(String baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return AudioSpeedContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return AudioSpeedContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "音频调速";
    }

    @Override
    protected String fallbackCode() {
        return AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new AudioSpeedError(code, message);
    }

    /**
     * 提交音频调速异步任务（官方「提交音频调速任务」节：成功返回 task_id）。
     *
     * @param token    per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param audioUrl 源音频公网对象存储地址
     * @param speed    播放倍速（[0.1, 4.0]、最多两位小数；**可 null**——贴原速省略口径下
     *                 创建入口已省略，null 即不出键，走官方默认 1）
     * @return 上游任务 id（processor 存 provider_task_id 后转轮询）
     * @throws AudioSpeedError 按错误分类抛错
     */
    public String submit(String token, String audioUrl, Double speed) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("audio_url", audioUrl);
        if (speed != null) {
            payload.put("speed", speed);
        }
        return executeSubmit(token, payload);
    }

    /**
     * 查询音频调速异步任务（官方「查询任务」节：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带
     *         result.audio_url 与 result.duration 秒；failed 时带上游错误文本供 §5 分类与透传）
     * @throws AudioSpeedError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public AudioSpeedTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new AudioSpeedTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            // 官方文档正文与示例均为 result.*（IKHW48 逐字复核证实）；output.* 双读纯为
            // 家族同构容错（trim-audio 官方 PDF 曾自相矛盾，网关转发形状不受本仓控制），
            // 不存在时静默落 null
            JsonNode result = body.data().path("result");
            JsonNode output = body.data().path("output");
            JsonNode audioUrl = result.hasNonNull("audio_url")
                    ? result.path("audio_url") : output.path("audio_url");
            JsonNode duration = result.hasNonNull("duration")
                    ? result.path("duration") : output.path("duration");
            return new AudioSpeedTaskObservation("succeeded",
                    audioUrl.isTextual() ? audioUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new AudioSpeedTaskObservation("processing", null, null, null, null);
    }

    /**
     * 音频调速任务观测（对齐家族 TrimAudioTaskObservation 形态，差异 = 官方
     * result.audio_url 与 result.duration 秒）。
     * status: succeeded | processing | failed
     */
    public record AudioSpeedTaskObservation(
            String status,
            /** completed 时的 result.audio_url（24h 有效临时链接，调用方须立即下载转存）。 */
            String audioUrl,
            /** completed 时的 result.duration（秒，官方精确值；可 null）。 */
            Double durationSec,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) {}
}
