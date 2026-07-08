package com.bluewhale.agent.config;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * MyBatis-Plus 配置：集中 Mapper 扫描（{@code com.bluewhale.**.mapper}）+ 分页 + 乐观锁拦截器。
 *
 * <p>裁剪自 sweet-oa-common-mybatis-plus：去掉多租户、数据权限、自定义雪花 ID 生成器。
 * 不加 {@code @ConditionalOnBean(DataSource.class)}：该注解用在用户 {@code @Configuration} 上评估时序早于
 * auto-config 注册 DataSource，会误判 false 导致 {@code @MapperScan} 失效（全 context 启动找不到 mapper bean）。
 * 切片测试（{@code @WebMvcTest}）本就不加载此类，无需条件隔离。
 */
@Configuration
@MapperScan("com.bluewhale.**.mapper")
public class MybatisPlusConfig {

    @Bean
    @ConditionalOnMissingBean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL));
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
        return interceptor;
    }
}
