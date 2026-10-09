package com.bluewhale.billing.api.dto;

import java.time.LocalDateTime;

public record GrantRequest(
        long userId,
        String source,
        long amount,
        String bizId,
        String bizType,
        String grantKey,
        LocalDateTime expiresAt
) {
    public GrantRequest {
        if (bizId == null || bizId.isBlank()) {
            throw new IllegalArgumentException("bizId 必填——它是这批积分的来路凭证");
        }
    }
}
