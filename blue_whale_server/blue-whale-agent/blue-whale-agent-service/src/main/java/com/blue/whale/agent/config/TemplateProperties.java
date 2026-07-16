package com.blue.whale.agent.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 模板标签配置：绑定 {@code bluewhale.template.tags}，替代原硬编码 {@code TemplateTagEnum}。
 *
 * <p>tagCode/label/sortOrder 的单一来源为 application.yml，增删标签改配置即可，无需改代码与重新发布。
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "bluewhale.template")
public class TemplateProperties {

    /** 标签列表（application.yml 中 bluewhale.template.tags） */
    private List<TagItem> tags = new ArrayList<>();

    /**
     * 是否存在指定 tagCode（合法性校验用）。
     *
     * @param tagCode 标签代码
     * @return true 表示配置中存在该标签
     */
    public boolean containsTag(String tagCode) {
        if (tagCode == null || tags == null) {
            return false;
        }
        return tags.stream().anyMatch(tag -> tagCode.equals(tag.getTagCode()));
    }

    /**
     * 按 sortOrder 升序返回标签副本。
     *
     * @return 排序后的标签列表
     */
    public List<TagItem> sortedTags() {
        if (tags == null) {
            return List.of();
        }
        return tags.stream()
                .sorted(Comparator.comparingInt(TagItem::getSortOrder))
                .collect(Collectors.toList());
    }

    /** 单个标签配置项。 */
    @Getter
    @Setter
    public static class TagItem {
        /** 标签代码 */
        private String tagCode;
        /** 标签名称 */
        private String label;
        /** 排序，数值越小越靠前 */
        private int sortOrder;
    }
}
