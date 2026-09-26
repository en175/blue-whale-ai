package com.bluewhale.billing.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.bluewhale.billing.catalog.CatalogCompiler;
import com.bluewhale.billing.catalog.CatalogDocument;
import com.bluewhale.billing.catalog.CatalogHolder;
import com.bluewhale.billing.domain.entity.PricingCatalogEntity;
import com.bluewhale.billing.infrastructure.mapper.PricingCatalogMapper;
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

/**
 * 发布定价目录（《架构设计》§12 管理 API）。
 *
 * <h2>发布 = 校验通过 + 整版生效</h2>
 *
 * 目录是**整体发布、整体回滚**的：发布时先把当前 active 降为 retired，再插入新版本，
 * 两步在同一个事务里。中间态（两条 active）绝不会被别的读方看到。
 *
 * <p>⚠️ 目录里装的是**全局的两项配置**：换算率（元 → 积分）与折扣叠加策略。
 * 计价规则**不在其中**——它按模型归属，住在模型能力行，随 Hold / Quote 以快照进出 billing。
 * 所以发布目录不再影响任何模型的价格，也就不存在「增量发布某个模型的价」这回事
 * （那现在是一次能力行保存）。
 *
 * <h2>内容相同不重复发版</h2>
 *
 * {@code uk_catalog__hash} 保证了内容与版本一一对应。重复发布同一份文档时**不新开版本号**，
 * 而是把它重新置为 active——这让「回滚」有了一个顺手的操作：
 * 把上一版文档再发一次即可，不用懂 {@code status} 怎么改。
 */
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

    /**
     * 发布一份目录文档并**立即生效**。
     *
     * @param documentJson 目录 JSON 原文。存原文而不是反序列化后再序列化——
     *                     保证 hash 与运营提交的内容逐字节对应，出问题时可原样比对
     * @return 本次生效的版本号
     * @throws IllegalArgumentException 文档不是合法 JSON，或校验不过（**校验的唯一时机就在这里**）
     */
    @Transactional
    public int publish(String documentJson, String publishedBy, String note) {
        CatalogDocument document = parse(documentJson);
        // ★ 校验是唯一的验证时机：不通过就发不出去。published 之后再发现配置错，
        //   影响的是已经用这个版本计过价的 job。
        CatalogCompiler.validate(document);

        String hash = sha256(documentJson);

        // 内容相同 → 不新开版本号，把它重新置为 active（顺带的「回滚」操作）
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
        // published_at 用库内口径（DbTime.ZONE 同一时区），不用 Java 的 LocalDateTime.now()
        // ——服务容器的 JVM 时区与库会话时区未必一致，两处取时间迟早分叉
        entity.setPublishedAt(LocalDateTime.now(com.bluewhale.billing.domain.DbTime.ZONE));
        entity.setNote(note == null ? "" : note);
        mapper.insert(entity);

        holder.reload();   // 热生效：不等重启
        log.info("已发布定价目录 v{}（换算率 1 元 = {} 积分）by {}",
                version, document.creditsPerYuan(), publishedBy);
        return version;
    }

    /** 把一条已有版本重新置为 active（其余降级）。 */
    private void activate(PricingCatalogEntity entity) {
        deactivateCurrent();
        mapper.update(null, new LambdaUpdateWrapper<PricingCatalogEntity>()
                .eq(PricingCatalogEntity::getId, entity.getId())
                .set(PricingCatalogEntity::getStatus, STATUS_ACTIVE));
        holder.reload();
    }

    /**
     * 把当前 active 全部降为 retired。
     *
     * <p>写的是「所有 active」而不是「按版本号找那一条」：全表至多一条 active 是约定，
     * 但约定被人工操作破坏时（比如直接改库），按约定找会漏掉多余的那条，
     * 结果留下两条 active —— 之后每次查当前版本的结果都不确定。
     */
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
