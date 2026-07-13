package com.blue.whale.agent.controller;

import com.blue.whale.agent.common.context.UserContext;
import com.blue.whale.agent.model.dto.CanvasDto;
import com.blue.whale.agent.model.dto.SaveCanvasRequest;
import com.blue.whale.agent.service.CanvasService;
import com.blue.whale.agent.service.ProjectService;
import com.blue.whale.global.base.resp.Result;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

/**
 * 画布接口：整体 GET / PUT（ADR-0011 D4，与 project 1:1）。
 * 按 {@code projectId} 标识（前端只知 projectId，不维护 canvas id），先校验 project 归属。
 * 用户身份走 {@code X-User-Id} 头；响应统一 {@link Result}。
 */
@Tag(name = "画布接口", description = "画布状态 GET/PUT（ADR-0011，与 project 1:1）")
@RestController
@RequestMapping("/api/canvases")
@RequiredArgsConstructor
public class CanvasController {

    private final CanvasService canvasService;
    private final ProjectService projectService;

    @GetMapping
    public Result<CanvasDto> get(@RequestHeader(value = "X-User-Id", required = false) Long userId,
                                 @RequestParam("projectId") Long projectId) {
        Long uid = UserContext.requireUserId(userId);
        projectService.requireOwned(projectId, uid);
        return Result.ok(canvasService.getByProject(projectId));
    }

    @PutMapping("/{projectId}")
    public Result<CanvasDto> save(@RequestHeader(value = "X-User-Id", required = false) Long userId,
                                  @PathVariable("projectId") Long projectId,
                                  @RequestBody @Valid SaveCanvasRequest req) {
        Long uid = UserContext.requireUserId(userId);
        projectService.requireOwned(projectId, uid);
        return Result.ok(canvasService.save(projectId, req));
    }
}
