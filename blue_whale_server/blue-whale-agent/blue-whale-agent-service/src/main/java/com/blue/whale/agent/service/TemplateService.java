package com.blue.whale.agent.service;

import com.blue.whale.agent.model.request.CreateTemplateCardRequest;
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
     * 获取标签列表（仅元数据，来自配置），按 sortOrder 升序排列。
     *
     * @return 标签 DTO 列表
     */
    List<TemplateTagDto> listTags();

    /**
     * 按标签代码分页查询卡片，并批量装配对应图片。
     *
     * @param tagCode  标签代码
     * @param current 当前页码
     * @param size    每页条数
     * @return 分页结果
     */
    PageVo<TemplateCardDto> pageByTagCode(String tagCode, long current, long size);

    /**
     * 创建模板卡片（同时落 template_card 主数据与 template_card_image 图片列表）。
     *
     * @param req 创建请求
     * @return 新建卡片 ID
     */
    Long createCard(CreateTemplateCardRequest req);

    /**
     * 逻辑删除模板卡片及其关联图片。
     *
     * @param cardId 卡片 ID
     * @return 是否删除成功
     */
    boolean deleteCard(Long cardId);
}
