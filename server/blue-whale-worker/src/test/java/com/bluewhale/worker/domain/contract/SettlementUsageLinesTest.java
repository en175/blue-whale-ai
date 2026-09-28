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
                job("video", "{\"model_id\":\"m\"}"), 1, 50_638L, null);

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
                job("video", "{\"model_id\":\"m\"}"), 1, null, null);

        @SuppressWarnings("unchecked")
        Map<String, Object> quantities = (Map<String, Object>) lines.get(0).get("quantities");
        assertThat(quantities).doesNotContainKey("usage.c");
    }

    /* ── 音频按产出秒数（usage.seconds）────────────────────────────────────────────
     *
     * 火山官方对 Seed Audio 1.0 的口径是「0.3 元/分钟，按模型**原始输出时长**计费、
     * 精确至秒」。目录里那条规则因此以 usage.seconds 为基准维度 ——
     * 而 billing 有一条**基准维度守卫**：规则以某维度为基准、worker 却没报它，
     * 结算侧直接**拒绝计价**（MQ 重投 → 死信 → 红灯），不会按 0 秒白送。
     * 所以这几条钉的不是「字段有没有出现」，是「钱能不能算出来」。
     */

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
        // 槽数与参考数照旧恒上报 —— 按秒计价不改变这两个维度的口径
        assertThat(quantities).containsEntry("usage.succeededSlots", 1);
        assertThat(quantities).containsEntry("usage.referenceCount", 0);
    }

    @Test
    @DisplayName("★ 取不到秒数 → 整个维度不出现（让 billing 拒绝，而不是按 0 秒白送）")
    void 无秒数不填零() {
        // 填 0 会被 billing 当成「报过、且真的是 0 秒」——那次生成就是免费的，
        // 而且账面上看不出任何异常（基准维度的键在、值也合法）。
        assertThat(quantitiesOf(job("audio", "{\"model_id\":\"m\"}"), null, null))
                .doesNotContainKey("usage.seconds");
        // 0 与 null 同待遇：产出存在却报 0 秒，那不是「免费的音频」而是「没量到」
        assertThat(quantitiesOf(job("audio", "{\"model_id\":\"m\"}"), null, 0L))
                .doesNotContainKey("usage.seconds");
    }

    @Test
    @DisplayName("★ token 与秒数是**两条独立路径**，互不替代也不互相带出")
    void token与秒数互不干扰() {
        // 视频按 token、音频按秒 —— 两条规则各取各的基准维度。混在一起报会让
        // 「这次该报哪个」没人说得清，而报错的后果是拒绝计价或按 0 计价。
        Map<String, Object> videoOnly =
                quantitiesOf(job("video", "{\"model_id\":\"m\"}"), 50_638L, null);
        assertThat(videoOnly).containsEntry("usage.c", 50_638L);
        assertThat(videoOnly).doesNotContainKey("usage.seconds");
    }
}
