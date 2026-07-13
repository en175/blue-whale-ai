package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;

/**
 * 卡片图片实体
 */
@TableName("template_card_image")
public class TemplateCardImage extends BaseEntity {

    /** 所属卡片 ID */
    private Long cardId;

    /** 图片地址 */
    private String imageUrl;

    /** 排序权重，数值越小越靠前 */
    private Integer sortOrder;

    public Long getCardId() {
        return cardId;
    }

    public void setCardId(Long cardId) {
        this.cardId = cardId;
    }

    public String getImageUrl() {
        return imageUrl;
    }

    public void setImageUrl(String imageUrl) {
        this.imageUrl = imageUrl;
    }

    public Integer getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(Integer sortOrder) {
        this.sortOrder = sortOrder;
    }

}
