package com.bluewhale.billing.infrastructure.persistence.po;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("billing_pricing_catalogs")
public class PricingCatalogEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Integer catalogVersion;

    private String status;

    private String document;

    private Integer schemaVersion;

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
