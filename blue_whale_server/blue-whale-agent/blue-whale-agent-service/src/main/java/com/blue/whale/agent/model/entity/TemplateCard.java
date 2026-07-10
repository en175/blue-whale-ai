package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;

/**
 * 模板卡片实体
 */
@TableName("template_card")
public class TemplateCard extends BaseEntity {


    /** 所属标签代码（对应 TemplateTagEnum.tagCode） */
    private String tagCode;

    /** 卡片标题 */
    private String title;

    /** 视频地址；图片类型卡片可为空 */
    private String videoUrl;

    /** 布局：wide/portrait/social/image */
    private String layout;

    /** 排序权重，数值越小越靠前 */
    private Integer sortOrder;

    public String getTagCode() {
        return tagCode;
    }

    public void setTagCode(String tagCode) {
        this.tagCode = tagCode;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getVideoUrl() {
        return videoUrl;
    }

    public void setVideoUrl(String videoUrl) {
        this.videoUrl = videoUrl;
    }

    public String getLayout() {
        return layout;
    }

    public void setLayout(String layout) {
        this.layout = layout;
    }

    public Integer getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(Integer sortOrder) {
        this.sortOrder = sortOrder;
    }

}
