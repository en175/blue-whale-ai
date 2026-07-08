package com.blue.whale.tool.upload.service;


import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.global.utils.LocalDateTimeUtils;
import com.blue.whale.tool.upload.model.OssConfig;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.TOSV2ClientBuilder;
import com.volcengine.tos.model.object.PutObjectInput;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.MalformedURLException;
import java.net.URL;
import java.net.URLConnection;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Objects;

/**
 * VolcengineStorageService
 *
 * @author: Jiyeon2__
 * date: 2024/11/13
 * description: 火山云存储
 */
public class VolcengineStorageService extends AbstractStorageService {

    private TOSV2 client;

    public VolcengineStorageService(OssConfig config) {
        this.config = config;

        //初始化
        init();
    }

    private void init() {
        client = new TOSV2ClientBuilder().build(config.getVeTosRegion(),
                config.getVeTosEndpoint(), config.getVeTosAccessKey(), config.getVeTosSecretKey());
    }

    @Override
    public String upload(byte[] data, String path) {
        return upload(new ByteArrayInputStream(data), path);
    }

    @Override
    public String upload(InputStream inputStream, String path) {
        try {
            PutObjectInput putObjectInput = new PutObjectInput()
                    .setBucket(config.getVeTosBucketName()).setKey(path).setContent(inputStream);
            client.putObject(putObjectInput);
        } catch (Exception e) {
            throw new GlobalException("上传文件失败，请检查配置信息", e);
        }

        return config.getVeTosDomain() + "/" + path;
    }

    @Override
    public String uploadSuffix(byte[] data, String suffix) {
        return upload(data, getPath(config.getVeTosPrefix(), suffix));
    }

    @Override
    public String uploadFilenameSuffix(byte[] data, String filename, String suffix) {
        return upload(data, getFilenamePath(config.getVeTosPrefix(), filename, suffix));
    }

    @Override
    public String uploadSuffix(InputStream inputStream, String suffix) {
        return upload(inputStream, getPath(config.getVeTosPrefix(), suffix));
    }

    @Override
    public String uploadFilenameSuffix(InputStream inputStream, String filename, String suffix) {
        return upload(inputStream, getFilenamePath(config.getVeTosPrefix(), filename, suffix));
    }
}
