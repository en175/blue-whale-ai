package com.blue.whale.agent.controller;

import com.blue.whale.agent.common.context.UserContext;
import com.blue.whale.agent.model.dto.GenerationInboxDto;
import com.blue.whale.agent.model.dto.InboxConversationDto;
import com.blue.whale.agent.model.dto.InboxMessageAcceptedResponse;
import com.blue.whale.agent.model.dto.InboxMessageRequest;
import com.blue.whale.agent.service.GenerationInboxService;
import com.blue.whale.global.base.resp.Result;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

/**
 * 生成收件箱接口（IK21O9）：每用户一个 purpose=generation_inbox 的隐藏 Project，首条消息懒建。
 * 用户身份走 {@code X-User-Id} 头。响应统一 {@link Result}；JSON snake_case（全局 Jackson SNAKE_CASE）。
 */
@Tag(name = "生成收件箱接口", description = "生成收件箱：消息接纳、多段对话与永久删除（IK21O9）")
@RestController
@RequestMapping("/api/generation-inbox")
@RequiredArgsConstructor
public class GenerationInboxController {

    private final GenerationInboxService generationInboxService;

    /** 取当前用户的生成收件箱；未创建时 data 为 null（GET 只读，不创建）。 */
    @GetMapping
    public Result<GenerationInboxDto> get(@RequestHeader(value = "X-User-Id", required = false) Long userId) {
        return Result.ok(generationInboxService.getInbox(UserContext.requireUserId(userId)));
    }

    /**
     * 接纳一条收件箱消息（202：已持久化并排队 AgentRun）。
     * {@code Idempotency-Key} 必传（缺失由接纳服务拒绝）；重放返回首次接纳结果。
     */
    @PostMapping("/messages")
    public ResponseEntity<Result<InboxMessageAcceptedResponse>> acceptMessage(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody @Valid InboxMessageRequest request) {
        InboxMessageAcceptedResponse accepted = generationInboxService.acceptMessage(
                UserContext.requireUserId(userId), idempotencyKey, request);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Result.ok(accepted));
    }

    /** 列出收件箱全部对话（id 倒序，preview 为首条 user 消息截断）。 */
    @GetMapping("/conversations")
    public Result<List<InboxConversationDto>> listConversations(
            @RequestHeader(value = "X-User-Id", required = false) Long userId) {
        return Result.ok(generationInboxService.listConversations(UserContext.requireUserId(userId)));
    }

    /**
     * 新建一段空对话。{@code Idempotency-Key} 必传（缺失由服务拒绝）；
     * 同键重放返回首次创建的对话。
     */
    @PostMapping("/conversations")
    public Result<InboxConversationDto> createConversation(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return Result.ok(generationInboxService.createConversation(
                UserContext.requireUserId(userId), idempotencyKey));
    }

    /** 永久删除收件箱：物理删除用户可见内容，审计事件与治理表保留。 */
    @DeleteMapping
    public Result<Void> delete(@RequestHeader(value = "X-User-Id", required = false) Long userId) {
        generationInboxService.purgeInbox(UserContext.requireUserId(userId));
        return Result.ok();
    }
}
