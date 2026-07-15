package com.blue.whale.agent.service.governance;

import java.util.Map;

public record GenerationAuthorizationRequest(
        String actionType,
        Map<String, Object> arguments,
        boolean irreversible,
        boolean validatedConfirmation) {
}
