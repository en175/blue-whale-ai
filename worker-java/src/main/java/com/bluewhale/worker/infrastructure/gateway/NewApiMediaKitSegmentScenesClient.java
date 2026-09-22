package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.VideoSceneSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSceneSplitError;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * new-api 网关 MediaKit 场景切分客户端（IKH8BP，父规格 IKH86V；以
 * {@link NewApiMediaKitExtractAudioClient} 为模板——家族第四个 MediaKit 异步任务：
 * 提交返 task_id + 查询端点轮询取 result.duration + result.segments[]。HTTP 骨架自
 * IKHKMK 起收敛入 {@link NewApiMediaKitAsyncTaskClient}，本类只保留契约枚举校验、
 * 出站 payload 构造与 completed 结果解析）。
 * <p>
 * 端点（网关**对客**路径，常量单源在 {@link VideoSceneSplitContract}，IKH8BH 契约冻结）：
 * <ul>
 *   <li>submit：POST {SUBMIT_PATH}（30s 超时，异步提交秒级入队）</li>
 *   <li>poll：GET {POLL_PATH_PREFIX}{task_id}（10s 超时）——四个 MediaKit 异步工具共用
 *       同一条查询路由，路径不含 async 段（IKH67T 实测校准）</li>
 * </ul>
 * ⚠️ 网关路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）。
 * 火山上游侧对应 POST /api/v1/tools/segment-scenes，由网关内部转发，本仓不直连上游。
 * 鉴权与家族同构（契约 §5 / ADR-0080）：Authorization: Bearer 任务冻结的用户 sk-
 * （processor 从 job.input.provider_credential 取出传入）+ X-Trace-Id +
 * X-Client-System: bluewhale。
 * <p>
 * 出站请求映射（官方 PDF「第 1 步：提交任务」+「调整切分粒度」节）：model（对客模型名，
 * 网关按模型名路由 MediaKit 渠道，本期 model_price 配 0）+ video_url（源视频公网对象
 * 存储地址）+ segment_threshold（= 任务冻结的 granularity 经
 * {@link VideoSceneSplitContract#SEGMENT_THRESHOLD} 映射的数值，[0,100) 值越低切得越细）。
 * 不发 min_duration（默认 3s）/ max_duration（默认 30s）/ enable_clip_fade（默认 false）/
 * return_segment_videos（默认 true）——一律走服务端默认（规格「高级参数不暴露」）；不发
 * client_token / callback_* / queue_id（无幂等与回调需求）。
 * <p>
 * 响应形状（官方 PDF「响应说明」+「异步任务结果」节）：submit = {success, task_id,
 * request_id}（success=false 时带 error{code,type,message,param}）；poll 顶层含 task_id /
 * status（running / completed / failed，查询窗口 30 天）与 result{duration, segments[]}——
 * segments[] 每段 start_time / end_time / segment_video_url（切片恒 MP4，链接 24h 有效），
 * processor 须逐段立即转存自家 TOS。两阶段切分（threshold+min 初切、超 max 强制再切）
 * 由上游完成，返回结果照单全收（含整片仅 1 段，不特判）。status 大小写与中间态枚举
 * 官方 PDF 未逐字冻结，按小写归一容错解析（completed→succeeded、failed→failed、
 * 其余→processing）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content &gt; quota &gt; provider_failed，§5 优先级）；
 * poll 的网络超时 / 连接失败 / HTTP 429/5xx 抛错时以 cause 携带状态
 * （{@link NewApiVideoClient.HttpStatusException} 复用），供 processor 按
 * isTransientPollError 语义判定瞬时重排。
 */
@Component
public class NewApiMediaKitSegmentScenesClient extends NewApiMediaKitAsyncTaskClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiMediaKitSegmentScenesClient.class);

    /** 网关异步提交路由路径（对客；契约常量单源，IKH67T：禁止写火山上游路径）。 */
    static final String SUBMIT_PATH = VideoSceneSplitContract.SUBMIT_PATH;

    /** 网关异步任务查询路由路径前缀（拼 taskId；契约常量单源）。 */
    static final String POLL_PATH_PREFIX = VideoSceneSplitContract.POLL_PATH_PREFIX;

    /** 对客模型名（契约常量单源：网关渠道路由 + model_price 配 0 免费口径）。 */
    static final String MODEL = VideoSceneSplitContract.MODEL_NAME;

    public NewApiMediaKitSegmentScenesClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiMediaKitSegmentScenesClient(String baseUrl) {
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
        return "场景切分";
    }

    @Override
    protected String fallbackCode() {
        return VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VideoSceneSplitError(code, message);
    }

    /**
     * 提交场景切分异步任务（官方「响应说明」：成功返回 task_id）。
     *
     * @param token       per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param videoUrl    源视频公网对象存储地址
     * @param granularity 任务冻结的切分粒度档（fine / standard / coarse，IKH8BH 契约枚举；
     *                    出站经契约 SEGMENT_THRESHOLD 映射官方 segment_threshold 数值）
     * @return 上游任务 id（processor 存 provider_task_id 后转轮询）
     * @throws VideoSceneSplitError 按错误分类抛错
     */
    public String submit(String token, String videoUrl, String granularity) {
        Integer threshold = VideoSceneSplitContract.SEGMENT_THRESHOLD.get(granularity);
        if (threshold == null) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "场景切分粒度非法: " + granularity);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("segment_threshold", threshold);
        return executeSubmit(token, payload);
    }

    /**
     * 查询场景切分异步任务（官方「异步任务结果」节：轮询至 completed / failed，窗口 30 天）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带 result.duration
     *         秒与 result.segments[]（每段起止秒 + segment_video_url，链接 24h 有效）；failed 时
     *         带上游错误文本供 §5 分类与透传）
     * @throws VideoSceneSplitError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public SceneSplitTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（code/message/param/type——TaskError / ApiError）与
            // 顶层 message 都读、取非空合并
            return new SceneSplitTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode result = body.data().path("result");
            Double durationSec = result.path("duration").isNumber()
                    ? result.path("duration").asDouble() : null;
            List<SegmentObservation> segments = parseSegments(result.path("segments"));
            return new SceneSplitTaskObservation("succeeded", durationSec, segments,
                    null, null);
        }

        // running / queued 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new SceneSplitTaskObservation("processing", null, null, null, null);
    }

    // ========== 族特异结果解析 ==========

    /**
     * 官方 result.segments[] 解析：按返回顺序逐段取 start_time / end_time /
     * segment_video_url（两阶段切分结果照单全收）。段行形状非法（任一字段缺失/类型
     * 不符）即抛错整体失败（IKH8BP 审查修复）：与转存环节「任一段失败即整体失败」
     * 口径对齐——静默跳过会缺段，且 processor 的 i+1 重编段序与官方顺序错位，时间轴
     * 出现无告警空洞；segments 非数组 / 空数组仍返回空列表，由 processor 判
     * 「未返回场景段」落兜底失败。
     */
    private static List<SegmentObservation> parseSegments(JsonNode segmentsNode) {
        if (!segmentsNode.isArray()) {
            return List.of();
        }
        List<SegmentObservation> segments = new ArrayList<>();
        int index = 0;
        for (JsonNode item : segmentsNode) {
            index++;
            JsonNode url = item.path("segment_video_url");
            JsonNode start = item.path("start_time");
            JsonNode end = item.path("end_time");
            if (!url.isTextual() || !start.isNumber() || !end.isNumber()) {
                String raw = item.toString();
                if (raw.length() > 200) {
                    raw = raw.substring(0, 200) + "…";
                }
                log.warn("[video_scene_split] 官方段数据形状非法（整体失败口径）第 {} 段: {}",
                        index, raw);
                throw new VideoSceneSplitError(
                        VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                        "场景切分返回段数据不完整（第 " + index
                                + " 段缺少 segment_video_url/start_time/end_time）");
            }
            segments.add(new SegmentObservation(start.asDouble(), end.asDouble(), url.asText()));
        }
        return segments;
    }

    /**
     * 场景切分任务观测（对齐 SubtitleEraseTaskObservation 形态，差异 = result.segments[]
     * 一对多）。status: succeeded | processing | failed。
     */
    public record SceneSplitTaskObservation(
            String status,
            /** completed 时的 result.duration（秒，官方精确值；可 null）。 */
            Double durationSec,
            /** completed 时的 result.segments[]（按返回顺序；segment_video_url 24h 有效临时
             *  链接，调用方须逐段立即下载转存；两阶段切分结果照单全收，1 段与 N 段同构）。 */
            List<SegmentObservation> segments,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) {}

    /** 官方段观测（start_time / end_time 同名同值透传；segment_video_url 为火山 24h 临时链接）。 */
    public record SegmentObservation(
            /** 段起始秒（官方 start_time）。 */
            double startTimeSec,
            /** 段结束秒（官方 end_time）。 */
            double endTimeSec,
            /** 段切片临时链接（恒 MP4，24h 有效；不进跨进程契约——转存自有存储后以 Asset 引用）。 */
            String segmentVideoUrl
    ) {}
}
