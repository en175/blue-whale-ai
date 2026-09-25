package com.bluewhale.worker.domain.contract;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 结算用量行的**规格折算** —— 与预扣侧（{@code billing-specs.ts}）逐条对齐的那部分。
 *
 * <p>这里钉的是「参考视频的时长有没有进规格」：视频按 token 计费，火山官方公式在
 * **含视频输入**时要把输入时长算进 token（{@code (输入时长 + 输出时长) × 宽 × 高 × 帧率 ÷ 1024}）。
 * 预扣侧按它冻上限、结算侧按同一份规格复现价 —— 两边口径漂一点就是「预扣按一个数冻、
 * 结算按另一个数收」，而账面上没有任何一处能解释这个差。
 */
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
        List<Map<String, Object>> lines = SettlementUsageLines.forJob(job, 1, 12_345L);
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
        // 只要有一条视频参考没带时长，这次就是量不到：**不把其余几条加起来凑一个偏小的数**
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
                job("video", "{\"model_id\":\"m\"}"), 1, 50_638L);

        @SuppressWarnings("unchecked")
        Map<String, Object> quantities = (Map<String, Object>) lines.get(0).get("quantities");
        assertThat(quantities).containsEntry("usage.c", 50_638L);
        // 参考素材数恒上报（含 0）——预扣按它加过价，结算不报就会把加价全额退回去
        assertThat(quantities).containsEntry("usage.referenceCount", 0);
    }

    @Test
    @DisplayName("上游没报 token → 整个维度不出现（结算退回按预扣额，不是填 0 伪装成免费）")
    void 无token不填零() {
        List<Map<String, Object>> lines = SettlementUsageLines.forJob(
                job("video", "{\"model_id\":\"m\"}"), 1, null);

        @SuppressWarnings("unchecked")
        Map<String, Object> quantities = (Map<String, Object>) lines.get(0).get("quantities");
        assertThat(quantities).doesNotContainKey("usage.c");
    }
}
