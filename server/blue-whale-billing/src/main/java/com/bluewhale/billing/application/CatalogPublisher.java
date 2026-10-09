package com.bluewhale.billing.application;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.bluewhale.billing.domain.catalog.CatalogDocument;
import com.bluewhale.billing.infrastructure.persistence.po.PricingCatalogEntity;
import com.bluewhale.billing.infrastructure.persistence.mapper.PricingCatalogMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;

@Service
public class CatalogPublisher {

    private static final Logger log = LoggerFactory.getLogger(CatalogPublisher.class);

    private static final String STATUS_ACTIVE = "active";
    private static final String STATUS_RETIRED = "retired";

    private final PricingCatalogMapper mapper;
    private final CatalogHolder holder;
    private final ObjectMapper json;

    public CatalogPublisher(PricingCatalogMapper mapper, CatalogHolder holder) {
        this.mapper = mapper;
        this.holder = holder;
        this.json = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    @Transactional
    public int publish(String documentJson, String publishedBy, String note) {
        CatalogDocument document = parse(documentJson);
        CatalogCompiler.validate(document);

        String hash = sha256(documentJson);

        PricingCatalogEntity existing = mapper.selectOne(new LambdaQueryWrapper<PricingCatalogEntity>()
                .eq(PricingCatalogEntity::getDocumentHash, hash));
        if (existing != null) {
            activate(existing);
            log.info("目录内容与 v{} 相同，未新开版本；已重新置为 active", existing.getCatalogVersion());
            return existing.getCatalogVersion();
        }

        int version = mapper.selectMaxVersion() + 1;
        deactivateCurrent();

        PricingCatalogEntity entity = new PricingCatalogEntity();
        entity.setCatalogVersion(version);
        entity.setStatus(STATUS_ACTIVE);
        entity.setDocument(documentJson);
        entity.setSchemaVersion(document.schemaVersion());
        entity.setDocumentHash(hash);
        entity.setPublishedBy(publishedBy);
        entity.setPublishedAt(LocalDateTime.now(com.bluewhale.billing.domain.DbTime.ZONE));
        entity.setNote(note == null ? "" : note);
        mapper.insert(entity);

        holder.reload();
        log.info("已发布定价目录 v{}（换算率 1 元 = {} 积分）by {}",
                version, document.creditsPerYuan(), publishedBy);
        return version;
    }

    private void activate(PricingCatalogEntity entity) {
        deactivateCurrent();
        mapper.update(null, new LambdaUpdateWrapper<PricingCatalogEntity>()
                .eq(PricingCatalogEntity::getId, entity.getId())
                .set(PricingCatalogEntity::getStatus, STATUS_ACTIVE));
        holder.reload();
    }

    private void deactivateCurrent() {
        mapper.update(null, new LambdaUpdateWrapper<PricingCatalogEntity>()
                .eq(PricingCatalogEntity::getStatus, STATUS_ACTIVE)
                .set(PricingCatalogEntity::getStatus, STATUS_RETIRED));
    }

    private CatalogDocument parse(String documentJson) {
        if (documentJson == null || documentJson.isBlank()) {
            throw new IllegalArgumentException("目录文档不能为空");
        }
        try {
            return json.readValue(documentJson, CatalogDocument.class);
        } catch (Exception e) {
            throw new IllegalArgumentException("目录文档不是合法 JSON：" + e.getMessage(), e);
        }
    }

    private static String sha256(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("JVM 不支持 SHA-256", e);
        }
    }
}
