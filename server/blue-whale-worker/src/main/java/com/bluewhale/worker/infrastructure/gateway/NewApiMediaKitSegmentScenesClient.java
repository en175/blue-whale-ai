package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoSceneSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSceneSplitError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class NewApiMediaKitSegmentScenesClient extends NewApiMediaKitAsyncTaskClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiMediaKitSegmentScenesClient.class);

    /** 网关异步提交路由路径（对客；契约常量单源，IKH67T：禁止写火山上游路径）。 */
    static final String SUBMIT_PATH = VideoSceneSplitContract.SUBMIT_PATH;

    /** 网关异步任务查询路由路径前缀（拼 taskId；契约常量单源）。 */
    static final String POLL_PATH_PREFIX = VideoSceneSplitContract.POLL_PATH_PREFIX;

    /** 对客模型名（契约常量单源：网关渠道路由 + model_price 配 0 免费口径）。 */
    static final String MODEL = VideoSceneSplitContract.MODEL_NAME;

    public NewApiMediaKitSegmentScenesClient(UpstreamBaseUrl baseUrl) {
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
    ) implements ParentTaskObservation {}

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
