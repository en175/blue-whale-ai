package com.blue.whale.global.constants;

/**
 * LogAdvisor
 *
 * @author: Jiyeon2__
 * date: 2025/3/26
 * description: 切面执行顺序
 */
public interface AspectOrder {

    /**
     * idem 幂等校验 切面
     */
    int IDEM_ASPECT = Integer.MIN_VALUE;
    /**
     * 日志打印切面
     */
    int LOG_ASPECT = AspectOrder.IDEM_ASPECT + 100;
    /**
     * Redisson分布式锁 切面
     */
    int REDISSON_ASPECT = AspectOrder.LOG_ASPECT + 100;
    /**
     * cache 缓存 @Cacheable @CacheEvict ..
     */
    int CACHE_ASPECT = AspectOrder.DATASOURCE_ASPECT - 100;
    /**
     * 数据源切换切面
     */
    int DATASOURCE_ASPECT = AspectOrder.TRANSACTIONAL_ASPECT - 100;
    /**
     * transaction @Transactional
     */
    int TRANSACTIONAL_ASPECT = Integer.MAX_VALUE;


}
