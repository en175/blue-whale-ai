package com.bluewhale.billing.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
public class CatalogReloadTask {

    private static final Logger log = LoggerFactory.getLogger(CatalogReloadTask.class);

    private final CatalogHolder holder;

    public CatalogReloadTask(CatalogHolder holder) {
        this.holder = holder;
    }

    @Scheduled(
            fixedDelayString = "${billing.catalog.reload-interval:PT5M}",
            initialDelayString = "${billing.catalog.reload-initial-delay:PT1M}")
    public void reloadPeriodically() {
        try {
            holder.reload();
        } catch (RuntimeException e) {
            log.error("定价目录定期重载失败（保持当前版本，下次继续重试）", e);
        }
    }
}
