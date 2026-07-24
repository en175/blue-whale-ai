package com.blue.whale.tool.upload.service;

import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.upload.model.ObjectHead;
import com.blue.whale.tool.upload.model.OssConfig;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.TOSV2ClientBuilder;
import com.volcengine.tos.TosClientException;
import com.volcengine.tos.TosServerException;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.HeadObjectV2Input;
import com.volcengine.tos.model.object.HeadObjectV2Output;
import com.volcengine.tos.model.object.ObjectMetaRequestOptions;
import com.volcengine.tos.model.object.PutObjectInput;
import com.volcengine.tos.model.object.PutObjectOutput;
import com.volcengine.tos.transport.TransportConfig;
import lombok.extern.slf4j.Slf4j;

import java.io.ByteArrayInputStream;
import java.io.InputStream;

/**
 * 火山引擎 TOS 云存储实现。
 *
 * <p>客户端实例线程安全，全局复用一个即可。连接池参数通过 {@link TransportConfig} 配置。</p>
 *
 * @author: Jiyeon2__
 * date: 2024/11/13
 */
@Slf4j
public class VolcengineStorageService extends AbstractStorageService {

    private final TOSV2 client;

    /**
     * @param config               OSS 配置（调用方保证凭证非空）
     * @param maxConnections       连接池最大连接数
     * @param connectTimeoutMs     连接超时（毫秒）
     * @param readTimeoutMs        读取超时（毫秒）
     * @param idleConnectionAliveMs 空闲连接存活时间（毫秒）
     */
    public VolcengineStorageService(OssConfig config,
                                    int maxConnections,
                                    int connectTimeoutMs,
                                    int readTimeoutMs,
                                    int idleConnectionAliveMs) {
        this.config = config;

        TransportConfig transportConfig = new TransportConfig()
                .setMaxConnections(maxConnections)
                .setConnectTimeoutMills(connectTimeoutMs)
                .setReadTimeoutMills(readTimeoutMs)
                .setIdleConnectionTimeMills(idleConnectionAliveMs);

        this.client = new TOSV2ClientBuilder().build(
                config.getRegion(),
                config.getEndpoint(),
                config.getAccessKey(),
                config.getSecretKey(),
                transportConfig);

        log.info("TOS 客户端初始化完成: region={}, bucket={}, maxConn={}, connectTimeout={}ms, readTimeout={}ms",
                config.getRegion(), config.getBucketName(),
                maxConnections, connectTimeoutMs, readTimeoutMs);
    }

    @Override
    public String upload(byte[] data, String path) {
        return upload(new ByteArrayInputStream(data), path);
    }

    @Override
    public String upload(InputStream inputStream, String path) {
        long start = System.currentTimeMillis();
        int size;
        try {
            byte[] buf = inputStream.readAllBytes();
            size = buf.length;
            ObjectMetaRequestOptions options = new ObjectMetaRequestOptions()
                    .setAclType(ACLType.ACL_PUBLIC_READ);
            PutObjectInput putObjectInput = new PutObjectInput()
                    .setBucket(config.getBucketName())
                    .setKey(path)
                    .setOptions(options)
                    .setContent(new ByteArrayInputStream(buf));
            PutObjectOutput output = client.putObject(putObjectInput);
            long cost = System.currentTimeMillis() - start;
            log.info("TOS putObject 成功: bucket={}, key={}, size={}bytes, cost={}ms, etag={}, crc64={}",
                    config.getBucketName(), path, size, cost,
                    output.getEtag(), output.getHashCrc64ecma());
        } catch (TosClientException e) {
            long cost = System.currentTimeMillis() - start;
            log.error("TOS putObject 客户端错误: bucket={}, key={}, cost={}ms, message={}",
                    config.getBucketName(), path, cost, e.getMessage(), e);
            throw new GlobalException("上传文件失败，客户端参数错误: " + e.getMessage(), e);
        } catch (TosServerException e) {
            long cost = System.currentTimeMillis() - start;
            log.error("TOS putObject 服务端错误: bucket={}, key={}, cost={}ms, statusCode={}, code={}, requestId={}",
                    config.getBucketName(), path, cost,
                    e.getStatusCode(), e.getCode(), e.getRequestID());
            throw new GlobalException(
                    String.format("上传文件失败，服务端错误(status=%d, code=%s, requestId=%s)",
                            e.getStatusCode(), e.getCode(), e.getRequestID()), e);
        } catch (Throwable t) {
            long cost = System.currentTimeMillis() - start;
            log.error("TOS putObject 未知错误: bucket={}, key={}, cost={}ms, message={}",
                    config.getBucketName(), path, cost, t.getMessage(), t);
            throw new GlobalException("上传文件失败，未知错误: " + t.getMessage(), t);
        }
        return config.getDomain() + "/" + path;
    }

    /**
     * HEAD 对象元信息，commit 校验用（确认对象存在 + size + content-type）。
     *
     * <p>TODO(IK3PKB): {@code HeadObjectV2Input}/{@code HeadObjectV2Output} 及
     * {@code getContentLength}/{@code getContentType} 以 ve-tos-java-sdk 实际版本为准核实；
     * 配好 TOS 凭证后联调校正。当前按 TOSV2 命名规范（XxxV2Input/Output）编写。</p>
     */
    @Override
    public ObjectHead headObject(String key) {
        try {
            HeadObjectV2Input input = new HeadObjectV2Input()
                    .setBucket(config.getBucketName())
                    .setKey(key);
            HeadObjectV2Output output = client.headObject(input);
            return new ObjectHead(true, output.getContentLength(), output.getContentType());
        } catch (TosServerException e) {
            if (e.getStatusCode() == 404) {
                return new ObjectHead(false, null, null);
            }
            log.error("TOS headObject 服务端错误: bucket={}, key={}, status={}, code={}, requestId={}",
                    config.getBucketName(), key, e.getStatusCode(), e.getCode(), e.getRequestID(), e);
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE,
                    String.format("校验对象失败(status=%d, code=%s)", e.getStatusCode(), e.getCode()));
        } catch (TosClientException e) {
            log.error("TOS headObject 客户端错误: bucket={}, key={}", config.getBucketName(), key, e);
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "校验对象失败: " + e.getMessage());
        }
    }

    @Override
    public String uploadSuffix(byte[] data, String suffix) {
        return upload(data, getPath(config.getPrefix(), suffix));
    }

    @Override
    public String uploadFilenameSuffix(byte[] data, String filename, String suffix) {
        return upload(data, getFilenamePath(config.getPrefix(), filename, suffix));
    }

    @Override
    public String uploadSuffix(InputStream inputStream, String suffix) {
        return upload(inputStream, getPath(config.getPrefix(), suffix));
    }

    @Override
    public String uploadFilenameSuffix(InputStream inputStream, String filename, String suffix) {
        return upload(inputStream, getFilenamePath(config.getPrefix(), filename, suffix));
    }
}
