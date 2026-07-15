package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.Asset;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 资源 Mapper：复用 MyBatis-Plus {@link BaseMapper}，扫描自 {@code config.MybatisPlusConfig}（{@code com.bluewhale.**.mapper}）。
 */
public interface AssetMapper extends BaseMapper<Asset> {

    // Card、NodeItem、输出与恢复记录都通过 Asset 引用对象；逻辑删除行也保守计为引用。
    @Select("SELECT COUNT(*) FROM assets WHERE storage_key = #{storageKey}")
    long countAllByStorageKey(@Param("storageKey") String storageKey);
}
