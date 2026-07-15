package com.blue.whale.agent.controller;

import com.blue.whale.agent.common.context.UserContext;
import com.blue.whale.agent.model.request.CreateProjectRequest;
import com.blue.whale.agent.model.dto.ProjectDto;
import com.blue.whale.agent.model.request.RenameProjectRequest;
import com.blue.whale.agent.service.ProjectService;
import com.blue.whale.global.base.resp.Result;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

/**
 * 项目接口：workspace 根 CRUD（ADR-0011）。用户身份走 {@code X-User-Id} 头。
 * 响应统一 {@link Result}；JSON snake_case（全局 Jackson SNAKE_CASE）。
 */
@Tag(name = "项目接口", description = "画布项目 CRUD（ADR-0011 project 根）")
@RestController
@RequestMapping("/api/agent/projects")
@RequiredArgsConstructor
public class ProjectController {

    private final ProjectService projectService;

    @PostMapping
    public Result<ProjectDto> create(@RequestHeader(value = "X-User-Id", required = false) Long userId,
                                     @RequestBody @Valid CreateProjectRequest req) {
        return Result.ok(projectService.create(UserContext.requireUserId(userId), req));
    }

    @GetMapping
    public Result<List<ProjectDto>> list(@RequestHeader(value = "X-User-Id", required = false) Long userId) {
        return Result.ok(projectService.list(UserContext.requireUserId(userId)));
    }

    @GetMapping("/{id}")
    public Result<ProjectDto> get(@RequestHeader(value = "X-User-Id", required = false) Long userId,
                                  @PathVariable("id") Long id) {
        return Result.ok(projectService.get(id, UserContext.requireUserId(userId)));
    }

    @PutMapping("/{id}")
    public Result<ProjectDto> rename(@RequestHeader(value = "X-User-Id", required = false) Long userId,
                                     @PathVariable("id") Long id,
                                     @RequestBody @Valid RenameProjectRequest req) {
        return Result.ok(projectService.rename(id, UserContext.requireUserId(userId), req));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@RequestHeader(value = "X-User-Id", required = false) Long userId,
                               @PathVariable("id") Long id) {
        projectService.delete(id, UserContext.requireUserId(userId));
        return Result.ok();
    }
}
