package com.blue.whale.web.valid.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * FileFormat
 *
 * @author: Jiyeon2__
 * date: 2024/8/16
 * description: 文件格式类型枚举
 */
@Getter
@RequiredArgsConstructor
public enum FileFormat {

    /**
     * 未知类型
     */
    ANY("ANY", ""),

    /**
     * webp
     */
    WEBP("WEBP", "52494646"),

    /**
     * jpeg
     */
    JPEG("JPEG", "FFD8FF"),

    /**
     * jpg
     */
    JPG("JPG", "FFD8FF"),

    /**
     * PNG
     */
    PNG("PNG", "89504E47"),

    /**
     * GIF
     */
    GIF("GIF", "47494638"),

    /**
     * tif
     */
    TIFF("TIF", "49492A00"),

    /**
     * Windows bitmap (bmp)
     */
    BMP("BMP", "424D"),

    /**
     * 16色位图(bmp)
     */
    BMP_16("BMP", "424D228C010000000000"),

    /**
     * 24位位图(bmp)
     */
    BMP_24("BMP", "424D8240090000000000"),

    /**
     * 256色位图(bmp)
     */
    BMP_256("BMP", "424D8E1B030000000000"),

    /**
     * XML
     */
    XML("XML", "3C3F786D6C"),

    /**
     * HTML
     */
    HTML("HTML", "68746D6C3E"),

    /**
     * XLS
     */
    XLS("XLS", "D0CF11E0"),

    /**
     * DOC
     */
    DOC("DOC", "D0CF11E0"),

    /**
     * DOCX
     */
    DOCX("DOCX", "504B0304"),

    /**
     * XLSX
     */
    XLSX("XLSX", "504B0304"),

    /**
     * PDF
     */
    PDF("PDF", "25504446");

    /**
     * 文件格式
     */
    private final String format;

    /**
     * 文件格式代码
     */
    private final String code;

}