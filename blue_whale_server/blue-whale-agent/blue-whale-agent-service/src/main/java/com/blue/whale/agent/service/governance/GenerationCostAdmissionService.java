package com.blue.whale.agent.service.governance;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
@RequiredArgsConstructor
public class GenerationCostAdmissionService {

    private final GenerationActionAuthorizationService authorizationService;
    private final CostReservationService reservationService;
    private final UserInputRequestService userInputRequestService;

    public AuthorizedGenerationAction authorizeRequest(
            Long userId,
            Long projectId,
            String targetType,
            String targetId,
            String proposedActionIdentity,
            String actionType,
            Map<String, Object> arguments,
            boolean irreversible,
            Long inputRequestId) {
        String actionIdentity = proposedActionIdentity;
        boolean validatedConfirmation = false;
        if (inputRequestId != null) {
            ValidatedInputRequest validated = userInputRequestService.consumeStandaloneValidated(
                    inputRequestId, projectId, userId, targetType, proposedActionIdentity,
                    actionType, arguments);
            actionIdentity = validated.actionIdentity();
            validatedConfirmation = true;
        }
        String resolvedTargetId = targetId == null ? actionIdentity : targetId;
        AuthorizationDecision decision = authorizationService.authorize(new ActionAuthorizationCommand(
                userId, projectId, targetType, resolvedTargetId,
                "generation-request:" + actionIdentity, actionIdentity, actionType, arguments,
                irreversible, validatedConfirmation));
        if (decision.outcome() == AuthorizationOutcome.INPUT_REQUIRED) {
            var request = userInputRequestService.createStandalone(
                    projectId, userId, targetType, actionIdentity, actionType, arguments,
                    decision.quote());
            throw GovernanceException.inputRequired(request.getId());
        }
        return new AuthorizedGenerationAction(actionIdentity, decision.quote());
    }

    public CostReservationSnapshot reserveAuthorized(
            Long userId,
            Long projectId,
            Long generationJobId,
            String actionIdentity,
            String actionType,
            PriceQuote quote) {
        return reservationService.reserve(new CostReservationCommand(
                userId, projectId, generationJobId, actionIdentity, actionType, quote));
    }
}
