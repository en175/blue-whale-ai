package com.blue.whale.tool.upload.model;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * HEAD 对象结果（commit 校验用：确认对象存在 + size + content-type）。
 *
 * @author: IK3PKB
 */
@Getter
@AllArgsConstructor
public class ObjectHead {
    /** 对象是否存在 */
    private final boolean exists;
    /** 对象字节大小（不存在时 null） */
    private final Long contentLength;
    /** 对象 Content-Type（不存在时 null） */
    private final String contentType;
}
