package com.blue.whale.tool.upload.service;


import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import com.blue.whale.global.utils.LocalDateTimeUtils;
import com.blue.whale.tool.upload.model.OssConfig;

import java.io.InputStream;
import java.time.LocalDateTime;

/**
 * AbstractCloudService
 *
 * @author: Jiyeon2__
 * date: 2025/6/30
 * description: 云存储
 */
public abstract class AbstractStorageService {
    /**
     * 云存储配置信息
     */
    OssConfig config;

    /**
     * 文件路径
     *
     * @param prefix 前缀
     * @param suffix 后缀
     * @return 返回上传路径
     */
    public String getPath(String prefix, String suffix) {
        //生成uuid
        String uuid = IdUtil.fastSimpleUUID();
        //文件路径
        String path = LocalDateTimeUtils.parseDateStr(LocalDateTime.now(), LocalDateTimeUtils.DEFAULT_DATE_INT_PATTERN) + "/" + uuid;

        if (StrUtil.isNotBlank(prefix)) {
            path = prefix + "/" + path;
        }

        return path + "." + suffix;
    }

    public String getFilenamePath(String prefix, String filename, String suffix) {
        //文件路径
        String path = LocalDateTimeUtils.parseDateStr(LocalDateTime.now(), LocalDateTimeUtils.DEFAULT_DATE_INT_PATTERN) + "/" + filename;

        if (StrUtil.isNotBlank(prefix)) {
            path = prefix + "/" + path;
        }

        return path + "." + suffix;
    }

    /**
     * 文件上传
     *
     * @param data 文件字节数组
     * @param path 文件路径，包含文件名
     * @return 返回http地址
     */
    public abstract String upload(byte[] data, String path);

    /**
     * 文件上传
     *
     * @param data   文件字节数组
     * @param suffix 后缀
     * @return 返回http地址
     */
    public abstract String uploadSuffix(byte[] data, String suffix);

    /**
     * 文件上传
     *
     * @param data   文件字节数组
     * @param suffix 后缀
     * @return 返回http地址
     */
    public abstract String uploadFilenameSuffix(byte[] data, String filename, String suffix);

    /**
     * 文件上传
     *
     * @param inputStream 字节流
     * @param path        文件路径，包含文件名
     * @return 返回http地址
     */
    public abstract String upload(InputStream inputStream, String path);

    /**
     * 文件上传
     *
     * @param inputStream 字节流
     * @param suffix      后缀
     * @return 返回http地址
     */
    public abstract String uploadSuffix(InputStream inputStream, String suffix);

    /**
     * 文件上传
     *
     * @param inputStream 字节流
     * @param suffix      后缀
     * @return 返回http地址
     */
    public abstract String uploadFilenameSuffix(InputStream inputStream, String filename, String suffix);
}
