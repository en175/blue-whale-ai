package com.blue.whale.tool.redis.utils;


import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.text.StrPool;
import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.RandomUtil;
import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.TypeReference;
import com.alibaba.fastjson2.support.config.FastJsonConfig;
import com.alibaba.fastjson2.support.spring.data.redis.FastJsonRedisSerializer;
import com.blue.whale.tool.fastjson2.FastJson2;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.dao.DataAccessException;
import org.springframework.data.geo.Distance;
import org.springframework.data.geo.Point;
import org.springframework.data.redis.core.*;
import org.springframework.lang.NonNull;

import java.time.Duration;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * RedisUtil
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: redis工具类
 */
@SuppressWarnings(value = {"unchecked", "rawtypes"})
public class RedisUtil {

    /**
     * fastjson配置
     */
    public static final FastJsonConfig fastJsonConfig = new FastJsonConfig();
    /**
     * 查询分布式锁后缀
     */
    private static final String QUERY_LOCK = "zqueryzGetbLockb";
    private final static DateTimeFormatter NO_FORMATTER = DateTimeFormatter.ofPattern("yyMMdd");
    private static RedisTemplate redisTemplate;
    private static RedissonClient redissonClient;
    private static String applicationName;

    static {
        fastJsonConfig.setJSONB(false);
    }

    public static String key(Object... keys) {
        return StrUtil.join(StrPool.COLON, keys);
    }

    public static String key(String... keys) {
        return StrUtil.join(StrPool.COLON, (Object[]) keys);
    }

    /**
     * 缓存基本的对象，Integer、String、实体类等
     *
     * @param key   缓存的键值
     * @param value 缓存的值
     */
    public static <T> void setCacheObject(final String key, final T value) {
        redisTemplate.opsForValue().set(key, value);
    }

    /**
     * 缓存基本的对象，Integer、String、实体类等
     *
     * @param key      缓存的键值
     * @param value    缓存的值
     * @param timeout  时间
     * @param timeUnit 时间颗粒度
     */
    public static <T> void setCacheObject(final String key, final T value, final Integer timeout, final TimeUnit timeUnit) {
        redisTemplate.opsForValue().set(key, value, timeout, timeUnit);
    }

    /**
     * 设置有效时间
     *
     * @param key     Redis键
     * @param timeout 超时时间
     * @return true=设置成功；false=设置失败
     */
    public static boolean expire(final String key, final long timeout) {
        return expire(key, timeout, TimeUnit.SECONDS);
    }

    /**
     * 设置有效时间
     *
     * @param key     Redis键
     * @param timeout 超时时间
     * @param unit    时间单位
     * @return true=设置成功；false=设置失败
     */
    public static boolean expire(final String key, final long timeout, final TimeUnit unit) {
        Boolean success = redisTemplate.expire(key, timeout, unit);
        return success != null && success;
    }

    /**
     * 获得缓存的基本对象。
     *
     * @param key 缓存键值
     * @return 缓存键值对应的数据
     */
    public static <T> T getCacheObject(final String key) {
        ValueOperations<String, T> operation = redisTemplate.opsForValue();
        return operation.get(key);
    }

    /**
     * 删除单个对象
     */
    public static boolean delete(final String key) {
        Boolean success = redisTemplate.delete(key);
        return success != null && success;
    }

    public static long delete(final String... key) {
        return RedisUtil.delete(Arrays.asList(key));
    }

    /**
     * 删除集合对象
     *
     * @param collection 多个对象
     */
    public static long delete(final Collection collection) {
        Long success = redisTemplate.delete(collection);
        return success != null ? success : 0;
    }

    /**
     * 缓存List数据
     *
     * @param key      缓存的键值
     * @param dataList 待缓存的List数据
     * @return 缓存的对象
     */
    public static <T> long setCacheList(final String key, final List<T> dataList) {
        Long count = redisTemplate.opsForList().rightPushAll(key, dataList);
        return count == null ? 0 : count;
    }

    /**
     * 获得缓存的list对象
     *
     * @param key 缓存的键值
     * @return 缓存键值对应的数据
     */
    public static <T> List<T> getCacheList(final String key) {
        return redisTemplate.opsForList().range(key, 0, -1);
    }

    public static <T> List<T> getCacheList(final String key, Class<T> type) {
        List<?> maps = redisTemplate.opsForList().range(key, 0, -1);
        return CollUtil.emptyIfNull(maps).stream().map(map -> RedisUtil.toBean(map, type)).collect(Collectors.toList());
    }

    public static <T> List<T> getCacheList(final String key, TypeReference<T> type) {
        List<?> maps = redisTemplate.opsForList().range(key, 0, -1);
        return CollUtil.emptyIfNull(maps).stream().map(map -> RedisUtil.toBean(map, type)).collect(Collectors.toList());
    }

    /**
     * 缓存Set
     *
     * @param key     缓存键值
     * @param dataSet 缓存的数据
     * @return 缓存数据的对象
     */
    public static <T> BoundSetOperations<String, T> setCacheSet(final String key, final Set<T> dataSet) {
        BoundSetOperations<String, T> setOperation = redisTemplate.boundSetOps(key);
        for (T t : dataSet) {
            setOperation.add(t);
        }

        return setOperation;
    }

    /**
     * 获得缓存的set
     */
    public static <T> Set<T> getCacheSet(final String key) {
        return redisTemplate.opsForSet().members(key);
    }

    public static <T> Set<T> getCacheSet(final String key, Class<T> type) {
        Set<?> maps = redisTemplate.opsForSet().members(key);
        return CollUtil.emptyIfNull(maps).stream().map(map -> RedisUtil.toBean(map, type)).collect(Collectors.toSet());
    }

    public static <T> Set<T> getCacheSet(final String key, TypeReference<T> type) {
        Set<?> maps = redisTemplate.opsForSet().members(key);
        return CollUtil.emptyIfNull(maps).stream().map(map -> RedisUtil.toBean(map, type)).collect(Collectors.toSet());
    }

    /**
     * 缓存ZSet
     *
     * @param key    缓存键值
     * @param tuples 缓存的数据
     */
    public static <T> void setCacheZSet(final String key, final Set<ZSetOperations.TypedTuple<T>> tuples) {
        BoundZSetOperations boundZSetOperations = redisTemplate.boundZSetOps(key);
        boundZSetOperations.add(tuples);
    }

    public static <T> List<T> getCacheZSet(final String key, long pageNum, long pageSize, Class<T> type) {
        Set<?> maps = redisTemplate.opsForZSet().range(key, pageNum, pageSize);
        return CollUtil.emptyIfNull(maps).stream().map(map -> RedisUtil.toBean(map, type)).collect(Collectors.toList());
    }

    /**
     * 缓存Map
     */
    public static <T> void setCacheMap(final String key, final Map<String, T> dataMap) {
        if (dataMap != null) {
            redisTemplate.opsForHash().putAll(key, dataMap);
        }
    }

    public static <T> void setCacheMap(final String key, final T object) {
        if (object != null) {
            redisTemplate.opsForHash().putAll(key, RedisUtil.toBean(object, Map.class));
        }
    }

    /**
     * 缓存 map 并设置 过期时间
     *
     * @param key    缓存key
     * @param object 缓存对象
     * @param time   过期时间
     * @param <T>    除基础数据类型、其封装类与String等外的对象
     */
    public static <T> void setCacheMap(final String key, final T object, Duration time) {
        RedisUtil.executePipelined(
                redisOperations -> redisOperations.opsForHash().putAll(key, RedisUtil.toBean(object, Map.class)),
                redisOperations -> redisOperations.expire(key, time)
        );
    }

    /**
     * 读取缓存
     * -> 读到数据 -> 缓存时间小于subTrigger ->为缓存续期 time
     * 缓存时间大于subTrigger -> 返回数据
     * -> 未读到数据 -> 运行factory生产数据 -> 设置到缓存并设置到过期时间 -> 返回数据
     *
     * @param cacheFactory   获取缓存数据方法
     * @param factory        缓存读不到时生产数据方法
     * @param key            缓存key
     * @param expireTime     缓存过期时间
     * @param subTriggerTime 触发续期的时间 小于这个时间 重新设置过期时间
     */
    public static <T> T getCacheMap(
            Supplier<T> cacheFactory,
            Supplier<T> factory,
            Duration expireTime,
            Duration subTriggerTime,
            String key
    ) {
        RedisTemplate<String, Object> template = RedisUtil.getRedisTemplate();
        T cacheValue = cacheFactory.get();
        if (cacheValue != null) {
            Long expire = template.getExpire(key, TimeUnit.SECONDS);
            if (subTriggerTime.compareTo(Duration.ofSeconds(expire == null ? 0L : expire)) >= 0) {
                template.expire(key, expireTime);
            }
            return cacheValue;
        }
        RLock lock = redissonClient.getLock(RedisUtil.key(key, QUERY_LOCK));
        lock.lock();
        try {
            cacheValue = cacheFactory.get();
            if (cacheValue != null) {
                return cacheValue;
            }
            T data = factory.get();
            if (data == null) {
                return null;
            }
            if (data instanceof String || ObjectUtil.isBasicType(data)) {
                RedisUtil.setCacheObject(key, data);
                return data;
            }
            RedisUtil.setCacheMap(key, data, expireTime);
            return data;
        } finally {
            lock.unlock();
        }

    }

    public static <T> T getCacheMap(
            Class<T> type,
            Supplier<T> factory,
            Duration expireTime,
            Duration subTriggerTime,
            String key
    ) {
        return RedisUtil.getCacheMap(
                () -> RedisUtil.getCacheMap(key, type),
                factory,
                expireTime,
                subTriggerTime,
                key
        );
    }

    public static <T> T getCacheMap(
            TypeReference<T> reference,
            Supplier<T> factory,
            Duration expireTime,
            Duration subTriggerTime,
            String key
    ) {
        return RedisUtil.getCacheMap(
                () -> RedisUtil.getCacheMap(key, reference),
                factory,
                expireTime,
                subTriggerTime,
                key
        );
    }

    public static <T> T getCacheMap(
            Class<T> type,
            Supplier<T> factory,
            Duration expireTime,
            Duration subTriggerTime,
            Object... keys
    ) {
        return RedisUtil.getCacheMap(type, factory, expireTime, subTriggerTime, RedisUtil.key(keys));
    }

    public static <T> T getCacheMap(
            TypeReference<T> reference,
            Supplier<T> factory,
            Duration expireTime,
            Duration subTriggerTime,
            Object... keys
    ) {
        return RedisUtil.getCacheMap(reference, factory, expireTime, subTriggerTime, RedisUtil.key(keys));
    }

    /**
     * pipeline模式 执行缓存
     *
     * @param tasks 执行任务
     * @return 执行结果
     */
    public static List<Object> executePipelined(final Consumer<RedisOperations>... tasks) {
        return RedisUtil.getRedisTemplate().executePipelined(
                new SessionCallback<Object>() {
                    @Override
                    public Object execute(@NonNull RedisOperations operations) throws DataAccessException {
                        for (Consumer<RedisOperations> task : tasks) {
                            task.accept(operations);
                        }
                        return null;
                    }
                }
        );
    }

    /**
     * 固定时间加上随机数 以免发生同时大面积缓存失效
     */
    public static long expireWithRandom(long fixedTime, long randomRange) {
        return fixedTime + RandomUtil.randomLong(0, randomRange);
    }

    /**
     * 固定时间加上随机数 以免发生同时大面积缓存失效
     */
    public static long expireWithRandom(long fixedTime) {
        return RedisUtil.expireWithRandom(fixedTime, fixedTime);
    }

    /**
     * 获得缓存的Map
     */
    public static <T> Map<String, T> getCacheMap(final String key) {
        return redisTemplate.opsForHash().entries(key);
    }

    public static <T> T getCacheMap(final String key, Class<T> type) {
        Map entries = redisTemplate.opsForHash().entries(key);
        if (entries.size() == 0) {
            return null;
        }
        return RedisUtil.toBean(entries, type);
    }

    public static <T> T getCacheMap(final String key, TypeReference<T> type) {
        Map entries = redisTemplate.opsForHash().entries(key);
        if (entries.size() == 0) {
            return null;
        }
        return RedisUtil.toBean(entries, type);
    }

    /**
     * 往Hash中存入数据
     *
     * @param key   Redis键
     * @param hKey  Hash键
     * @param value 值
     */
    public static <T> void setCacheMapValue(final String key, final String hKey, final T value) {
        redisTemplate.opsForHash().put(key, hKey, value);
    }

    /**
     * 获取Hash中的数据
     *
     * @param key  Redis键
     * @param hKey Hash键
     * @return Hash中的对象
     */
    public static <T> T getCacheMapValue(final String key, final String hKey) {
        HashOperations<String, String, T> opsForHash = redisTemplate.opsForHash();
        return opsForHash.get(key, hKey);
    }

    public static <T> T getCacheMapValue(final String key, final String hKey, Class<T> type) {
        HashOperations<String, String, T> opsForHash = redisTemplate.opsForHash();
        return RedisUtil.toBean(opsForHash.get(key, hKey), type);
    }

    public static <T> T getCacheMapValue(final String key, final String hKey, TypeReference<T> type) {
        HashOperations<String, String, T> opsForHash = redisTemplate.opsForHash();
        return RedisUtil.toBean(opsForHash.get(key, hKey), type);
    }

    /**
     * 删除Hash中的数据
     */
    public static void delCacheMapValue(final String key, final String... hashKey) {
        HashOperations hashOperations = redisTemplate.opsForHash();
        hashOperations.delete(key, (Object[]) hashKey);
    }

    /**
     * 缓存延迟双删
     *
     * @param factory 目标任务
     * @param keys    插入':' 拼接成需要删除的缓存key
     * @param <T>     any object
     * @return 目标任务返回结果
     */
    public static <T> T doubleDeletion(Supplier<T> factory, Object... keys) {
        return RedisUtil.doubleDeletion(
                factory,
                () -> RedisUtil.getRedisTemplate().delete(
                        RedisUtil.key(keys)
                )
        );
    }

    /**
     * 缓存延迟双删
     *
     * @param task 目标任务
     * @param keys 插入':' 拼接成需要删除的缓存key
     */
    public static void doubleDeletion(Runnable task, Object... keys) {
        RedisUtil.doubleDeletion(
                task,
                () -> RedisUtil.getRedisTemplate().delete(
                        RedisUtil.key(keys)
                )
        );
    }

    /**
     * 缓存延迟双删
     *
     * @param factory 目标任务
     * @param key     需要删除的缓存key
     * @param <T>     any object
     * @return 目标任务返回结果
     */
    public static <T> T doubleDeletion(Supplier<T> factory, String key) {
        return RedisUtil.doubleDeletion(
                factory,
                () -> RedisUtil.getRedisTemplate().delete(key)
        );
    }

    /**
     * 缓存延迟双删
     *
     * @param task 目标任务
     * @param key  需要删除的缓存key
     */
    public static void doubleDeletion(Runnable task, String key) {
        RedisUtil.doubleDeletion(
                task,
                () -> RedisUtil.getRedisTemplate().delete(key)
        );
    }

    /**
     * 缓存延迟双删
     *
     * @param factory         执行的目标任务
     * @param deleteCacheTask 清除缓存的任务
     * @param <T>             any object
     * @return 执行目标任务的返回结果
     */
    public static <T> T doubleDeletion(Supplier<T> factory, Runnable deleteCacheTask) {
        deleteCacheTask.run();
        T data = factory.get();
        //延迟800毫秒秒再删一次
        DelayExecutor.DELAY_EXECUTOR.schedule(deleteCacheTask, 800, TimeUnit.MILLISECONDS);
        return data;
    }

    /**
     * 缓存延迟双删
     *
     * @param task            目标任务
     * @param deleteCacheTask 清楚缓存任务
     */
    public static void doubleDeletion(Runnable task, Runnable deleteCacheTask) {
        RedisUtil.doubleDeletion(
                () -> {
                    task.run();
                    return null;
                },
                deleteCacheTask
        );
    }

    /**
     * 获取多个Hash中的数据
     *
     * @param key   Redis键
     * @param hKeys Hash键集合
     * @return Hash对象集合
     */
    public static <T> List<T> getMultiCacheMapValue(final String key, final Collection<?> hKeys) {
        return redisTemplate.opsForHash().multiGet(key, hKeys);
    }

    public static <T> List<T> getMultiCacheMapValue(final String key, final Collection<?> hKeys, Class<T> type) {
        List<?> list = redisTemplate.opsForHash().multiGet(key, hKeys);
        return CollUtil.emptyIfNull(list).stream().map(li -> RedisUtil.toBean(li, type)).toList();
    }

    public static <T> List<T> getMultiCacheMapValue(final String key, final Collection<?> hKeys, TypeReference<T> type) {
        List<?> list = redisTemplate.opsForHash().multiGet(key, hKeys);
        return CollUtil.emptyIfNull(list).stream().map(li -> RedisUtil.toBean(li, type)).collect(Collectors.toList());
    }

    /**
     * c
     * 计算两个坐标的距离 单位米
     */
    public static Distance distance(Point p1, Point p2) {
        String key = IdUtil.fastSimpleUUID();
        List<Object> result = RedisUtil.executePipelined(
                redisOperations -> {
                    GeoOperations geoOperations = redisOperations.opsForGeo();
                    geoOperations.add(key, p1, 0);
                    geoOperations.add(key, p2, 1);
                    geoOperations.distance(key, 0, 1);
                    redisOperations.delete(key);
                }
        );
        return ((Distance) result.get(2));
    }


    /**
     * 获得缓存的基本对象列表
     *
     * @param pattern 字符串前缀
     * @return 对象列表
     */
    public static Collection<String> keys(final String pattern) {
        return redisTemplate.keys(pattern);
    }

    /**
     * object -> bean 类型转换
     *
     * @param value     值
     * @param reference 类型
     * @param <T>       bean type
     * @return bean
     */
    public static <T> T toBean(Object value, TypeReference<T> reference) {
        return FastJson2.convert(value, reference, fastJsonConfig.getReaderFeatures());
    }

    /**
     * object -> bean 类型转换
     *
     * @param value 值
     * @param type  类型
     * @param <T>   bean type
     * @return bean
     */
    public static <T> T toBean(Object value, Class<T> type) {
        return FastJson2.convert(value, type, fastJsonConfig.getReaderFeatures());
    }

    /**
     * 获取分布式锁
     *
     * @param lockName 锁名称
     * @param key      锁 key
     * @return 目标分布式锁
     */
    public static String getLockKey(String lockName, Object key) {
        return RedisUtil.key(
                applicationName,
                lockName,
                key
        );
    }


    // ********** redisson **********

    /**
     * 获取分布式锁
     *
     * @param lockName 锁名称
     * @return 目标分布式锁
     */
    public static String getLockKey(String lockName) {
        return RedisUtil.key(
                applicationName,
                lockName
        );
    }

    /**
     * 锁定并执行
     *
     * @param lockKey 分布式锁
     * @param task    执行任务
     */
    public static void lockRun(String lockKey, Runnable task) {
        RedisUtil.lockRun(lockKey, () -> {
            task.run();
            return null;
        });
    }

    /**
     * 锁定并执行
     *
     * @param lockKey 分布式锁
     * @param task    执行任务
     * @param <T>     返回值类型
     * @return 返回值
     */
    public static <T> T lockRun(String lockKey, Supplier<T> task) {
        RLock lock = redissonClient.getLock(lockKey);
        lock.lock();
        try {
            return task.get();
        } finally {
            lock.unlock();
        }
    }

    public static void setRedisClient(RedisTemplate<String, Object> redisTemplate, RedissonClient redissonClient) {
        RedisUtil.redisTemplate = redisTemplate;
        RedisUtil.redissonClient = redissonClient;
    }

    public static RedisTemplate<String, Object> getRedisTemplate() {
        return RedisUtil.redisTemplate;
    }

    public static RedissonClient getRedissonClient() {
        return RedisUtil.redissonClient;
    }

    public static void setApplicationName(String applicationName) {
        RedisUtil.applicationName = applicationName;
    }


    /**
     * 获取redis value 序列化器
     *
     * @return 序列化器
     */
    public static FastJsonRedisSerializer<Object> valueSerializer() {
        return Lazy.VALUE_SERIALIZER;
    }

    private static class Lazy {
        private static final FastJsonRedisSerializer<Object> VALUE_SERIALIZER = new FastJsonRedisSerializer<>(Object.class);

        static {
            VALUE_SERIALIZER.setFastJsonConfig(fastJsonConfig);
        }
    }

    /**
     * 懒加载 获取延迟执行线程池
     */
    private static class DelayExecutor {
        private final static ScheduledExecutorService DELAY_EXECUTOR = new ScheduledThreadPoolExecutor(4);
    }
}

