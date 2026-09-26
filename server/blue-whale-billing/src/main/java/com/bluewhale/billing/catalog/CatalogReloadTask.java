package com.bluewhale.billing.catalog;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 定价目录的**定期兜底重载**。
 *
 * <h2>它替代的是一条只有契约、没有实现的事件</h2>
 *
 * <p>{@code contracts/proto/billing/v1/events.proto} 声明了 topic
 * {@code pricing.catalog.activated}，写着「各服务重载内存副本」—— 但全仓**既没有生产者
 * 也没有消费者**（2026-09-26 架构评审查出）。目录只由**发布它的那一个实例**热重载
 * （{@link CatalogPublisher} 调 {@link CatalogHolder#reload()}），其余副本永远停在启动时那份。
 *
 * <p>多副本下的后果不是「慢一点」，是**按实例分叉**：
 * <ul>
 *   <li>{@code creditsPerYuan}（1 元 = 多少积分）—— 用户充值到哪个实例，就按哪个换算率发积分</li>
 *   <li>{@code discountPolicy}（叠加策略与底线）—— 同一笔单在两个实例上算出两个价</li>
 *   <li>{@code catalog_version} —— 影子对账靠它复现，按实例漂</li>
 * </ul>
 *
 * <h2>为什么选「定期兜底」而不是把事件接起来</h2>
 *
 * <p>事件要动 MQ 的生产者与消费者两侧，而它的**收益只是把收敛时间从分钟级压到秒级** ——
 * 目录发布是低频人工操作，分钟级收敛完全够用。定期重载还能顺带覆盖事件会漏掉的场景
 * （实例发布后立刻重启、事件丢失、网络分区）。等真的需要秒级收敛时再接事件，
 * 那时本类就是它的兜底 —— 两者不冲突。
 *
 * <p>⚠️ {@link CatalogHolder#reload()} 自身是安全的：原子替换、加载失败保持旧值、
 * 版本没变时不打日志。所以本类**不引入新的失效模式** —— 它最坏的情况是什么都不做。
 */
@Component
public class CatalogReloadTask {

    private static final Logger log = LoggerFactory.getLogger(CatalogReloadTask.class);

    private final CatalogHolder holder;

    public CatalogReloadTask(CatalogHolder holder) {
        this.holder = holder;
    }

    /**
     * 每 {@code billing.catalog.reload-interval}（默认 5 分钟）重载一次。
     *
     * <p>用 {@code fixedDelay} 而不是 {@code fixedRate}：前者是「上一次跑完再等 N 分钟」，
     * 后者会在一次慢查询后堆积追赶。本任务是兜底，不需要准点。
     *
     * <p>初始延迟 1 分钟而不是 0：启动装载已经由 {@link CatalogBootstrap} 做过了，
     * 滚动发布时每轮重启都立刻再查一次库没有意义。
     */
    @Scheduled(
            fixedDelayString = "${billing.catalog.reload-interval:PT5M}",
            initialDelayString = "${billing.catalog.reload-initial-delay:PT1M}")
    public void reloadPeriodically() {
        try {
            holder.reload();
        } catch (RuntimeException e) {
            // reload() 内部已经把「加载失败保持旧版本」处理掉了；能抛到这里的是更意外的东西。
            // ⚠️ **必须吞掉**：定时任务抛出去会让 Spring 的调度线程把这个任务**永久停掉**
            //    （默认的 error handler 只是记日志，但一旦异常逃逸出方法，后续触发就没了），
            //    而那时服务看起来一切正常、只是目录再也不更新。
            log.error("定价目录定期重载失败（保持当前版本，下次继续重试）", e);
        }
    }
}
