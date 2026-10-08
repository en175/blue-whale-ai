package com.bluewhale.billing.application.view;

public record UserStatsView(long availableCredits, long totalRecharged, long totalConsumed) {
}
