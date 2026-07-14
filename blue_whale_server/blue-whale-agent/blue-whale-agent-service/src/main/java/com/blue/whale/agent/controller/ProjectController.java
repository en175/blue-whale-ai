package com.blue.whale.agent.controller;

import com.blue.whale.agent.common.context.UserContext;
import com.blue.whale.agent.model.dto.CreateProjectRequest;
import com.blue.whale.agent.model.dto.ProjectDto;
import com.blue.whale.agent.model.dto.RenameProjectRequest;
import com.blue.whale.agent.model.dto.SnapshotResponse;
import com.blue.whale.agent.service.ProjectService;
import com.blue.whale.agent.service.ProjectSseService;
import com.blue.whale.agent.service.SnapshotService;
import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import javax.validation.Valid;
import java.util.List;

/**
 * 项目接口：workspace 根 CRUD（ADR-0011）。用户身份走 {@code X-User-Id} 头。
 * 响应统一 {@link Result}；JSON snake_case（全局 Jackson SNAKE_CASE）。
 */
@Tag(name = "项目接口", description = "画布项目 CRUD（ADR-0011 project 根）")
@RestController
@RequestMapping("/api/projects")
@RequiredArgsConstructor
public class ProjectController {

    private final ProjectService projectService;
    private final SnapshotService snapshotService;
    private final ProjectSseService projectSseService;

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

    /**
     * Project 一致快照（ADR-0016 §2 恢复入口）。
     * 返回当前 Project 状态与 {@code high_watermark_cursor}，客户端从该游标接续 SSE。
     */
    @GetMapping("/{id}/snapshot")
    public Result<SnapshotResponse> snapshot(@RequestHeader(value = "X-User-Id", required = false) Long userId,
                                             @PathVariable("id") Long id) {
        return Result.ok(snapshotService.getSnapshot(id, UserContext.requireUserId(userId)));
    }

    /**
     * Project 持久、可重放的 SSE 事件流（ADR-0016 §3）。
     *
     * <p>客户端从最后已应用游标重连：{@code GET /events?after={cursor}}。
     * 游标超过保留窗口返回 {@code 410 CURSOR_EXPIRED}（不静默跳最新），客户端须重新获取快照。
     * SSE {@code id} 等于 Project 内单调游标，{@code event} 等于事件类型；客户端按游标去重。
     */
    @GetMapping(value = "/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Object events(@RequestHeader(value = "X-User-Id", required = false) Long userId,
                         @PathVariable("id") Long id,
                         @RequestParam(value = "after", required = false, defaultValue = "0") long after,
                         javax.servlet.http.HttpServletResponse response) {
        Long uid = UserContext.requireUserId(userId);
        projectSseService.requireOwned(id, uid);
        if (projectSseService.isCursorExpired(id, after)) {
            return ResponseEntity.status(HttpStatus.GONE)
                    .body(Result.failed(SystemCode.CURSOR_EXPIRED));
        }
        response.setHeader("X-Accel-Buffering", "no");
        response.setHeader("Cache-Control", "no-cache");
        return projectSseService.subscribe(id, after);
    }
}
