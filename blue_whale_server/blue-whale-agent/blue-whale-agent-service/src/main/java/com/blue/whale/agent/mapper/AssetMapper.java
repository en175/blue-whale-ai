package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.Asset;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 资源 Mapper：复用 MyBatis-Plus {@link BaseMapper}，扫描自 {@code config.MybatisPlusConfig}（{@code com.bluewhale.**.mapper}）。
 */
public interface AssetMapper extends BaseMapper<Asset> {

    // Card、NodeItem、输出与恢复记录都通过 Asset 引用对象；逻辑删除行也保守计为引用。
    @Select("SELECT COUNT(*) FROM assets WHERE storage_key = #{storageKey}")
    long countAllByStorageKey(@Param("storageKey") String storageKey);

    /** 列出项目全部 asset 的去重 storage_key（含逻辑删除行，生成收件箱永久删除前快照用）。 */
    @Select("SELECT DISTINCT storage_key FROM assets "
            + "WHERE project_id = #{projectId} AND storage_key IS NOT NULL")
    List<String> selectDistinctStorageKeysByProjectId(@Param("projectId") Long projectId);

    /** 物理删除项目全部 asset（生成收件箱永久删除用，绕过逻辑删除）。 */
    @Delete("DELETE FROM assets WHERE project_id = #{projectId}")
    int hardDeleteByProjectId(@Param("projectId") Long projectId);
}
