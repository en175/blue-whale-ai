package com.blue.whale.tool.mybatis.plus;


import com.blue.whale.tool.mybatis.plus.config.MybatisPlusConfig;
import com.blue.whale.tool.mybatis.plus.config.TransactionalConfig;
import com.blue.whale.tool.mybatis.plus.handler.IMetaObjectHandler;
import org.springframework.context.annotation.Import;

/**
 * MybatisPlusAutoConfigure
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: mybatis plus 自动装配
 */
@Import(
        {
                MybatisPlusConfig.class,
                IMetaObjectHandler.class,
                TransactionalConfig.class
        }
)
public class MybatisPlusAutoConfigure {

}
