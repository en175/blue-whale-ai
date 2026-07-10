package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.model.entity.TemplateCard;
import com.blue.whale.agent.model.entity.TemplateCardImage;
import com.blue.whale.agent.mapper.TemplateCardImageMapper;
import com.blue.whale.agent.mapper.TemplateCardMapper;
import com.blue.whale.agent.model.dto.TemplateCardDto;
import com.blue.whale.agent.model.dto.TemplateTagDto;
import com.blue.whale.agent.model.enums.TemplateTagEnum;
import com.blue.whale.global.base.resp.PageVo;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 模板服务
 */
@Service
public class TemplateService {

    /** 卡片 Mapper */
    private final TemplateCardMapper cardMapper;
    /** 卡片图片 Mapper */
    private final TemplateCardImageMapper imageMapper;

    public TemplateService(TemplateCardMapper cardMapper,
                           TemplateCardImageMapper imageMapper) {
        this.cardMapper = cardMapper;
        this.imageMapper = imageMapper;
    }

    /**
     * 获取标签列表（仅元数据，来自枚举），按 sortOrder 升序排列。
     *
     * @return 标签 DTO 列表
     */
    public List<TemplateTagDto> listTags() {
        return Arrays.stream(TemplateTagEnum.values())
                .sorted(Comparator.comparingInt(TemplateTagEnum::getSortOrder))
                .map(tag -> new TemplateTagDto(
                        tag.getTagCode(),
                        tag.getLabel()
                ))
                .collect(Collectors.toList());
    }

    /**
     * 按标签代码分页查询卡片，并批量装配对应图片。
     *
     * @param tagCode 标签代码
     * @param current 当前页码
     * @param size    每页条数
     * @return 分页结果
     */
    public PageVo<TemplateCardDto> pageByTagCode(String tagCode, long current, long size) {
        Page<TemplateCard> page = new Page<>(current, size);
        QueryWrapper<TemplateCard> wrapper = new QueryWrapper<TemplateCard>()
                .eq("tag_code", tagCode)
                .orderByAsc("sort_order");
        // 分页查询卡片主数据
        IPage<TemplateCard> cardPage = cardMapper.selectPage(page, wrapper);

        List<TemplateCard> cards = cardPage.getRecords();
        List<Long> cardIds = cards.stream()
                .map(TemplateCard::getId)
                .collect(Collectors.toList());

        // 批量查询这些卡片的图片，并按 cardId 分组映射
        Map<Long, List<String>> imagesByCard = cardIds.isEmpty()
                ? Map.of()
                : imageMapper.selectList(
                                new QueryWrapper<TemplateCardImage>()
                                        .in("card_id", cardIds)
                                        .orderByAsc("sort_order")
                        ).stream()
                        .collect(Collectors.groupingBy(
                                TemplateCardImage::getCardId,
                                Collectors.mapping(TemplateCardImage::getImageUrl, Collectors.toList())
                        ));

        // 组装为 DTO
        List<TemplateCardDto> records = cards.stream()
                .map(card -> new TemplateCardDto(
                        card.getTitle(),
                        card.getVideoUrl(),
                        imagesByCard.getOrDefault(card.getId(), List.of()),
                        card.getLayout()
                ))
                .collect(Collectors.toList());

        return new PageVo<>(
                records,
                cardPage.getTotal(),
                cardPage.getCurrent(),
                cardPage.getSize(),
                cardPage.getPages()
        );
    }
}
