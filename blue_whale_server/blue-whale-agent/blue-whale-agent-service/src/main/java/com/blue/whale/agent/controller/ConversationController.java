package com.blue.whale.agent.controller;

import com.blue.whale.agent.common.context.UserContext;
import com.blue.whale.agent.model.dto.AcceptConversationMessageRequest;
import com.blue.whale.agent.model.dto.AcceptConversationMessageResponse;
import com.blue.whale.agent.service.ConversationCommandService;
import com.blue.whale.global.base.resp.Result;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

@RestController
@RequestMapping("/api/projects/{projectId}/conversation/messages")
@RequiredArgsConstructor
public class ConversationController {

    private final ConversationCommandService commandService;

    @PostMapping
    public ResponseEntity<Result<AcceptConversationMessageResponse>> accept(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @PathVariable Long projectId,
            @RequestBody @Valid AcceptConversationMessageRequest request) {
        AcceptConversationMessageResponse accepted = commandService.accept(
                projectId, UserContext.requireUserId(userId), idempotencyKey, request);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Result.ok(accepted));
    }
}
