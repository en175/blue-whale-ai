package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * Creative Skill 不可变版本表（IK3NPB）。
 *
 * <p>{@code body} 存「剥掉 frontmatter 的纯指导内容」（3A 决策）；
 * {@code content_digest} = {@code resource_digest} = sha256(body)（首批无引用资源，候选/激活用同一指纹）。
 * {@code (creative_skill_id, display_version)} 唯一，不可变快照。
 * 无 version/is_delete 列（与 runtime_bundle_versions 一致）。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName("creative_skill_version")
public class CreativeSkillVersion {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 不可变版本身份，正则 ^[a-z][a-z0-9_]{2,79}$ */
    private String creativeSkillVersionId;

    /** 所属技能 → creative_skill.creative_skill_id */
    private String creativeSkillId;

    /** SemVer 展示标签（来自 frontmatter version，默认 0.1.0） */
    private String displayVersion;

    /** 纯正文（剥掉 frontmatter 后的 markdown） */
    private String body;

    /** sha256(body UTF-8 字节)，read 层指纹 */
    private String contentDigest;

    /** 首批无引用资源，= content_digest（pin 层，候选/激活用） */
    private String resourceDigest;

    /** 正文 MIME，默认 text/markdown */
    private String mediaType;
}
