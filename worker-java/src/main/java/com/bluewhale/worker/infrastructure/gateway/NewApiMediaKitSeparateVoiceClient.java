package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.VocalSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VocalSplitError;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * new-api 网关 MediaKit 人声背景音分离客户端（IKHA2J；契约 =
 * backend/libs/contracts/vocal-split.ts，以 {@link NewApiMediaKitExtractAudioClient} 为模板
 * ——家族内第四个 MediaKit 异步任务：提交返 task_id + 查询端点轮询按 scene 取 result 的
 * 2/3 个音轨 URL 与 duration。HTTP 骨架自 IKHKMK 起收敛入
 * {@link NewApiMediaKitAsyncTaskClient}，本类只保留契约枚举校验、出站 payload 构造
 * 与 completed 多轨结果解析）。
 * <p>
 * 端点（网关**对客**路径，常量单源在 {@link VocalSplitContract}，契约票 IKHA2C 已冻结）：
 * <ul>
 *   <li>submit：POST {SUBMIT_PATH}（30s 超时，异步提交秒级入队；本值按家族惯例预占位，
 *       网关票定稿后回填契约常量，客户端不另写第二个路径）</li>
 *   <li>poll：GET {POLL_PATH_PREFIX}{task_id}（10s 超时）——MediaKit 异步工具共用同一条
 *       查询路由，路径不含 async 段（IKH67T 实测校准）</li>
 * </ul>
 * ⚠️ 网关路径 ≠ 火山上游路径：混用即 404 Invalid URL，任务卡在提交相（IKH67T）。
 * 鉴权与家族同构（契约 §5 / ADR-0080）：Authorization: Bearer 任务冻结的用户 sk-
 * （processor 从 job.input.provider_credential 取出传入）+ X-Trace-Id +
 * X-Client-System: bluewhale。
 * <p>
 * 出站请求映射（官方 PDF「第 1 步：提交任务」+「进阶使用：选择分离场景」节）：model（对客
 * 模型名，网关按模型名路由 MediaKit 渠道，本期 model_price 配 0）+ video_url / audio_url
 * （源素材公网地址，按源 Asset 类型二选一）+ scene（= 任务冻结的产品小写键经
 * {@link VocalSplitContract#SCENE_UPSTREAM_MAP} 换算官方首字母大写枚举，**不是**
 * extract-audio 无 scene）+ output_format（= 任务冻结格式五值同名同值透传，**提交参数名是
 * output_format，不是 extract-audio 的 format**）。不发 media_output_destination（走默认
 * 24h 临时链接 + 自家 TOS 转存，家族口径）、client_token / callback_*（无幂等与回调需求）。
 * <p>
 * 响应形状（官方 PDF「第 1 步」「第 2 步」节逐字）：submit = {success, task_id, request_id}
 * （success=false 时带 error{code,type,message,param}）；poll 顶层含 task_id /
 * task_type="separate-voice" / status（轮询至 completed 或 failed）与
 * result{voice_audio_url, background_audio_url, music_audio_url?, sfx_audio_url?, duration}——
 * 二分法（Audio/Music）只有 voice/background 两键，三分法（Drama/Narrate）多 music/sfx
 * 两键；各 URL 是 24h 有效 HTTPS 临时下载链接（官方「有效期 24 小时」），processor 须立即
 * 逐轨转存自家 TOS。轨结果对内以轨类型键（voice/background/music/sfx）承载（契约口径：
 * URL 键名是供应商传输细节），映射单源在本类 TRACK_URL_KEYS。status 中间态枚举官方未逐字
 * 冻结，按小写归一容错解析（completed→succeeded、failed→failed、其余→processing）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content &gt; quota &gt; provider_failed，§5 优先级；
 * 网关错误与火山 failed 双路），保留既有码投影，其余由 processor 归并契约兜底码
 * vocal_split_failed（1047）。poll 的网络超时 / 连接失败 / HTTP 429/5xx 抛错时以 cause
 * 携带状态（{@link NewApiVideoClient.HttpStatusException} 复用），供 processor 按
 * isTransientPollError 语义判定瞬时重排。
 */
@Component
public class NewApiMediaKitSeparateVoiceClient extends NewApiMediaKitAsyncTaskClient {

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；家族客户端 MODEL 同款集中一处）。
     * 候选值 mediakit-separate-voice——最终以网关票确认为准，有出入只改本常量。
     */
    static final String MODEL = "mediakit-separate-voice";

    /** 轨类型 → 官方 result URL 键（官方 PDF scene 取值表「输出音轨」列逐字；单源在本类，
     *  契约只冻结轨类型——URL 键名是供应商传输细节，不进跨进程契约）。 */
    private static final Map<String, String> TRACK_URL_KEYS = Map.of(
            "voice", "voice_audio_url",
            "background", "background_audio_url",
            "music", "music_audio_url",
            "sfx", "sfx_audio_url");

    public NewApiMediaKitSeparateVoiceClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiMediaKitSeparateVoiceClient(String baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return VocalSplitContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return VocalSplitContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "人声背景分离";
    }

    @Override
    protected String fallbackCode() {
        return VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VocalSplitError(code, message);
    }

    /**
     * 提交人声背景分离异步任务（官方「第 1 步：提交任务」：成功返回 task_id）。
     *
     * @param token        per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param sourceUrl    源素材公网对象存储地址
     * @param sourceIsVideo true=出站 video_url（源为视频 Asset），false=出站 audio_url（纯音频）
     * @param scene        任务冻结的产品小写场景键（契约四值；此处经 SCENE_UPSTREAM_MAP 换算官方枚举）
     * @param outputFormat 任务冻结的输出格式（契约五值枚举，出站映射官方 output_format 参数同名同值）
     * @return 上游任务 id（processor 存 provider_task_id 后转轮询）
     * @throws VocalSplitError 按错误分类抛错
     */
    public String submit(String token, String sourceUrl, boolean sourceIsVideo,
                         String scene, String outputFormat) {
        if (scene == null || !VocalSplitContract.SUPPORTED_SCENES.contains(scene)) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "人声背景分离场景非法: " + scene);
        }
        if (outputFormat == null || !VocalSplitContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "人声背景分离输出格式非法: " + outputFormat);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        // 官方支持视频 / 音频两种输入（video_url / audio_url 二选一），按源 Asset 类型分叉
        payload.put(sourceIsVideo ? "video_url" : "audio_url", sourceUrl);
        // 出站映射官方首字母大写枚举（契约 SCENE_UPSTREAM_MAP 单源，禁止另行发明字面量）
        payload.put("scene", VocalSplitContract.SCENE_UPSTREAM_MAP.get(scene));
        payload.put("output_format", outputFormat);
        return executeSubmit(token, payload);
    }

    /**
     * 查询人声背景分离异步任务（官方「第 2 步：获取结果」：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带按轨类型键的
     *         结果 URL 集（二分法两轨 / 三分法三轨，值 = 24h 临时链接）与 result.duration 秒；
     *         failed 时带上游错误文本供 §5 分类与透传）
     * @throws VocalSplitError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public SeparateVoiceTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new SeparateVoiceTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            // 逐轨取官方 URL 键（轨类型键承载；二分法只有 voice/background，三分法多
            // music/sfx——按出现即取，不按 scene 预判轨集，缺失轨由 processor 对账）
            JsonNode result = body.data().path("result");
            Map<String, String> trackUrls = new TreeMap<>();
            for (Map.Entry<String, String> entry : TRACK_URL_KEYS.entrySet()) {
                JsonNode urlNode = result.get(entry.getValue());
                if (urlNode != null && urlNode.isTextual() && !urlNode.asText().isEmpty()) {
                    trackUrls.put(entry.getKey(), urlNode.asText());
                }
            }
            JsonNode duration = result.get("duration");
            return new SeparateVoiceTaskObservation("succeeded",
                    trackUrls,
                    duration != null && duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new SeparateVoiceTaskObservation("processing", null, null, null, null);
    }

    /**
     * 人声背景分离任务观测（对齐家族 ExtractAudioTaskObservation 形态，差异 = 多轨：
     * succeeded 时 trackUrls 以轨类型键（voice/background/music/sfx）承载官方
     * result.voice_audio_url / background_audio_url / music_audio_url / sfx_audio_url
     * 的 24h 有效临时链接集（二分法两轨 / 三分法三轨，按出现即取）。
     * status: succeeded | processing | failed
     */
    public record SeparateVoiceTaskObservation(
            String status,
            /** completed 时的轨类型 → 结果 URL（24h 有效临时链接，调用方须立即逐轨转存）。 */
            Map<String, String> trackUrls,
            /** completed 时的 result.duration（秒，官方单值；可 null）。 */
            Double durationSec,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) {}
}
