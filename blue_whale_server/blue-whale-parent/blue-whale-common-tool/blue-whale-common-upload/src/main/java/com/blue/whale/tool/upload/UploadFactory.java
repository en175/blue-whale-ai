package com.blue.whale.tool.upload;


import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.upload.model.OssConfig;
import com.blue.whale.tool.upload.service.AbstractStorageService;
import com.blue.whale.tool.upload.service.VolcengineStorageService;
import lombok.extern.slf4j.Slf4j;

import java.util.Objects;


/**
 * UploadFactory
 *
 * @author: Jiyeon2__
 * date: 2025/6/30
 * description: 文件上传Factory
 */
@Slf4j
public class UploadFactory {

    public static AbstractStorageService build() {
        //获取云存储配置信息
//        OssConfigDTO dto = FastJson2.convert(
//                RedisUtils.getCacheObject(OssConstant.OSS_KEY),
//                OssConfigDTO.class
//        );
        OssConfig ossConfig = new OssConfig();
        if (Objects.isNull(ossConfig)) {
            throw new GlobalException("未读取到 OSS配置");
        }
        log.debug("存储信息".concat(ossConfig.toString()));
        return switch (ossConfig.getType()) {
            case VOLCENGINE -> new VolcengineStorageService(ossConfig);
            case ALI_YUN -> null;
        };
    }
}
