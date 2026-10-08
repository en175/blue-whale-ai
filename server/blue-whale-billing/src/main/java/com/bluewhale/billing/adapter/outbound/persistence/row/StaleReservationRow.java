package com.bluewhale.billing.adapter.outbound.persistence.row;

public class StaleReservationRow {

    private Long id;

    private Long generationJobId;

    private Long userId;

    private Long reservedCredits;

    private Long heldSeconds;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getGenerationJobId() { return generationJobId; }
    public void setGenerationJobId(Long generationJobId) { this.generationJobId = generationJobId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getReservedCredits() { return reservedCredits; }
    public void setReservedCredits(Long reservedCredits) { this.reservedCredits = reservedCredits; }
    public Long getHeldSeconds() { return heldSeconds; }
    public void setHeldSeconds(Long heldSeconds) { this.heldSeconds = heldSeconds; }
}
