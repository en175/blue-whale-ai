package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.AssetStorageObject;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;

public interface AssetStorageObjectMapper extends BaseMapper<AssetStorageObject> {

    @Insert("INSERT INTO asset_storage_objects "
            + "(storage_key, source, state, active_transfer_count) "
            + "VALUES (#{storageKey}, #{source}, 'available', 0) "
            + "ON DUPLICATE KEY UPDATE storage_key = #{storageKey}")
    int insertAvailableIfAbsent(
            @Param("storageKey") String storageKey,
            @Param("source") String source);

    @Select("SELECT * FROM asset_storage_objects WHERE storage_key = #{storageKey} "
            + "AND is_delete = 0 FOR UPDATE")
    AssetStorageObject selectByStorageKeyForUpdate(@Param("storageKey") String storageKey);

    @Select("SELECT * FROM asset_storage_objects WHERE state IN ('available', 'deleting') "
            + "AND active_transfer_count = 0 AND first_unreferenced_at IS NOT NULL "
            + "AND first_unreferenced_at <= #{cutoff} "
            + "AND (state = 'available' OR delete_lease_expires_at <= #{now}) "
            + "AND is_delete = 0 ORDER BY id LIMIT 1 FOR UPDATE")
    AssetStorageObject selectGcCandidateForUpdate(
            @Param("cutoff") LocalDateTime cutoff,
            @Param("now") LocalDateTime now);

    /** 标记对象进入待回收计时（生成收件箱永久删除后无其他引用时调用，GC 保留期后物理回收）。 */
    @Update("UPDATE asset_storage_objects SET first_unreferenced_at = #{now}, "
            + "gmt_modified = CURRENT_TIMESTAMP WHERE storage_key = #{storageKey} AND is_delete = 0")
    int markFirstUnreferenced(@Param("storageKey") String storageKey, @Param("now") LocalDateTime now);
}
