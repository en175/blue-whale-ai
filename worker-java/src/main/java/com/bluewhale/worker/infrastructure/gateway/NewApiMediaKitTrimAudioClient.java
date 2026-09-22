package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.AudioTrimContract;
import com.bluewhale.worker.domain.error.AudioTrimError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * new-api 网关 MediaKit 音频裁剪（音频截取）客户端（IKHB6S，父单 IKHB08；以
 * {@link NewApiMediaKitExtractAudioClient} 为模板——家族内第五个 MediaKit 异步任务：
 * 提交返 task_id + 查询端点轮询取 result.audio_url / result.duration。HTTP 骨架自
 * IKHKMK 起收敛入 {@link NewApiMediaKitAsyncTaskClient}，本类只保留契约枚举校验、
 * 出站 payload 构造与 completed 结果解析）。
 * <p>
 * 端点（网关**对客**路径；网关内部转发火山上游 POST /api/v1/tools/trim-audio.
 * 路径常量单源在 {@link AudioTrimContract}，契约票 IKHB6F 已冻结）：
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
 * 出站请求映射（官方 PDF Body 参数节）：model（对客模型名，网关按模型名路由 MediaKit 渠道，
 * 本期 model_price 配 0）+ audio_url（源音频公网对象存储地址）+ start_time / end_time
 * （**可选**：贴边省略口径 ADR-0111——选区左缘贴 0 / 右缘贴源全长时创建入口已省略冻结，
 * 本客户端 null 即不出键，走官方默认片头 0 / 片尾）+ format（= 任务冻结的 output_format，
 * 五值枚举同名同值透传，缺省 m4a 由创建入口落定）。不发 media_output_destination
 * （走默认临时链接 + 自家 TOS 转存，家族口径）、client_token / callback_* / queue_id
 * （无幂等与回调需求）。
 * <p>
 * 响应形状（官方 PDF「响应说明」+「异步任务结果」节逐字）：submit =
 * {success, task_id, request_id}（success=false 时带 error{code,type,message,param}）；
 * poll 顶层含 task_id / status（轮询至 completed 或 failed）与 result{audio_url, duration}——
 * result.audio_url 是 24h 有效 HTTPS 临时下载链接（官方「请及时下载保存」），processor 须
 * 立即转存自家 TOS。status 大小写与中间态枚举官方 PDF 未逐字冻结，按小写归一容错解析
 * （completed→succeeded、failed→failed、其余→processing）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content &gt; quota &gt; provider_failed，§5 优先级，
 * 兜底归并 audio_trim_failed 1048；网关错误不透传英文）；poll 的网络超时 / 连接失败 /
 * HTTP 429/5xx 抛错时以 cause 携带状态（{@link NewApiVideoClient.HttpStatusException}
 * 复用），供 processor 按 isTransientPollError 语义判定瞬时重排。
 */
@Component
public class NewApiMediaKitTrimAudioClient extends NewApiMediaKitAsyncTaskClient {

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；音视频分离客户端 MODEL 同款集中一处）。
     * 候选值 mediakit-trim-audio——最终以网关配置票确认为准，有出入只改本常量。
     */
    static final String MODEL = "mediakit-trim-audio";

    public NewApiMediaKitTrimAudioClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiMediaKitTrimAudioClient(String baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return AudioTrimContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return AudioTrimContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "音频截取";
    }

    @Override
    protected String fallbackCode() {
        return AudioTrimContract.ERROR_AUDIO_TRIM_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new AudioTrimError(code, message);
    }

    /**
     * 提交音频裁剪异步任务（官方「响应说明」：成功返回 task_id）。
     *
     * @param token        per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param audioUrl     源音频公网对象存储地址
     * @param startTime    截取开始时间（秒，最多两位小数；**可 null**——贴边省略口径下
     *                     创建入口已省略，null 即不出键，走官方默认「从音频开头开始」）
     * @param endTime      截取结束时间（秒，最多两位小数；**可 null**——贴边省略口径下
     *                     null 即不出键，走官方默认「裁剪到输入音频末尾」）
     * @param outputFormat 任务冻结的输出格式（五值枚举，出站映射官方 format 参数）
     * @return 上游任务 id（processor 存 provider_task_id 后转轮询）
     * @throws AudioTrimError 按错误分类抛错
     */
    public String submit(String token, String audioUrl, Double startTime, Double endTime,
                         String outputFormat) {
        if (outputFormat == null || !AudioTrimContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "音频截取输出格式非法: " + outputFormat);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("audio_url", audioUrl);
        if (startTime != null) {
            payload.put("start_time", startTime);
        }
        if (endTime != null) {
            payload.put("end_time", endTime);
        }
        payload.put("format", outputFormat);
        return executeSubmit(token, payload);
    }

    /**
     * 查询音频裁剪异步任务（官方「异步任务结果」节：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带
     *         result.audio_url 与 result.duration 秒；failed 时带上游错误文本供 §5 分类与透传）
     * @throws AudioTrimError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public TrimAudioTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new TrimAudioTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            // 官方 PDF 自相矛盾：正文表格写 result.*、「最终的完整任务信息示例」JSON 却是
            // output.*——result 优先、output 兜底双读，防 completed 被误读成无结果
            JsonNode result = body.data().path("result");
            JsonNode output = body.data().path("output");
            JsonNode audioUrl = result.hasNonNull("audio_url")
                    ? result.path("audio_url") : output.path("audio_url");
            JsonNode duration = result.hasNonNull("duration")
                    ? result.path("duration") : output.path("duration");
            return new TrimAudioTaskObservation("succeeded",
                    audioUrl.isTextual() ? audioUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new TrimAudioTaskObservation("processing", null, null, null, null);
    }

    /**
     * 音频裁剪任务观测（对齐家族 ExtractAudioTaskObservation 形态，差异 = 官方
     * result.audio_url 与 result.duration 秒）。
     * status: succeeded | processing | failed
     */
    public record TrimAudioTaskObservation(
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
