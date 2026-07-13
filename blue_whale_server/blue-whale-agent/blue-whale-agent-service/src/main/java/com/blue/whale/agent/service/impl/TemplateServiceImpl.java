package com.blue.whale.agent.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.mapper.TemplateCardImageMapper;
import com.blue.whale.agent.mapper.TemplateCardMapper;
import com.blue.whale.agent.model.dto.TemplateCardDto;
import com.blue.whale.agent.model.dto.TemplateTagDto;
import com.blue.whale.agent.model.entity.TemplateCard;
import com.blue.whale.agent.model.entity.TemplateCardImage;
import com.blue.whale.agent.model.enums.TemplateTagEnum;
import com.blue.whale.agent.service.TemplateService;
import com.blue.whale.global.base.resp.PageVo;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 模板服务实现。
 */
@Service
public class TemplateServiceImpl implements TemplateService {

    /** 卡片 Mapper */
    private final TemplateCardMapper cardMapper;
    /** 卡片图片 Mapper */
    private final TemplateCardImageMapper imageMapper;

    public TemplateServiceImpl(TemplateCardMapper cardMapper,
                               TemplateCardImageMapper imageMapper) {
        this.cardMapper = cardMapper;
        this.imageMapper = imageMapper;
    }

    @Override
    public List<TemplateTagDto> listTags() {
        return Arrays.stream(TemplateTagEnum.values())
                .sorted(Comparator.comparingInt(TemplateTagEnum::getSortOrder))
                .map(tag -> new TemplateTagDto(
                        tag.getTagCode(),
                        tag.getLabel()
                ))
                .collect(Collectors.toList());
    }

    @Override
    public PageVo<TemplateCardDto> pageByTagCode(String tagCode, long current, long size) {
        Page<TemplateCard> page = new Page<>(current, size);
        LambdaQueryWrapper<TemplateCard> wrapper = new LambdaQueryWrapper<TemplateCard>()
                .eq(TemplateCard::getTagCode, tagCode)
                .orderByAsc(TemplateCard::getSortOrder);
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
                                new LambdaQueryWrapper<TemplateCardImage>()
                                        .in(TemplateCardImage::getCardId, cardIds)
                                        .orderByAsc(TemplateCardImage::getSortOrder)
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
