package com.bluewhale.billing.adapter.outbound.persistence.row;

public class SourceAvailableRow {

    private String source;

    private Long credits;

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public Long getCredits() { return credits; }
    public void setCredits(Long credits) { this.credits = credits; }
}
