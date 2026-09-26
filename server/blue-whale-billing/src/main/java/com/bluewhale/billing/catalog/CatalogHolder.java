package com.bluewhale.billing.catalog;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicReference;

/**
 * 持有当前生效的定价目录（《计费逻辑详细设计》§4.5.8 运行时消费）。
 *
 * <p>持有的是**目录里那两项全局配置**：换算率（1 元 = 多少积分）与折扣叠加策略。
 * ⚠️ 计价规则**不在**这里——它按模型归属，住在模型能力行，由属主随 Hold / Quote
 * 作为快照送来（见 {@link CatalogCompiler#compileRuleSnapshot}）。所以本类不再实现
 * 规则查询接口，也不再持有任何按 (model, task) 的索引。
 *
 * <p><b>读路径无锁</b>：{@link AtomicReference} 整体替换引用，读方拿到的永远是
 * 一份完整不可变的快照。不用 volatile 字段 + 逐项更新那种写法——那会暴露中间态。
 */
@Component
public class CatalogHolder {

    private static final Logger log = LoggerFactory.getLogger(CatalogHolder.class);

    private final CatalogRepository repository;
    private final AtomicReference<CatalogRepository.LoadedCatalog> current = new AtomicReference<>();

    public CatalogHolder(CatalogRepository repository) {
        this.repository = repository;
    }

    /**
     * 重新加载生效版本。
     *
     * <p>⚠️ <b>失败时保持旧版本，绝不降级为空</b>：目录读不出来或校验不过，
     * 正确的反应是「继续用上一份能用的」+ 告警，而不是「换算率没了」。
     * 后者会把一次配置错误放大成全站不可用（充值算不出到账积分）。
     *
     * @return 本次是否成功换成了新版本
     */
    public boolean reload() {
        try {
            var loaded = repository.loadActive();
            if (loaded == null) {
                // 首次部署时确实可能还没有任何 active 版本 —— 这不是错误，
                // 但换算率会读成 -1，调用方（充值）据此拒绝（不会自己编一个数）
                log.warn("定价目录没有 active 版本；换算率与折扣策略都读不到");
                return false;
            }
            var previous = current.getAndSet(loaded);
            if (previous == null) {
                log.info("定价目录已加载：v{}", loaded.version());
            } else if (previous.version() != loaded.version()) {
                log.info("定价目录已切换：v{} → v{}", previous.version(), loaded.version());
            }
            return true;
        } catch (RuntimeException e) {
            // 保持旧版本 —— 这是「加载失败不影响服务」的实现
            var kept = current.get();
            log.error("定价目录加载失败，保持{}；继续用旧版本",
                    kept == null ? "（当前无可用版本）" : " v" + kept.version(), e);
            return false;
        }
    }

    /** 当前生效版本号；从未成功加载过返回 -1。 */
    public int currentVersion() {
        var loaded = current.get();
        return loaded == null ? -1 : loaded.version();
    }

    /** 当前生效内容哈希；从未加载过返回 null。 */
    public String currentDocumentHash() {
        var loaded = current.get();
        return loaded == null ? null : loaded.documentHash();
    }

    /**
     * 当前生效目录的**文本**（落库的那份）。
     *
     * <p>管理端「读回来改一改再整份发布」从这里取内容 —— 取库里的文本而不是把
     * {@link CatalogDocument} 序列化回去，是因为后者会丢掉服务端不认识的字段
     * （那正是宽容解析留下来的向前兼容空间）。
     *
     * <p>⚠️ 该文本是 MySQL JSON 列的规范化形态，**不是**发布时提交的那串字节，
     * 因此它与 {@link #currentDocumentHash()} 不对应（hash 是对提交文本取的）。
     * 调用方要判断「内容改没改」请比解析后的对象。
     *
     * @return 无生效目录时返回空串（与 {@link #currentVersion()} 的 -1 同口径：不编造内容）
     */
    public String currentDocumentJson() {
        var loaded = current.get();
        return loaded == null ? "" : loaded.documentJson();
    }

    /**
     * 当前生效目录的折扣策略（叠加方式 + 底线）。
     *
     * <p>折扣规则本身在两张独立 live 表；这里只取「怎么叠加」这个策略——
     * 它属于定价域（变更频率低），所以跟 catalog 走，不跟折扣表走。
     *
     * <p>无生效目录时返回全默认：{@code multiply} + 底线 3000。宁可按默认叠加，也不静默变成「不打折」。
     */
    public CatalogDocument.DiscountPolicy currentDiscountPolicy() {
        var loaded = current.get();
        if (loaded == null || loaded.document().discountPolicy() == null) {
            return new CatalogDocument.DiscountPolicy(null, null);
        }
        return loaded.document().discountPolicy();
    }

    /**
     * 当前生效的换算率：**1 元 = 多少积分**。
     *
     * <p>它属于定价目录（版本化、可整体回滚），不是硬编码常量——要改口径就发一版新目录。
     *
     * <p>无生效目录时返回 -1（与 {@link #currentVersion()} 同口径）：这里**不能**回退成
     * 某个默认值。默认值一旦不是「真值」，管理员看到的换算率就是编的，
     * 而它恰恰是用来核对「用户看到的积分对不对」的。
     */
    public int currentCreditsPerYuan() {
        var loaded = current.get();
        return loaded == null ? -1 : loaded.creditsPerYuan();
    }
}
