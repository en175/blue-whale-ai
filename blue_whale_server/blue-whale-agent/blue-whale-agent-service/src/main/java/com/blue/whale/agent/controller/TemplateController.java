package com.blue.whale.agent.controller;

import com.blue.whale.agent.model.dto.TemplateCardDto;
import com.blue.whale.agent.model.dto.TemplateTagDto;
import com.blue.whale.agent.model.enums.TemplateTagEnum;
import com.blue.whale.agent.service.TemplateService;
import com.blue.whale.global.base.resp.PageVo;
import com.blue.whale.global.base.resp.Result;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

/**
 * 模板卡片接口
 */
@RestController
@RequestMapping("/api/agent/templates")
public class TemplateController {

    /** 模板服务 */
    private final TemplateService templateService;

    public TemplateController(TemplateService templateService) {
        this.templateService = templateService;
    }

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
        // 非法 tagCode 直接返回 400
        if (!TemplateTagEnum.isValid(tagCode)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "非法标签: " + tagCode);
        }
        return Result.ok(templateService.pageByTagCode(tagCode, page, size));
    }
}
