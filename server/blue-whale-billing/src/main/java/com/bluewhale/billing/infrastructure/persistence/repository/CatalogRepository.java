package com.bluewhale.billing.infrastructure.persistence.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.application.CatalogCompiler;
import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.infrastructure.persistence.po.PricingCatalogEntity;
import com.bluewhale.billing.infrastructure.persistence.mapper.PricingCatalogMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.bluewhale.billing.domain.catalog.CatalogDocument;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Repository;

import java.time.Instant;

@Repository
public class CatalogRepository {

    private final PricingCatalogMapper mapper;
    private final ObjectMapper json;

    public CatalogRepository(PricingCatalogMapper mapper) {
        this.mapper = mapper;
        this.json = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    public LoadedCatalog loadActive() {
        return load(mapper.selectActive());
    }

    private LoadedCatalog load(PricingCatalogEntity row) {
        if (row == null) {
            return null;
        }
        CatalogDocument document;
        try {
            document = json.readValue(row.getDocument(), CatalogDocument.class);
        } catch (Exception e) {
            throw new CatalogCompiler.CompileException(
                    "目录 v" + row.getCatalogVersion() + " 的 document 不是合法 JSON："
                            + e.getMessage(), e);
        }
        CatalogCompiler.validate(document);
        return new LoadedCatalog(
                row.getCatalogVersion(),
                row.getDocumentHash(),
                row.getDocument(),
                document,
                DbTime.fromDb(row.getPublishedAt()));
    }

    public record LoadedCatalog(
            int version,
            String documentHash,
            String documentJson,
            CatalogDocument document,
            Instant publishedAt
    ) {

        public int creditsPerYuan() {
            return document.creditsPerYuan();
        }
    }
}
