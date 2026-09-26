package com.bluewhale.billing.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * 启动时把生效中的定价目录装进内存。
 *
 * <h2>为什么必须有这个类</h2>
 *
 * {@link CatalogHolder#reload()} 此前**只有测试在调**。也就是说服务正常启动后
 * 目录是空的，换算率读成 -1，**每一次充值都算不出到账积分**——
 * 表现是「充值功能整个不可用」，而日志里只有一条 WARN，很容易被当成配置没配对。
 *
 * <h2>为什么是 ApplicationRunner 而不是 {@code @PostConstruct}</h2>
 *
 * 表是 Flyway 建的，而 Flyway 的执行时机由 Boot 的自动配置编排。
 * 在 {@code @PostConstruct} 里读表，可能在迁移跑完**之前**——首次部署时表还不存在，
 * 于是拿到「目录为空」并一直保持到下次重启。{@code ApplicationRunner} 在容器
 * 完全就绪后执行，此时迁移必已完成。
 *
 * <h2>没有 active 版本时不阻止启动</h2>
 *
 * 这是刻意的（见 {@link CatalogHolder} 的说明）：进程起得来，运维才能进去发目录；
 * 起不来就只剩「改配置文件重启」一条路。代价是换算率读不到——而这是**正确的**反应，
 * 比编一个默认值强。
 *
 * <p>⚠️ 发布新目录后要使它生效，有**三条**互不冲突的路径（本条注释此前停在「尚未落地」，
 * 而它其实早就落地了 —— 过时注释比没有注释更坏，因为它会让人去做一件已经做完的事）：
 * <ol>
 *   <li><b>发布即热生效</b>：管理端 {@code POST /admin/catalogs} → {@link CatalogPublisher}
 *       发布后立刻调 {@link CatalogHolder#reload()}（《架构设计》§12）。**发布的那一个实例**走这条。</li>
 *   <li><b>定期兜底重载</b>：{@link CatalogReloadTask}（多副本下其余实例靠它收敛）。</li>
 *   <li>重启进程（本类负责启动装载）——不再有人需要这么做，留作最后手段。</li>
 * </ol>
 */
@Component
public class CatalogBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(CatalogBootstrap.class);

    private final CatalogHolder holder;

    public CatalogBootstrap(CatalogHolder holder) {
        this.holder = holder;
    }

    @Override
    public void run(ApplicationArguments args) {
        boolean loaded = holder.reload();
        if (loaded) {
            log.info("启动装载定价目录：v{}", holder.currentVersion());
        } else {
            // 说清后果，别让运维去猜这条 WARN 要不要紧
            log.warn("启动时没有可用的定价目录（v{}）——换算率与折扣策略读不到，"
                            + "直到发布一条 status='active' 的目录并重启",
                    holder.currentVersion());
        }
    }
}
