package com.blue.whale.global.base.model;

import lombok.*;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.util.*;

/**
 * KeyValue
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
@Getter
@Setter
@ToString
@AllArgsConstructor
@NoArgsConstructor
@Accessors(chain = true)
@EqualsAndHashCode(of = "key")
public class KeyValue<K, V> implements Serializable {

    /**
     * key
     */
    private K key;

    /**
     * value
     */
    private V value;


    /**
     * 创建一个 key value 对象
     *
     * @param key   key
     * @param value value
     * @param <K>   key
     * @param <V>   value
     * @return KeyValue
     */
    public static <K, V> KeyValue<K, V> of(K key, V value) {
        return new KeyValue<>(key, value);
    }


    /**
     * 转成一个map对象
     *
     * @param keyValues keyValues
     * @param <K>       key type
     * @param <V>       value type
     * @return Map
     */
    public static <K, V> Map<K, V> toMap(Set<KeyValue<K, V>> keyValues) {
        if (keyValues == null) {
            return Collections.emptyMap();
        }
        Map<K, V> result = new HashMap<>(keyValues.size());
        for (KeyValue<K, V> keyValue : keyValues) {
            result.put(keyValue.getKey(), keyValue.getValue());
        }
        return result;
    }

    /**
     * map 转成 key value 对象集合
     *
     * @param keyValueMap map
     * @param <K>         key type
     * @param <V>         value type
     * @return Set of KeyValue
     */
    public static <K, V> Set<KeyValue<K, V>> of(Map<K, V> keyValueMap) {
        if (keyValueMap == null) {
            return Collections.emptySet();
        }
        Set<KeyValue<K, V>> keyValues = new HashSet<>(keyValueMap.size());
        keyValueMap.forEach(
                (key, value) -> keyValues.add(KeyValue.of(key, value))
        );
        return keyValues;
    }


}