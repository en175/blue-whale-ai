package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

@Getter
@Setter
@Accessors(chain = true)
@TableName("asset_storage_objects")
public class AssetStorageObject extends BaseEntity {

    public static final String STATE_AVAILABLE = "available";
    public static final String STATE_DELETING = "deleting";
    public static final String STATE_DELETED = "deleted";

    private String storageKey;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String contentSha256;
    private String source;
    private String state;
    private Integer activeTransferCount;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private LocalDateTime firstUnreferencedAt;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String deleteOwner;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private LocalDateTime deleteLeaseExpiresAt;
}
