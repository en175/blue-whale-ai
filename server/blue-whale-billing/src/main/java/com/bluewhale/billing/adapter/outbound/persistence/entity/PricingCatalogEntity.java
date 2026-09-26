package com.bluewhale.billing.adapter.outbound.persistence.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 定价目录版本行（对应 Flyway {@code V1__pricing_catalog.sql}）。
 *
 * <p>一行 = 一个版本。{@code document} 是完整规则文档的 JSON 文本，
 * 解析与编译在 {@code CatalogCompiler}，本实体只负责搬运。
 */
@TableName("billing_pricing_catalogs")
public class PricingCatalogEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 版本号单调递增；job 提交时冻结它。 */
    private Integer catalogVersion;

    /** draft | active（全表至多一条）| retired。 */
    private String status;

    /** 完整规则文档（JSON 列）。 */
    private String document;

    private Integer schemaVersion;

    /** 内容 SHA-256，job 上也冻结它——版本号可被人为复用，hash 不会。 */
    private String documentHash;

    private LocalDateTime effectiveFrom;

    private LocalDateTime effectiveTo;

    private String publishedBy;

    private LocalDateTime publishedAt;

    private String note;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Integer getCatalogVersion() { return catalogVersion; }
    public void setCatalogVersion(Integer catalogVersion) { this.catalogVersion = catalogVersion; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getDocument() { return document; }
    public void setDocument(String document) { this.document = document; }
    public Integer getSchemaVersion() { return schemaVersion; }
    public void setSchemaVersion(Integer schemaVersion) { this.schemaVersion = schemaVersion; }
    public String getDocumentHash() { return documentHash; }
    public void setDocumentHash(String documentHash) { this.documentHash = documentHash; }
    public LocalDateTime getEffectiveFrom() { return effectiveFrom; }
    public void setEffectiveFrom(LocalDateTime effectiveFrom) { this.effectiveFrom = effectiveFrom; }
    public LocalDateTime getEffectiveTo() { return effectiveTo; }
    public void setEffectiveTo(LocalDateTime effectiveTo) { this.effectiveTo = effectiveTo; }
    public String getPublishedBy() { return publishedBy; }
    public void setPublishedBy(String publishedBy) { this.publishedBy = publishedBy; }
    public LocalDateTime getPublishedAt() { return publishedAt; }
    public void setPublishedAt(LocalDateTime publishedAt) { this.publishedAt = publishedAt; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
}
