package com.blue.whale.agent.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.config.TemplateProperties;
import com.blue.whale.agent.mapper.TemplateCardImageMapper;
import com.blue.whale.agent.mapper.TemplateCardMapper;
import com.blue.whale.agent.model.request.CreateTemplateCardRequest;
import com.blue.whale.agent.model.dto.TemplateCardDto;
import com.blue.whale.agent.model.dto.TemplateTagDto;
import com.blue.whale.agent.model.entity.TemplateCard;
import com.blue.whale.agent.model.entity.TemplateCardImage;
import com.blue.whale.agent.service.TemplateService;
import com.blue.whale.global.base.resp.PageVo;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 模板服务实现。
 */
@Slf4j
@Service
public class TemplateServiceImpl implements TemplateService {

    /** 卡片 Mapper */
    private final TemplateCardMapper cardMapper;
    /** 卡片图片 Mapper */
    private final TemplateCardImageMapper imageMapper;
    /** 模板标签配置 */
    private final TemplateProperties templateProperties;

    public TemplateServiceImpl(TemplateCardMapper cardMapper,
                               TemplateCardImageMapper imageMapper,
                               TemplateProperties templateProperties) {
        this.cardMapper = cardMapper;
        this.imageMapper = imageMapper;
        this.templateProperties = templateProperties;
    }

    @Override
    public List<TemplateTagDto> listTags() {
        return templateProperties.sortedTags().stream()
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

        // 组装为 DTO（content 为点击卡片后下发的提示词）
        List<TemplateCardDto> records = cards.stream()
                .map(card -> new TemplateCardDto(
                        card.getTitle(),
                        card.getVideoUrl(),
                        imagesByCard.getOrDefault(card.getId(), List.of()),
                        card.getLayout(),
                        card.getContent()
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

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long createCard(CreateTemplateCardRequest req) {
        TemplateCard card = new TemplateCard();
        card.setTagCode(req.getTagCode());
        card.setTitle(req.getTitle());
        card.setVideoUrl(req.getVideoUrl());
        card.setLayout(req.getLayout());
        card.setContent(req.getContent());
        card.setSortOrder(req.getSortOrder() == null ? 0 : req.getSortOrder());
        cardMapper.insert(card);
        Long cardId = card.getId();

        // 图片按列表索引定 sortOrder 逐条入库
        List<String> images = req.getImages();
        if (images != null && !images.isEmpty()) {
            int order = 0;
            for (String url : images) {
                if (url == null || url.trim().isEmpty()) {
                    continue;
                }
                TemplateCardImage img = new TemplateCardImage();
                img.setCardId(cardId);
                img.setImageUrl(url);
                img.setSortOrder(order++);
                imageMapper.insert(img);
            }
        }
        log.info("创建模板卡片成功 cardId={} tagCode={} title={}", cardId, req.getTagCode(), req.getTitle());
        return cardId;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean deleteCard(Long cardId) {
        TemplateCard card = cardMapper.selectById(cardId);
        if (card == null) {
            throw new GlobalException(SystemCode.DATA_NOT_EXIST_CODE, "模板卡片不存在, id=" + cardId);
        }
        // 级联逻辑删除关联图片
        imageMapper.delete(new LambdaQueryWrapper<TemplateCardImage>()
                .eq(TemplateCardImage::getCardId, cardId));
        boolean removed = cardMapper.deleteById(cardId) > 0;
        log.info("删除模板卡片 cardId={} success={}", cardId, removed);
        return removed;
    }
}
