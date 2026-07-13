package com.blue.whale.global.utils;


import cn.hutool.core.util.StrUtil;

import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.Date;
import java.util.Objects;

/**
 * LocalDateTimeUtils
 *
 * @author: Jiyeon2__
 * date: 2025/6/10
 * description: 时间工具类
 */
public class LocalDateTimeUtils {

    /**
     * 默认的时间格式
     */
    private static final String DEFAULT_TIME_PATTERN = "HH:mm:ss";

    /**
     * 默认的日期格式
     */
    public static final String DEFAULT_DATE_PATTERN = "yyyy-MM-dd";
    /**
     *
     */
    public static final String DEFAULT_DATE_INT_PATTERN = "yyyyMMdd";
    public static final String DEFAULT_MONTH_INT_PATTERN = "yyyyMM";

    /**
     * 默认的年月日时分秒格式
     */
    public static final String DEFAULT_PATTERN = "yyyy-MM-dd HH:mm:ss";

    /**
     * 字符串转日期
     *
     * @param dateStr 字符串日期
     * @return 日期
     */
    public static LocalDateTime toLocalDateTime(String dateStr) {
        return StrUtil.isBlank(dateStr) ? null : toLocalDateTime(dateStr, DEFAULT_PATTERN);
    }

    /**
     * date转日期
     *
     * @param date date日期
     * @return 日期
     */
    public static LocalDateTime toLocalDateTime(Date date) {
        if (Objects.isNull(date)) {
            return null;
        }

        return date.toInstant()
                .atZone(ZONEID)
                .toLocalDateTime();
    }

    /**
     * 字符串转日期
     *
     * @param dateStr 字符串日期
     * @param pattern 格式
     * @return 日期
     */
    public static LocalDateTime toLocalDateTime(String dateStr, String pattern) {
        if (StrUtil.isBlank(dateStr)) {
            return null;
        }
        if (StrUtil.equals(pattern, DEFAULT_DATE_PATTERN)) {
            return LocalDate.parse(dateStr, DateTimeFormatter.ofPattern(DEFAULT_DATE_PATTERN)).atStartOfDay();
        }
        return LocalDateTime.parse(dateStr, DateTimeFormatter.ofPattern(pattern));
    }

    private final static ZoneId ZONEID = ZoneId.of("Asia/Shanghai");

    /**
     * 时间戳转日期
     *
     * @param timestamp 时间戳(毫秒)
     * @return 日期
     */
    public static LocalDateTime toLocalDateTime(long timestamp) {
        Instant instant = Instant.ofEpochMilli(timestamp);
        return instant.atZone(ZONEID).toLocalDateTime();
    }

    public static String parseStrDate(String dateStr, String fromPattern, String toPattern) {
        return LocalDate.parse(dateStr, DateTimeFormatter.ofPattern(fromPattern)).format(DateTimeFormatter.ofPattern(toPattern));
    }

    /**
     * 转yyyyMMdd日期
     *
     * @param dateStr     日期字符串
     * @param fromPattern 格式
     * @return yyyyMMdd日期
     */
    public static Integer parseStrDateInt(String dateStr, String fromPattern) {
        return Integer.valueOf(parseStrDate(dateStr, fromPattern, DEFAULT_DATE_INT_PATTERN));
    }

    public static String parseDateStr(LocalDateTime localDateTime) {
        if (Objects.isNull(localDateTime)) {
            return null;
        }
        return localDateTime.format(DateTimeFormatter.ofPattern(DEFAULT_PATTERN));
    }

    public static String parseDateStr(LocalDateTime localDateTime, String pattern) {
        return localDateTime.format(DateTimeFormatter.ofPattern(pattern));
    }

    /**
     * 获取季度
     *
     * @param localDateTime 时间
     * @return 季度
     */
    public static Integer getQuarter(LocalDateTime localDateTime) {
        if (Objects.isNull(localDateTime)) {
            return null;
        }
        int month = localDateTime.getMonthValue();
        return (month - 1) / 3 + 1;
    }
}
