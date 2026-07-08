package com.blue.whale.tool.mybatis.plus.config;


import com.blue.whale.tool.mybatis.plus.IManualTransaction;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;

/**
 * TransactionalConfig
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: mybatis plus 事务配置
 */
@Configuration
public class TransactionalConfig {

    @Bean
    public CommandLineRunner manualTransactionLineRunner(PlatformTransactionManager platformTransactionManager, TransactionDefinition transactionDefinition) {
        return args -> {
            IManualTransaction.platformTransactionManager = platformTransactionManager;
            IManualTransaction.transactionDefinition = transactionDefinition;
        };
    }
}
