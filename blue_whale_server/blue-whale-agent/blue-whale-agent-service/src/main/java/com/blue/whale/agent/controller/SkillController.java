package com.blue.whale.agent.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.model.dto.AutoUpdateRequest;
import com.blue.whale.agent.model.dto.ItemsVo;
import com.blue.whale.agent.model.dto.SkillLibraryDto;
import com.blue.whale.agent.model.dto.SkillLibraryQuery;
import com.blue.whale.agent.model.dto.SkillMineDto;
import com.blue.whale.agent.model.dto.SkillMineQuery;
import com.blue.whale.agent.service.SkillService;
import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 技能面板接口（IJZ7Z8）。{@code @RequestMapping("/api/agent/skills")}。
 *
 * <p>用户身份走 {@code X-User-Id} 请求头（Long，MVP 无鉴权，前端直传），与 GenerationController 一致。
 * 路径 {@code {id}} 均为 skill.id（Long）。
 */
@Tag(name = "技能面板接口", description = "library / mine / auto")
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/agent/skills")
public class SkillController {

    private final SkillService skillService;

    /** Skill 库分页（POST，默认 50/页，可 keyword 搜 name/description） */
    @PostMapping("/library")
    public Result<Page<SkillLibraryDto>> library(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestBody(required = false) SkillLibraryQuery query) {
        return Result.ok(skillService.listLibrary(requireUserId(userId),
                query == null ? new SkillLibraryQuery() : query));
    }

    /** 我的 Skills 分页（POST，与 library 一致滚动加载） */
    @PostMapping("/mine")
    public Result<Page<SkillMineDto>> mine(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestBody(required = false) SkillMineQuery query) {
        return Result.ok(skillService.listMine(requireUserId(userId),
                query == null ? new SkillMineQuery() : query));
    }

    /** 添加到我的（建立引用，默认 auto=false） */
    @PostMapping("/library/{id}/add")
    public Result<Void> add(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable Long id) {
        skillService.add(requireUserId(userId), id);
        return Result.ok();
    }

    /** 从我的移除（解除引用，不删 skill 本身） */
    @DeleteMapping("/mine/{id}")
    public Result<Void> remove(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable Long id) {
        skillService.remove(requireUserId(userId), id);
        return Result.ok();
    }

    /** 切换 auto 开关（关系属性，持久化） */
    @PatchMapping("/mine/{id}")
    public Result<Void> updateAuto(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable Long id,
            @RequestBody AutoUpdateRequest req) {

        skillService.updateAuto(requireUserId(userId), id, req.getAuto());
        return Result.ok();
    }

    private Long requireUserId(Long userId) {
        if (userId == null) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "请登录后访问");
        }
        return userId;
    }
}
