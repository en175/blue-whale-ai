package com.bluewhale.worker.domain.contract;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 结算事件里的**用量行** —— worker → billing 的原始量上报
 * （契约 {@code contracts/proto/billing/v1/usage.proto}）。
 *
 * <h2>为什么这段必须存在</h2>
 *
 * {@code JobCompletedEvent} 的注释写着「{@code succeeded_slots} 决定 actualCredits
 * （**按成功的 slot 计费**，不是按 job）」。但只发一个标量槽数 billing 是没法计价的：
 * 它手里没有模型、任务类型、规格（预留行上只有金额与版本），而这些是查目录的键。
 * 更根本的是分工——{@code usage.proto} 开宗明义：
 *
 * <pre>
 *   ⚠️ worker **只上报原始量，不上报积分** —— 价格是 billing 的事
 * </pre>
 *
 * 所以「按成功槽计费」的落点是：**worker 报出成功槽数这个量，billing 拿冻结的目录去算**。
 * 本类只做「把量说清楚」，一个积分都不碰。
 *
 * <h2>报什么、不报什么</h2>
 *
 * 只报 worker **真正掌握**的量（{@link #SUCCEEDED_SLOTS}：本次终态实际写下的产物数）。
 * 不报的维度一律**不出现**在 {@code quantities} 里，而不是填 0——
 * billing 对「没报这个维度」和「这个维度是 0」都取 0 参与运算，两者在引擎里没有区别，
 * 但账面上能看出我们到底知不知道这个量。
 *
 * <p>⚠️ {@code usage.seconds} **暂不上报**：终态事件的载荷（{@code status_changed} 的
 * payload）是全家族共用的，今天没有任何一条路径把上游返回的时长放进去——视频/音频
 * processor 手上有那个数，但它写在 assets 行上。要报它得先给 8 条 publish 路径的载荷
 * 加一个时长键，那是另一单的事。**在此之前，目录里若真有规则以 {@code usage.seconds}
 * 为基准维度，billing 会拒绝计价并亮红灯**（见 {@code SettlementService} 的基准维度守卫），
 * 不会静默按 0 收——漏配要吵，不要悄悄少收。
 */
public final class SettlementUsageLines {

    private static final Logger log = LoggerFactory.getLogger(SettlementUsageLines.class);

    /**
     * 成功的输出槽数（图片多张 / 视频多段）——{@code usage.proto} 封闭枚举里属于 worker 的那一项。
     *
     * <p>字面值与 proto 注释、billing 的 {@code UsageDim.SUCCEEDED_SLOTS}、catalog 的
     * {@code baseUnit} 三处**逐字一致**，改一处等于三处都要改。
     */
    public static final String SUCCEEDED_SLOTS = "usage.succeededSlots";

    /**
     * 内容字段 —— **不是定价维度，不进规格**。
     *
     * <p>与 {@code backend/libs/shared/billing/billing-specs.ts} 的 {@code CONTENT_FIELDS}
     * 逐字一致（那边是 Hold / Quote 侧唯一的实现）。
     */
    private static final Set<String> CONTENT_FIELDS = Set.of("prompt", "title");

    private static final ObjectMapper JSON = new ObjectMapper();

    private SettlementUsageLines() {
    }

    /**
     * 为一次终态生成用量行。
     *
     * <p>{@code modelId} / {@code taskType} 必须与预扣那次**同一套**：billing 拿它们去查
     * 冻结版本里的规则，查不到就是 {@code RuleNotFoundException}（拒绝计价，不是免费）。
     * 两者都从 job 行取——{@code input.model_id} 是建任务时冻结的、发布预扣用的那个值；
     * {@code type} 就是建任务时传给 Hold 的 {@code taskType}。
     *
     * @param succeededSlots 本次终态实际写下的产物数（与事件的 {@code succeededSlots} 同一个数，
     *                       见 {@code JobSettlementPublisher#succeededSlots}）
     * @return 一条用量行；**空列表 = 报不出**（job 的 input 里没有 model_id）——
     *         这不是「没有用量」，billing 会退回按预扣额结算，所以调用方要打 WARN
     */
    public static List<Map<String, Object>> forJob(GenerationJobEntity job, int succeededSlots) {
        Map<String, Object> input = parseObject(job.getInput());
        String modelId = input.get("model_id") instanceof String s && !s.isBlank() ? s : null;
        if (modelId == null || job.getType() == null || job.getType().isBlank()) {
            return List.of();
        }
        Map<String, Object> quantities = new LinkedHashMap<>();
        quantities.put(SUCCEEDED_SLOTS, succeededSlots);

        Map<String, Object> line = new LinkedHashMap<>();
        line.put("modelId", modelId);
        line.put("taskType", job.getType());
        line.put("quantities", quantities);
        line.put("specs", specsOf(input));
        return List.of(line);
    }

    /**
     * 规格提取 —— 与 {@code billing-specs.ts} 的 {@code extractSpecs} **逐条对齐**的 Java 镜像。
     *
     * <h2>为什么必须与它同源</h2>
     *
     * 预扣（Hold）用 {@code extractSpecs(建任务时的 input)} 查目录里的规格表得到冻结金额；
     * 结算（Settle）用这里的规格在**同一份**冻结目录里复现那个价。
     * 两份实现只要漂移一点（少取一个键、大小写不一致、数字格式不同），
     * 查到的就是另一行价格——用户看到的「处理中 · 预计消耗 40」与「已完成 · 消耗 30」
     * 会凭空对不上，而账面上没有任何一处能解释这个差。
     *
     * <p>所以规则照抄那边的三条，一条都不加：
     * <ol>
     *   <li>只取**标量**字段（对象 / 数组 / null 不是规格）</li>
     *   <li>排除 {@code CONTENT_FIELDS}（创作内容不是定价维度）</li>
     *   <li>键与值统一小写</li>
     * </ol>
     *
     * <p>⚠️ 那边读的是建任务时的请求对象，这边读的是同一个对象落库后的 JSON——
     * 数值经 MySQL JSON 列往返后 JS 的 {@code 5} 会读成 Java 的 {@code 5.0}，
     * 而 JS 的 {@code String(5.0)} 是 {@code "5"}。{@link #scalar} 里的整数化就是为这一步对齐，
     * 不是「顺手美化」。
     *
     * <p>调用方若要改这里的规则，**先改 {@code billing-specs.ts}**，两边一起改。
     */
    private static Map<String, String> specsOf(Map<String, Object> input) {
        Map<String, String> specs = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : input.entrySet()) {
            String key = entry.getKey();
            if (key == null || CONTENT_FIELDS.contains(key.toLowerCase())) {
                continue;
            }
            String value = scalar(entry.getValue());
            if (value == null) {
                continue;
            }
            specs.put(key.toLowerCase(), value.toLowerCase());
        }
        return specs;
    }

    /**
     * 标量 → 字符串；非标量 → null（＝不进规格）。
     *
     * <p>布尔也进（{@code web_search} / {@code generate_audio} 这类开关在 input 里是标量，
     * {@code extractSpecs} 同样收它们）——规格是「目录可以拿来定价的封闭维度集合」，
     * 开关将来被配成价格的轴也说不定，与 TS 侧保持一致比在这里替它挑拣更安全。
     */
    private static String scalar(Object value) {
        if (value instanceof String s) {
            return s;
        }
        if (value instanceof Boolean b) {
            return b.toString();
        }
        if (value instanceof Double d) {
            // JS 的 String(5.0) === "5"：整数化之后再比，否则 duration=5 在库里往返一次
            // 就变成 "5.0"，与 Hold 侧查的键不再相同
            return d == Math.floor(d) && !d.isInfinite()
                    ? String.valueOf(d.longValue())
                    : d.toString();
        }
        if (value instanceof Number n) {
            return n.toString();
        }
        return null;
    }

    private static Map<String, Object> parseObject(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            Map<?, ?> parsed = JSON.readValue(json, Map.class);
            Map<String, Object> input = new LinkedHashMap<>();
            parsed.forEach((k, v) -> {
                if (k != null) {
                    input.put(k.toString(), v);
                }
            });
            return input;
        } catch (Exception e) {
            // input 读不出来 = 报不出规格。上层会把「用量行为空」打成 WARN 并退回预扣额结算，
            // 这里再喊一次只是为了让排查时能看见是解析失败而非字段缺失
            log.warn("结算用量：job.input 不是合法 JSON，按空规格处理：{}", e.getMessage());
            return Map.of();
        }
    }
}
