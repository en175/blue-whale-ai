package com.blue.whale.agent.controller;

import com.blue.whale.agent.config.TemplateProperties;
import com.blue.whale.agent.model.request.CreateTemplateCardRequest;
import com.blue.whale.agent.model.dto.TemplateCardDto;
import com.blue.whale.agent.model.dto.TemplateTagDto;
import com.blue.whale.agent.service.TemplateService;
import com.blue.whale.global.base.resp.PageVo;
import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import javax.validation.Valid;
import java.util.List;

/**
 * 模板卡片接口
 */
@Tag(name = "模板卡片接口")
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/agent/templates")
public class TemplateController {

    /** 模板服务 */
    private final TemplateService templateService;
    /** 模板标签配置 */
    private final TemplateProperties templateProperties;

    /**
     * 获取标签列表（仅元数据，不含卡片）。
     */
    @GetMapping("/tags")
    public Result<List<TemplateTagDto>> tags() {
        return Result.ok(templateService.listTags());
    }

    /**
     * 按标签代码分页查询卡片。
     *
     * @param tagCode 标签代码
     * @param page    当前页码，默认 1
     * @param size    每页条数，默认 10
     * @return 分页结果
     */
    @GetMapping("/page")
    public Result<PageVo<TemplateCardDto>> pageTemplates(
            @RequestParam("tagCode") String tagCode,
            @RequestParam(value = "page", defaultValue = "1") long page,
            @RequestParam(value = "size", defaultValue = "10") long size) {
        // 非法 tagCode 直接返回 400（标签集合来自配置）
        if (!templateProperties.containsTag(tagCode)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "非法标签: " + tagCode);
        }
        return Result.ok(templateService.pageByTagCode(tagCode, page, size));
    }

    /**
     * 创建模板卡片（同时落主数据与图片列表）。
     *
     * @param userId 操作者（X-User-Id，须登录）
     * @param req    创建请求
     * @return 新建卡片 ID
     */
    @PostMapping
    public Result<Long> create(@RequestHeader(value = "X-User-Id", required = false) Long userId,
                               @RequestBody @Valid CreateTemplateCardRequest req) {
        requireUserId(userId);
        if (!templateProperties.containsTag(req.getTagCode())) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE, "非法标签: " + req.getTagCode());
        }
        return Result.ok(templateService.createCard(req));
    }

    /**
     * 逻辑删除模板卡片及其关联图片。
     *
     * @param userId 操作者（X-User-Id，须登录）
     * @param cardId 卡片 ID
     * @return 是否删除成功
     */
    @DeleteMapping("/{cardId}")
    public Result<Boolean> delete(@RequestHeader(value = "X-User-Id", required = false) Long userId,
                                  @PathVariable("cardId") Long cardId) {
        requireUserId(userId);
        return Result.ok(templateService.deleteCard(cardId));
    }

    private Long requireUserId(Long userId) {
        if (userId == null) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "缺少 X-User-Id 请求头");
        }
        return userId;
    }
}
