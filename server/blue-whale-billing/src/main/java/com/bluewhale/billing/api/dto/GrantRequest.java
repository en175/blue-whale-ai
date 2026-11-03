package com.bluewhale.billing.api.dto;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;

public record GrantRequest(
        long userId,
        String source,
        long amount,
        String bizId,
        String bizType,
        String grantKey,
        OffsetDateTime expiresAt
) {
    private static final ZoneId STORAGE_ZONE = ZoneId.systemDefault();

    public GrantRequest {
        if (bizId == null || bizId.isBlank()) {
            throw new IllegalArgumentException("bizId 必填——它是这批积分的来路凭证");
        }
    }

    public LocalDateTime expiresAtLocal() {
        return expiresAt == null ? null : expiresAt.atZoneSameInstant(STORAGE_ZONE).toLocalDateTime();
    }
}
