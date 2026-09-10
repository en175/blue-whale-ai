package com.bluewhale.worker.messaging;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;

/**
 * MQ 消息体。契约文档 §1 已冻结：消息体恒为 {@code {"jobId":"<字符串>"}}——
 * 无类型判别字段、无重试计数。多余字段容忍但禁止依赖
 * （TS 侧 JSON.parse 后只读 jobId，效果等价）。
 *
 * <p>毒丸语义（契约 §1）：体不可解析或 jobId 非字符串 → ack 后丢弃。
 * 这里用 JsonNode.isTextual 做严格判定，对齐 TS 的 {@code typeof jobId === "string"}：
 * Jackson 默认会把数字 42 强转成字符串 "42"——这是一次跨语言真漂移，
 * 被 GenerationMessageContractTest 抓到，禁止回退。
 * image/audio 额外要求 jobId 为纯数字（BigInt id）；
 * video/media_extract 接受任意字符串（与 TS 消费者逐一对齐）。
 */
public record GenerationMessage(String jobId) {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** @return 解析成功的消息；null 表示毒丸（调用方须 ack 丢弃，不得重投）。 */
    public static GenerationMessage parse(byte[] body, boolean digitGuard) {
        JsonNode jobId;
        try {
            JsonNode root = MAPPER.readTree(body);
            jobId = root != null && root.isObject() ? root.get("jobId") : null;
        } catch (IOException | RuntimeException e) {
            return null;
        }
        if (jobId == null || !jobId.isTextual()) {
            return null;
        }
        String id = jobId.textValue();
        if (id.isEmpty()) {
            return null;
        }
        if (digitGuard && !id.matches("\\d+")) {
            return null;
        }
        return new GenerationMessage(id);
    }

    /** 生产侧序列化——与 TS 的 JSON.stringify({ jobId }) 形状完全一致。 */
    public static String encode(String jobId) {
        try {
            return MAPPER.writeValueAsString(new GenerationMessage(jobId));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
