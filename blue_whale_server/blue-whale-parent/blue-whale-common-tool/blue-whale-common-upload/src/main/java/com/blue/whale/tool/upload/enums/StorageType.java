package com.blue.whale.tool.upload.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 云存储厂商类型。
 *
 * @author: Jiyeon2__
 * date: 2025/06/30
 */
@Getter
@RequiredArgsConstructor
public enum StorageType {
    /** 阿里云 OSS（待接入） */
    ALI_YUN(1),
    /** 火山引擎 TOS */
    VOLCENGINE(2),
    ;

    private final Integer value;
}
