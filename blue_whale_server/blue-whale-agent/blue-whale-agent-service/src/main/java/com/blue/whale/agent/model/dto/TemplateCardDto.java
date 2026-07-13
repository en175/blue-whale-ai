package com.blue.whale.agent.model.dto;

import java.util.List;

/**
 * 模板卡片 DTO
 */
public class TemplateCardDto {

    /** 卡片标题 */
    private String title;
    /** 视频地址；图片类型卡片可为空 */
    private String video;
    /** 图片列表 */
    private List<String> images;
    /** 布局：wide/portrait/social/image */
    private String layout;

    public TemplateCardDto() {
    }

    /**
     * 全参构造器
     */
    public TemplateCardDto(String title, String video, List<String> images, String layout) {
        this.title = title;
        this.video = video;
        this.images = images;
        this.layout = layout;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getVideo() {
        return video;
    }

    public void setVideo(String video) {
        this.video = video;
    }

    public List<String> getImages() {
        return images;
    }

    public void setImages(List<String> images) {
        this.images = images;
    }

    public String getLayout() {
        return layout;
    }

    public void setLayout(String layout) {
        this.layout = layout;
    }
}
