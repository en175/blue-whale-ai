package com.blue.whale.tool.upload.enums;


import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * StorageType
 *
 * @author: Jiyeon2__
 * date: 2025/06/30
 * description:
 */
@Getter
@RequiredArgsConstructor
public enum StorageType {
    /**
     * 阿里
     */
    ALI_YUN(1),
    /**
     * 火山引擎
     */
    VOLCENGINE(2),
    ;

    private final Integer value;
}
