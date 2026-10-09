package com.bluewhale.billing.application;

import com.bluewhale.billing.adapter.outbound.persistence.repository.CatalogRepository;
import com.bluewhale.billing.domain.catalog.CatalogDocument;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicReference;

@Component
public class CatalogHolder {

    private static final Logger log = LoggerFactory.getLogger(CatalogHolder.class);

    private final CatalogRepository repository;
    private final AtomicReference<CatalogRepository.LoadedCatalog> current = new AtomicReference<>();

    public CatalogHolder(CatalogRepository repository) {
        this.repository = repository;
    }

    public boolean reload() {
        try {
            var loaded = repository.loadActive();
            if (loaded == null) {
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
            var kept = current.get();
            log.error("定价目录加载失败，保持{}；继续用旧版本",
                    kept == null ? "（当前无可用版本）" : " v" + kept.version(), e);
            return false;
        }
    }

    public int currentVersion() {
        var loaded = current.get();
        return loaded == null ? -1 : loaded.version();
    }

    public String currentDocumentHash() {
        var loaded = current.get();
        return loaded == null ? null : loaded.documentHash();
    }

    public String currentDocumentJson() {
        var loaded = current.get();
        return loaded == null ? "" : loaded.documentJson();
    }

    public CatalogDocument.DiscountPolicy currentDiscountPolicy() {
        var loaded = current.get();
        if (loaded == null || loaded.document().discountPolicy() == null) {
            return new CatalogDocument.DiscountPolicy(null, null);
        }
        return loaded.document().discountPolicy();
    }

    public int currentCreditsPerYuan() {
        var loaded = current.get();
        return loaded == null ? -1 : loaded.creditsPerYuan();
    }
}
