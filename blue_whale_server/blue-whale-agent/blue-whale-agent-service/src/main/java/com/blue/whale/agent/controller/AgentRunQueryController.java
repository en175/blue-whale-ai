package com.blue.whale.agent.controller;

import com.blue.whale.agent.common.context.UserContext;
import com.blue.whale.agent.model.dto.CreativeSkillRecommendationResponse;
import com.blue.whale.agent.service.CreativeContextQueryService;
import com.blue.whale.global.base.resp.Result;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Agent Run 产品侧只读查询（IK3NPI）。{@code @RequestMapping("/api/agent/runs")}。
 *
 * <p>用户身份走 {@code X-User-Id} 请求头（网关注入），与 SkillController 一致；归属校验以
 * Run 绑定的 Project 为准，不存在与越权统一 404，不泄漏资源存在性。
 */
@Tag(name = "Agent Run 查询", description = "creative-skill-recommendations")
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/agent/runs")
public class AgentRunQueryController {

    private final CreativeContextQueryService creativeContextQueryService;

    /** §7 Creative Skill 推荐查询：与内部路由同一契约形状，供 Web 消费。 */
    @GetMapping("/{runId}/creative-skill-recommendations")
    public Result<List<CreativeSkillRecommendationResponse>> listCreativeSkillRecommendations(
            @PathVariable Long runId,
            @RequestHeader(value = "X-User-Id", required = false) Long userId) {
        return Result.ok(creativeContextQueryService.listCreativeSkillRecommendationsForUser(
                runId, UserContext.requireUserId(userId)));
    }
}
