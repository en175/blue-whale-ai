package com.blue.whale.tool.mybatis.plus;


import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * IManualTransaction
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 手动事务操作
 */
public class IManualTransaction {
    public static PlatformTransactionManager platformTransactionManager;
    public static TransactionDefinition transactionDefinition;

    /**
     * 当前事务提交之后 会执行的任务
     */
    public static void afterCommit(Runnable... tasks){
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        for (Runnable runnable : tasks) {
                            runnable.run();
                        }
                    }
                }
        );
    }

    /**
     * 手动开启一个事务
     * @param task 事务操作
     */
    public static void todo(Runnable task) {
        TransactionStatus transactionStatus = platformTransactionManager.getTransaction(transactionDefinition);
        boolean hashError = false;
        try {
            task.run();
            platformTransactionManager.commit(transactionStatus);
        } catch (Exception exception){
            hashError = true;
            throw exception;
        }finally {
            if (hashError && !transactionStatus.isCompleted() ) {
                platformTransactionManager.rollback(transactionStatus);
            }
        }
    }
}
