package com.blue.whale.tool.upload.service;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import com.blue.whale.global.utils.LocalDateTimeUtils;
import com.blue.whale.tool.upload.model.OssConfig;

import java.io.InputStream;
import java.time.LocalDateTime;

/**
 * 云存储抽象基类。
 *
 * <p>提供路径生成 + 上传契约。具体实现见 {@link VolcengineStorageService}。</p>
 *
 * @author: Jiyeon2__
 * date: 2025/6/30
 */
public abstract class AbstractStorageService {
    /** 云存储配置 */
    protected OssConfig config;

    /**
     * 生成上传路径（UUID 文件名）。
     *
     * @param prefix 路径前缀
     * @param suffix 文件后缀（不含点）
     * @return 上传路径，格式 {@code prefix/yyyyMMdd/uuid.suffix}
     */
    public String getPath(String prefix, String suffix) {
        String uuid = IdUtil.fastSimpleUUID();
        String path = LocalDateTimeUtils.parseDateStr(LocalDateTime.now(),
                LocalDateTimeUtils.DEFAULT_DATE_INT_PATTERN) + "/" + uuid;
        if (StrUtil.isNotBlank(prefix)) {
            path = prefix + "/" + path;
        }
        return path + "." + suffix;
    }

    /**
     * 生成上传路径（指定文件名）。
     *
     * @param prefix   路径前缀
     * @param filename 文件名（调用方保证不含 {@code ../}）
     * @param suffix   文件后缀（不含点）
     * @return 上传路径，格式 {@code prefix/yyyyMMdd/filename.suffix}
     */
    public String getFilenamePath(String prefix, String filename, String suffix) {
        String path = LocalDateTimeUtils.parseDateStr(LocalDateTime.now(),
                LocalDateTimeUtils.DEFAULT_DATE_INT_PATTERN) + "/" + filename;
        if (StrUtil.isNotBlank(prefix)) {
            path = prefix + "/" + path;
        }
        return path + "." + suffix;
    }

    /** 上传字节数组 */
    public abstract String upload(byte[] data, String path);

    /** 上传字节数组（自动生成路径） */
    public abstract String uploadSuffix(byte[] data, String suffix);

    /** 上传字节数组（指定文件名） */
    public abstract String uploadFilenameSuffix(byte[] data, String filename, String suffix);

    /** 上传输入流 */
    public abstract String upload(InputStream inputStream, String path);

    /** 上传输入流（自动生成路径） */
    public abstract String uploadSuffix(InputStream inputStream, String suffix);

    /** 上传输入流（指定文件名） */
    public abstract String uploadFilenameSuffix(InputStream inputStream, String filename, String suffix);
}
