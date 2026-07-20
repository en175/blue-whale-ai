package com.blue.whale.agent.model.request;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import java.util.List;

/**
 * 创建模板卡片请求。
 *
 * <p>同时落 template_card 主数据与 template_card_image 图片列表（按列表索引定 sortOrder）。
 */
@Data
public class CreateTemplateCardRequest {

    /** 所属标签代码（须为合法标签，否则 400） */
    @NotBlank(message = "标签不能为空")
    private String tagCode;

    /** 卡片标题 */
    @NotBlank(message = "标题不能为空")
    private String title;

    /** 视频地址；图片类型卡片可为空 */
    private String videoUrl;

    /** 布局：wide/portrait/social/image */
    @NotBlank(message = "布局不能为空")
    private String layout;

    /** 提示词：点击卡片后下发的 prompt 文本，可空 */
    private String content;

    /** 排序权重，数值越小越靠前；不传默认 0 */
    private Integer sortOrder;

    /** 图片地址列表；图片类型卡片按列表顺序入库 */
    private List<String> images;
}
