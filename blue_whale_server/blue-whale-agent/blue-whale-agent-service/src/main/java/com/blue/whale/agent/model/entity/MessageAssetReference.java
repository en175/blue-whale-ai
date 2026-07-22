package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * 消息 @ 引用关系（消息 ↔ 素材）。
 *
 * <p>用户对话 @ 引用的素材随消息同事务持久化，供读路径白名单反查。conversation_id / project_id
 * 冗余存储以避免白名单反查 JOIN 消息表。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName("message_asset_reference")
public class MessageAssetReference extends BaseEntity {

    private Long messageId;
    private Long conversationId;
    private Long projectId;
    private Long assetId;
    private Integer mentionSeq;
}
