package com.blue.whale.gateway.sentinel;

import com.alibaba.csp.sentinel.adapter.gateway.common.api.ApiDefinition;
import com.alibaba.csp.sentinel.adapter.gateway.common.api.ApiPathPredicateItem;
import com.alibaba.csp.sentinel.adapter.gateway.common.api.ApiPredicateItem;
import com.alibaba.csp.sentinel.adapter.gateway.common.api.GatewayApiDefinitionManager;
import com.alibaba.csp.sentinel.adapter.gateway.common.rule.GatewayFlowRule;
import com.alibaba.csp.sentinel.adapter.gateway.common.rule.GatewayRuleManager;
import com.alibaba.csp.sentinel.adapter.gateway.sc.SentinelGatewayFilter;
import com.alibaba.csp.sentinel.adapter.gateway.sc.callback.GatewayCallbackManager;
import com.alibaba.csp.sentinel.adapter.gateway.sc.exception.SentinelGatewayBlockExceptionHandler;
import com.alibaba.csp.sentinel.datasource.ReadableDataSource;
import com.alibaba.csp.sentinel.datasource.nacos.NacosDataSource;
import com.alibaba.csp.sentinel.slots.block.degrade.DegradeRule;
import com.alibaba.csp.sentinel.slots.block.degrade.DegradeRuleManager;
import com.alibaba.csp.sentinel.slots.block.flow.FlowRule;
import com.alibaba.csp.sentinel.slots.block.flow.FlowRuleManager;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.TypeReference;
import com.alibaba.nacos.api.PropertyKeyConst;
import com.blue.whale.gateway.exception.SentinelBlockRequestHandler;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.codec.ServerCodecConfigurer;
import org.springframework.web.reactive.result.view.ViewResolver;

import javax.annotation.PostConstruct;
import java.util.*;

//@Configuration
public class SentinelConfiguration {

    @Value("${sentinel.nacos.serverAddr}")
    private String remoteAddress;

    @Value("${sentinel.nacos.groupId}")
    private String groupId;

    @Value("${sentinel.nacos.dataId.flowPostfix}")
    private String flowPostfix;

    @Value("${sentinel.nacos.dataId.degradePostfix}")
    private String degradePostfix;

    @Value("${sentinel.nacos.dataId.gwApiPostfix}")
    private String gwApiPostfix;

    @Value("${sentinel.nacos.dataId.gwFlowPostfix}")
    private String gwFlowPostfix;

    @Value("${spring.application.name}")
    private String appName;

    @Value("${spring.profiles.active}")
    private String nameSpace;

//    private static final String dataId = "com.alibaba.csp.sentinel.demo.flow.rule";

    private final List<ViewResolver> viewResolvers;

    private final ServerCodecConfigurer serverCodecConfigurer;

    public SentinelConfiguration(ObjectProvider<List<ViewResolver>> viewResolversProvider,
                                 ServerCodecConfigurer serverCodecConfigurer) {

        this.viewResolvers = viewResolversProvider.getIfAvailable(Collections::emptyList);
        this.serverCodecConfigurer = serverCodecConfigurer;
    }

    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public SentinelGatewayBlockExceptionHandler sentinelGatewayBlockExceptionHandler() {
        // Register the block exception handler for Spring Cloud Gateway.
        return new SentinelGatewayBlockExceptionHandler(viewResolvers, serverCodecConfigurer);
    }

    @Bean
    @Order(-1)
    public GlobalFilter sentinelGatewayFilter() {
        return new SentinelGatewayFilter();
    }

    @PostConstruct
    public void init() {

        Properties properties = new Properties();
        properties.put(PropertyKeyConst.SERVER_ADDR, remoteAddress);
        properties.put(PropertyKeyConst.NAMESPACE, nameSpace);

        //dubbo流控
        ReadableDataSource<String, List<FlowRule>> flowRuleDataSource = new NacosDataSource<>(properties, groupId, appName + flowPostfix,
                source -> JSON.parseObject(source, new TypeReference<List<FlowRule>>() {
                }));
        FlowRuleManager.register2Property(flowRuleDataSource.getProperty());

        //熔断
        ReadableDataSource<String, List<DegradeRule>> degradeRuleDataSource = new NacosDataSource<>(properties, groupId, appName + degradePostfix,
                source -> JSON.parseObject(source, new TypeReference<List<DegradeRule>>() {
                }));
        DegradeRuleManager.register2Property(degradeRuleDataSource.getProperty());

        //网关api分组
        ReadableDataSource<String, Set<ApiDefinition>> gatewayApiRuleDataSource = new NacosDataSource<>(properties, groupId, appName + gwApiPostfix,
                source -> parseJson(source));
        GatewayApiDefinitionManager.register2Property(gatewayApiRuleDataSource.getProperty());

        //网关流控
        ReadableDataSource<String, Set<GatewayFlowRule>> gatewayRuleDataSource = new NacosDataSource<>(properties, groupId, appName + gwFlowPostfix,
                source -> JSON.parseObject(source, new TypeReference<Set<GatewayFlowRule>>() {
                }));
        GatewayRuleManager.register2Property(gatewayRuleDataSource.getProperty());

        GatewayCallbackManager.setBlockHandler(new SentinelBlockRequestHandler());
    }


    /**
     * 自定义解析 解决sentinel 无法正确解析ApiDefinition的bug
     */
    private Set<ApiDefinition> parseJson(String data) {
        Set<ApiDefinition> apiDefinitions = new HashSet<>();
        JSONArray array = JSON.parseArray(data);
        for (Object obj : array) {
            JSONObject o = (JSONObject) obj;
            ApiDefinition apiDefinition = new ApiDefinition((o.getString("apiName")));
            Set<ApiPredicateItem> predicateItems = new HashSet<>();
            JSONArray itemArray = o.getJSONArray("predicateItems");
            if (itemArray != null) {
                predicateItems.addAll(itemArray.toJavaList(ApiPathPredicateItem.class));
            }
            apiDefinition.setPredicateItems(predicateItems);
            apiDefinitions.add(apiDefinition);
        }
        return apiDefinitions;
    }
}

