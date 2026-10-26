package com.bluewhale.billing.api.dto;

public record GrantResponse(long lotId, long userId, String source, long amount) {}
