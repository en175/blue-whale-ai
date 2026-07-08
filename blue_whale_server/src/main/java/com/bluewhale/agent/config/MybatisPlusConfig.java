package com.bluewhale.agent.config;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

/**
 * MyBatis-Plus 配置：集中 Mapper 扫描（{@code com.bluewhale.**.mapper}）+ 分页 + 乐观锁拦截器。
 *
 * <p>裁剪自 sweet-oa-common-mybatis-plus：去掉多租户、数据权限、自定义雪花 ID 生成器。
 * {@code @ConditionalOnBean(DataSource.class)} 保证无数据源（如 {@code @WebMvcTest}）时不装配。
 */
@Configuration
@ConditionalOnBean(DataSource.class)
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
