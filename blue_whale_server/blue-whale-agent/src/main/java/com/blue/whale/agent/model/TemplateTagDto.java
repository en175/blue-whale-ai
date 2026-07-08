package com.blue.whale.agent.model;

/**
 * 模板标签 DTO
 */
public class TemplateTagDto {

    /** 标签代码（对应 TemplateTagEnum.tagCode） */
    private String tagCode;
    /** 标签名称 */
    private String label;

    public TemplateTagDto() {
    }

    /**
     * 构造器
     *
     * @param tagCode 标签代码
     * @param label   标签名称
     */
    public TemplateTagDto(String tagCode, String label) {
        this.tagCode = tagCode;
        this.label = label;
    }

    public String getTagCode() {
        return tagCode;
    }

    public void setTagCode(String tagCode) {
        this.tagCode = tagCode;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }
}
