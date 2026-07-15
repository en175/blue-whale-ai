package com.blue.whale.agent.controller;

import com.blue.whale.agent.common.context.UserContext;
import com.blue.whale.agent.model.dto.ConfirmUserInputRequest;
import com.blue.whale.agent.service.governance.UserInputRequestService;
import com.blue.whale.global.base.resp.Result;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

@RestController
@RequestMapping("/api/projects/{projectId}/input-requests")
@RequiredArgsConstructor
public class UserInputRequestController {

    private final UserInputRequestService service;

    @PostMapping("/{requestId}/confirm")
    public Result<Void> confirm(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable("projectId") Long projectId,
            @PathVariable("requestId") Long requestId,
            @RequestBody @Valid ConfirmUserInputRequest request) {
        service.confirmStandalone(
                projectId, UserContext.requireUserId(userId), requestId, request.content());
        return Result.ok(null);
    }
}
