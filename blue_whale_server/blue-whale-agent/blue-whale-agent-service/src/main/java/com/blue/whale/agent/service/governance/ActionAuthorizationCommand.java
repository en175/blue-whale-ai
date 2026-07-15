package com.blue.whale.agent.service.governance;

import java.util.Map;

public record ActionAuthorizationCommand(
        Long userId,
        Long projectId,
        String targetType,
        String targetId,
        String correlationId,
        String actionIdentity,
        String actionType,
        Map<String, Object> arguments,
        boolean irreversible,
        boolean validatedConfirmation) {
}
