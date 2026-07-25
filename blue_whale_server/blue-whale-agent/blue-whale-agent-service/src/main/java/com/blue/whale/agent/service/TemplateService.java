package com.blue.whale.agent.service;

import com.blue.whale.agent.model.dto.TemplateCardDto;
import com.blue.whale.agent.model.dto.TemplateTagDto;
import com.blue.whale.global.base.resp.PageVo;

import java.util.List;

/**
 * 模板服务。
 *
 * <p>实现见 {@link com.blue.whale.agent.service.impl.TemplateServiceImpl}。
 */
public interface TemplateService {

    /**
     * 获取标签列表（仅元数据，来自枚举），按 sortOrder 升序排列。
     *
     * @return 标签 DTO 列表
     */
    List<TemplateTagDto> listTags();

    /**
     * 按标签代码分页查询卡片，并批量装配对应图片。
     *
     * @param tagCode 标签代码
     * @param current 当前页码
     * @param size    每页条数
     * @return 分页结果
     */
    PageVo<TemplateCardDto> pageByTagCode(String tagCode, long current, long size);
}
