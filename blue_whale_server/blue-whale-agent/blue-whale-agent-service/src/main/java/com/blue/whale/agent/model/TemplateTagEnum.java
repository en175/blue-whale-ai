package com.blue.whale.agent.model;

import java.util.Optional;

/**
 * 模板标签枚举。
 * <p>
 * tagCode/label/sortOrder 的单一来源。
 */
public enum TemplateTagEnum {

    /** 营销视频 */
    MARKETING("marketing", "营销视频", 0),
    /** 微短片 */
    SHORT("short", "微短片", 1),
    /** 视频复刻 */
    REPLICATE("replicate", "视频复刻", 2),
    /** 社媒视频 */
    SOCIAL("social", "社媒视频", 3),
    /** 图片设计 */
    IMAGE("image", "图片设计", 4);

    /** 标签代码 */
    private final String tagCode;
    /** 标签名称 */
    private final String label;
    /** 排序，数值越小越靠前 */
    private final int sortOrder;

    /**
     * 枚举构造器
     *
     * @param tagCode   标签代码
     * @param label     标签名称
     * @param sortOrder 排序
     */
    TemplateTagEnum(String tagCode, String label, int sortOrder) {
        this.tagCode = tagCode;
        this.label = label;
        this.sortOrder = sortOrder;
    }

    public String getTagCode() {
        return tagCode;
    }

    public String getLabel() {
        return label;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    /**
     * 按 tagCode 查找枚举。
     *
     * @param tagCode 标签代码
     * @return 对应的枚举 Optional；不存在则返回 empty
     */
    public static Optional<TemplateTagEnum> of(String tagCode) {
        if (tagCode == null) {
            return Optional.empty();
        }
        for (TemplateTagEnum tag : values()) {
            if (tag.tagCode.equals(tagCode)) {
                return Optional.of(tag);
            }
        }
        return Optional.empty();
    }

    /**
     * tagCode 是否合法。
     *
     * @param tagCode 标签代码
     * @return true 表示存在该枚举
     */
    public static boolean isValid(String tagCode) {
        return of(tagCode).isPresent();
    }
}
