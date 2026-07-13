package com.blue.whale.security.resource.properties;


import cn.hutool.crypto.asymmetric.RSA;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.security.interfaces.RSAPublicKey;

/**
 * ResourceProperties
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description:
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "spring.security.oauth2.resource.server")
public class ResourceProperties {

    /**
     * 是否允许iframe访问  会添加响应头 x-frame-options deny
     */
    private boolean enableFrameOptions = true;

    /**
     * 是否是认证服务
     */
    private boolean authorizationServer = false;

    /**
     * 允许直接访问的patterns
     *
     * @deprecated 直接根据@PreAuthorize注解鉴权
     */
    @Deprecated
    private String[] permitAll = {};
    /**
     * jwt公钥配置
     */
    private Key key = new Key();


    @Getter
    @Setter
    public static class Key {
        /**
         * 公钥
         */
        private String publicKey;

        public RSAPublicKey rsaPublicKey() {
            return (RSAPublicKey) new RSA(null, this.publicKey).getPublicKey();
        }
    }

}
