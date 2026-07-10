package com.blue.whale.tool.upload.service;


import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.upload.model.OssConfig;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.TOSV2ClientBuilder;
import com.volcengine.tos.TosClientException;
import com.volcengine.tos.TosServerException;
import com.volcengine.tos.model.object.PutObjectInput;
import com.volcengine.tos.model.object.PutObjectOutput;
import lombok.extern.slf4j.Slf4j;

import java.io.ByteArrayInputStream;
import java.io.InputStream;

/**
 * VolcengineStorageService
 *
 * @author: Jiyeon2__
 * date: 2024/11/13
 * description: 火山云存储
 */
@Slf4j
public class
VolcengineStorageService extends AbstractStorageService {

    private TOSV2 client;

    public VolcengineStorageService(OssConfig config) {
        this.config = config;
        init();
    }

    private void init() {
        client = new TOSV2ClientBuilder().build(
                config.getVeTosRegion(),
                config.getVeTosEndpoint(),
                config.getVeTosAccessKey(),
                config.getVeTosSecretKey()
        );
    }

    @Override
    public String upload(byte[] data, String path) {
        return upload(new ByteArrayInputStream(data), path);
    }

    @Override
    public String upload(InputStream inputStream, String path) {
        try {
            PutObjectInput putObjectInput = new PutObjectInput()
                    .setBucket(config.getVeTosBucketName())
                    .setKey(path)
                    .setContent(inputStream);
            PutObjectOutput output = client.putObject(putObjectInput);
            log.debug("putObject succeed, etag={}, crc64={}", output.getEtag(), output.getHashCrc64ecma());
        } catch (TosClientException e) {
            log.error("putObject failed, client error, message={}", e.getMessage(), e);
            throw new GlobalException("上传文件失败，客户端参数错误", e);
        } catch (TosServerException e) {
            log.error("putObject failed, server error, statusCode={}, code={}, message={}, requestId={}",
                    e.getStatusCode(), e.getCode(), e.getMessage(), e.getRequestID());
            throw new GlobalException("上传文件失败，服务端错误", e);
        } catch (Throwable t) {
            log.error("putObject failed, unexpected error, message={}", t.getMessage(), t);
            throw new GlobalException("上传文件失败，未知错误", t);
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