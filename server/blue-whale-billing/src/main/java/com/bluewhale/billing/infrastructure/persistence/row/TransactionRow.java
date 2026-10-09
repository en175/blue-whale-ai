package com.bluewhale.billing.infrastructure.persistence.row;

import java.time.LocalDateTime;

public class TransactionRow {

    private String txId;

    private Long userId;

    private String type;

    private String direction;

    private String title;

    private Long amount;

    private Long reservedCredits;

    private Long generationJobId;

    private String status;

    private LocalDateTime createdAt;

    private LocalDateTime settledAt;

    private String kind;

    private Long srcId;

    private String lotSource;

    private LocalDateTime lotCreatedAt;

    public String getTxId() { return txId; }
    public void setTxId(String txId) { this.txId = txId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getDirection() { return direction; }
    public void setDirection(String direction) { this.direction = direction; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public Long getAmount() { return amount; }
    public void setAmount(Long amount) { this.amount = amount; }
    public Long getReservedCredits() { return reservedCredits; }
    public void setReservedCredits(Long reservedCredits) { this.reservedCredits = reservedCredits; }
    public Long getGenerationJobId() { return generationJobId; }
    public void setGenerationJobId(Long generationJobId) { this.generationJobId = generationJobId; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getSettledAt() { return settledAt; }
    public void setSettledAt(LocalDateTime settledAt) { this.settledAt = settledAt; }
    public String getKind() { return kind; }
    public void setKind(String kind) { this.kind = kind; }
    public Long getSrcId() { return srcId; }
    public void setSrcId(Long srcId) { this.srcId = srcId; }
    public String getLotSource() { return lotSource; }
    public void setLotSource(String lotSource) { this.lotSource = lotSource; }
    public LocalDateTime getLotCreatedAt() { return lotCreatedAt; }
    public void setLotCreatedAt(LocalDateTime lotCreatedAt) { this.lotCreatedAt = lotCreatedAt; }
}
