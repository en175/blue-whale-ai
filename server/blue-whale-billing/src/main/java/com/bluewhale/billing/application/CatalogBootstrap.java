package com.bluewhale.billing.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

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
            log.warn("启动时没有可用的定价目录（v{}）——换算率与折扣策略读不到，"
                            + "直到发布一条 status='active' 的目录并重启",
                    holder.currentVersion());
        }
    }
}
