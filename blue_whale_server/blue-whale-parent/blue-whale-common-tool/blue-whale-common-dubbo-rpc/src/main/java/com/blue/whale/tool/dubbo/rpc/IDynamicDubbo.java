package com.blue.whale.tool.dubbo.rpc;


import io.vavr.control.Option;
import lombok.RequiredArgsConstructor;
import org.apache.dubbo.config.ConsumerConfig;
import org.apache.dubbo.config.ReferenceConfig;
import org.apache.dubbo.config.utils.SimpleReferenceCache;
import org.apache.dubbo.rpc.service.GenericService;
import org.apache.dubbo.spring.boot.autoconfigure.DubboConfigurationProperties;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * IDynamicDubbo
 *
 * @author: Jiyeon2__
 * date: 2024/11/14
 * description: duubo3 配置文件 {@link DubboConfigurationProperties}
 */
@RequiredArgsConstructor
public class IDynamicDubbo {

    private final static String GENERIC = "true";
    private static ConsumerConfig consumerConfig;

    public static GenericService genericService(String interfaceName) {
        SimpleReferenceCache cache = SimpleReferenceCache.getCache();
        GenericService genericService = cache.get(interfaceName);
        return Option.of(genericService)
                .getOrElse(
                        () -> {
                            GenericService service = cache.get(interfaceName);
                            if (service != null) {
                                return service;
                            }
                            synchronized (interfaceName.intern()) {
                                service = cache.get(interfaceName);
                                if (service != null) {
                                    return service;
                                }
                                ReferenceConfig<GenericService> referenceConfig = new ReferenceConfig<>();
                                referenceConfig.setId(interfaceName);
                                referenceConfig.setInterface(interfaceName);
                                referenceConfig.setConsumer(IDynamicDubbo.consumerConfig);
                                referenceConfig.setTimeout(IDynamicDubbo.consumerConfig.getTimeout());
                                referenceConfig.setGeneric(GENERIC);
                                referenceConfig.setAsync(Boolean.FALSE);
                                return cache.get(referenceConfig);
                            }
                        }
                );
    }

    @Autowired
    public void setConsumerConfig(DubboConfigurationProperties dubboConfigurationProperties) {
        IDynamicDubbo.consumerConfig = dubboConfigurationProperties.getConsumer();
    }
}
