package com.bluewhale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.bluewhale.agent.common.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * 资源实体：图片 / 视频的持久化（生成输出或上传）。
 *
 * <p>生成成功时由 service 层写入，{@code url} 存转存后地址（Ark video_url 24h 过期，必须后端转存）。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName("assets")
public class Asset extends BaseEntity {

    /** 资源类型 */
    public static final String TYPE_IMAGE = "image";
    public static final String TYPE_VIDEO = "video";

    /** 来源 */
    public static final String SOURCE_GENERATED = "generated";
    public static final String SOURCE_UPLOADED = "uploaded";

    /** 状态 */
    public static final String STATUS_NORMAL = "normal";
    public static final String STATUS_FAILED = "failed";

    private Long userId;

    /** image / video */
    private String type;

    /** 存储 key（本地路径或对象存储 key） */
    private String storageKey;

    /** 可访问 url */
    private String url;

    private String mime;
    /** 字节 */
    private Long size;
    private Integer width;
    private Integer height;
    /** 视频时长（秒） */
    private Integer duration;

    /** generated / uploaded */
    private String source;
    private String status;
}
