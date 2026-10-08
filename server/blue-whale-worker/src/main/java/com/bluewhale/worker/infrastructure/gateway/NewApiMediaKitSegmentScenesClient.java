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

    static final String SUBMIT_PATH = VideoSceneSplitContract.SUBMIT_PATH;

    static final String POLL_PATH_PREFIX = VideoSceneSplitContract.POLL_PATH_PREFIX;

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
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "场景切分粒度非法: " + granularity);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("segment_threshold", threshold);
        return executeSubmit(token, payload);
    }

    public SceneSplitTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
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

        return new SceneSplitTaskObservation("processing", null, null, null, null);
    }


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

    public record SceneSplitTaskObservation(
            String status,
            Double durationSec,
            List<SegmentObservation> segments,
            String upstreamCode,
            String upstreamMessage
    ) implements ParentTaskObservation {}

    public record SegmentObservation(
            double startTimeSec,
            double endTimeSec,
            String segmentVideoUrl
    ) {}
}
