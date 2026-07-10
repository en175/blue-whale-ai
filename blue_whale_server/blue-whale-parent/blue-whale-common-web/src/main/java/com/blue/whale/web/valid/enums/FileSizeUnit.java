package com.blue.whale.web.valid.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * FileSizeUnit
 *
 * @author: Jiyeon2__
 * date: 2024/8/16
 * description: 文件size单位
 */
@Getter
@RequiredArgsConstructor

public enum FileSizeUnit {
    /**
     * B
     */
    B(1),

    /**
     * KB
     */
    KB(1024),

    /**
     * MB
     */
    MB(1024 * 1024),

    /**
     * GB
     */
    GB(1024 * 1024 * 1024);

    private final long size;
}
