package com.bluewhale.worker.domain.contract;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SettlementUsageLinesTest {

    private static GenerationJobEntity job(String type, String inputJson) {
        GenerationJobEntity job = new GenerationJobEntity();
        job.setId(1L);
        job.setUserId(2L);
        job.setType(type);
        job.setInput(inputJson);
        return job;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, String> specsOf(GenerationJobEntity job) {
        List<Map<String, Object>> lines = SettlementUsageLines.forJob(job, 1, 12_345L, null);
        assertThat(lines).hasSize(1);
        return (Map<String, String>) lines.get(0).get("specs");
    }

    @Test
    @DisplayName("视频参考带时长 → 折算成 video_input_seconds（= 各条之和）")
    void 输入时长折算() {
        Map<String, String> specs = specsOf(job("video",
                "{\"model_id\":\"m\",\"duration\":5,\"references\":["
                        + "{\"role\":\"reference\",\"type\":\"video\",\"asset_id\":\"2\",\"duration\":5},"
                        + "{\"role\":\"reference\",\"type\":\"video\",\"asset_id\":\"3\",\"duration\":8}]}"));

        assertThat(specs).containsEntry("video", "1");
        assertThat(specs).containsEntry("video_input_seconds", "13");
    }

    @Test
    @DisplayName("★ 量不到输入时长 → 整个键不写（不按 0 估，由 billing 判「取不到」）")
    void 量不到就不写() {
        Map<String, String> specs = specsOf(job("video",
                "{\"model_id\":\"m\",\"references\":["
                        + "{\"role\":\"reference\",\"type\":\"video\",\"asset_id\":\"2\",\"duration\":5},"
                        + "{\"role\":\"reference\",\"type\":\"video\",\"asset_id\":\"3\"}]}"));

        assertThat(specs).containsEntry("video", "1");
        assertThat(specs).doesNotContainKey("video_input_seconds");
    }

    @Test
    @DisplayName("没有视频参考 / 只有图片参考 → 不写这个键（那一项本来就不加）")
    void 非视频输入不写() {
        Map<String, String> onlyImage = specsOf(job("video",
                "{\"model_id\":\"m\",\"references\":["
                        + "{\"role\":\"reference\",\"type\":\"image\",\"asset_id\":\"2\",\"duration\":5}]}"));
        assertThat(onlyImage).containsEntry("video", "0");
        assertThat(onlyImage).doesNotContainKey("video_input_seconds");

        Map<String, String> noRefs = specsOf(job("video", "{\"model_id\":\"m\"}"));
        assertThat(noRefs).containsEntry("video", "0");
        assertThat(noRefs).doesNotContainKey("video_input_seconds");
    }

    @Test
    @DisplayName("上游真实 token 上报为 usage.c（视频按 token 结算的权威用量）")
    void 上报token() {
        List<Map<String, Object>> lines = SettlementUsageLines.forJob(
                job("video", "{\"model_id\":\"m\"}"), 1, 50_638L, null);

        @SuppressWarnings("unchecked")
        Map<String, Object> quantities = (Map<String, Object>) lines.get(0).get("quantities");
        assertThat(quantities).containsEntry("usage.c", 50_638L);
        assertThat(quantities).containsEntry("usage.referenceCount", 0);
    }

    @Test
    @DisplayName("上游没报 token → 整个维度不出现（结算退回按预扣额，不是填 0 伪装成免费）")
    void 无token不填零() {
        List<Map<String, Object>> lines = SettlementUsageLines.forJob(
                job("video", "{\"model_id\":\"m\"}"), 1, null, null);

        @SuppressWarnings("unchecked")
        Map<String, Object> quantities = (Map<String, Object>) lines.get(0).get("quantities");
        assertThat(quantities).doesNotContainKey("usage.c");
    }


    @SuppressWarnings("unchecked")
    private static Map<String, Object> quantitiesOf(GenerationJobEntity job, Long tokens, Long seconds) {
        List<Map<String, Object>> lines = SettlementUsageLines.forJob(job, 1, tokens, seconds);
        assertThat(lines).hasSize(1);
        return (Map<String, Object>) lines.get(0).get("quantities");
    }

    @Test
    @DisplayName("★ 音频上报产出秒数为 usage.seconds（按秒计价的权威用量）")
    void 上报audio秒数() {
        Map<String, Object> quantities =
                quantitiesOf(job("audio", "{\"model_id\":\"seed-audio-1.0\"}"), null, 42L);

        assertThat(quantities).containsEntry("usage.seconds", 42L);
        assertThat(quantities).containsEntry("usage.succeededSlots", 1);
        assertThat(quantities).containsEntry("usage.referenceCount", 0);
    }

    @Test
    @DisplayName("★ 取不到秒数 → 整个维度不出现（让 billing 拒绝，而不是按 0 秒白送）")
    void 无秒数不填零() {
        assertThat(quantitiesOf(job("audio", "{\"model_id\":\"m\"}"), null, null))
                .doesNotContainKey("usage.seconds");
        assertThat(quantitiesOf(job("audio", "{\"model_id\":\"m\"}"), null, 0L))
                .doesNotContainKey("usage.seconds");
    }

    @Test
    @DisplayName("★ token 与秒数是**两条独立路径**，互不替代也不互相带出")
    void token与秒数互不干扰() {
        Map<String, Object> videoOnly =
                quantitiesOf(job("video", "{\"model_id\":\"m\"}"), 50_638L, null);
        assertThat(videoOnly).containsEntry("usage.c", 50_638L);
        assertThat(videoOnly).doesNotContainKey("usage.seconds");
    }
}
