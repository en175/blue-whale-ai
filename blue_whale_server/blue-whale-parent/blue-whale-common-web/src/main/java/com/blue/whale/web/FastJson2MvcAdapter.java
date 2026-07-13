package com.blue.whale.web;


import cn.hutool.core.util.ArrayUtil;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.support.config.FastJsonConfig;
import com.alibaba.fastjson2.support.spring.http.converter.FastJsonHttpMessageConverter;
import com.alibaba.fastjson2.support.spring.webservlet.view.FastJsonJsonView;
import com.blue.whale.tool.fastjson2.FastJson2;
import com.blue.whale.tool.fastjson2.filter.DesensitizeWriteFilter;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.StringHttpMessageConverter;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.config.annotation.ViewResolverRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * FastJson2MvcAdapter
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description:
 */
@EnableWebMvc
public class FastJson2MvcAdapter implements WebMvcConfigurer {

    FastJsonConfig config = new FastJsonConfig();

    {
        config.setDateFormat(FastJson2.DATE_PATTEN);
        // 前端字段全 snake_case（model_id / size_id 等），后端字段 camelCase（modelId / sizeId）。
        // SupportSmartMatch 让 fastjson2 反序列化时自动桥接 snake_case↔camelCase，否则 model_id 映射不到 modelId、触发校验失败。
        config.setReaderFeatures(ArrayUtil.append(FastJson2.readFeature(), JSONReader.Feature.TrimString, JSONReader.Feature.SupportSmartMatch));
        config.setWriterFeatures(ArrayUtil.append(FastJson2.writeFeature(), JSONWriter.Feature.WriteLongAsString));
        config.setWriterFilters(new DesensitizeWriteFilter());
    }

    @Override
    public void configureMessageConverters(List<HttpMessageConverter<?>> converters) {
        FastJsonHttpMessageConverter converter = new FastJsonHttpMessageConverter();
        converter.setFastJsonConfig(config);
        Charset charset = StandardCharsets.UTF_8;
        converter.setDefaultCharset(charset);
        converters.add(0, converter);
        converters.add(new StringHttpMessageConverter(charset));
    }

    @Override
    public void configureViewResolvers(ViewResolverRegistry registry) {
        FastJsonJsonView fastJsonJsonView = new FastJsonJsonView();
        fastJsonJsonView.setFastJsonConfig(config);
        registry.enableContentNegotiation(fastJsonJsonView);
    }
}
