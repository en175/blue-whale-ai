package com.bluewhale.worker.persistence;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 资产 Mapper（契约 §8：资产落库与源资产解析）。
 */
@Mapper
public interface AssetMapper extends BaseMapper<Asset> {

    /**
     * IKDD4Z：查当前项目显式关联的素材 id（project_asset 跨项目复用，is_delete=0）。
     * 逐字移植 generation-worker-asset-ops.ts:12-26（findLinkedAssetIds）。
     * 关联命中的素材即使 assets.project_id 指向别项目（跨项目复用）也视为本项目可用。
     */
    @Select("""
            SELECT asset_id FROM project_asset
            WHERE user_id = #{userId}
              AND project_id = #{projectId}
              AND is_delete = 0
            """)
    List<Long> findLinkedAssetIds(
            @Param("userId") Long userId,
            @Param("projectId") Long projectId
    );

    /**
     * 解析 media_extract 源资产（generation-worker-asset-ops.ts:84-98）。
     * <p>
     * 归属 = 本项目直接 ∪ 全局素材(project_id=0) ∪ project_asset 显式关联（IKDD4Z 三分支，
     * linkedIds 为空时跳过第三分支——与 TS 条件展开逐字一致）。
     * storage_key 为 null 的空判在 AssetSourceResolver（TS :99-100）。
     */
    @Select("""
            <script>
            SELECT storage_key, url, mime FROM assets
            WHERE id = #{assetId}
              AND user_id = #{userId}
              AND status = 'normal'
              AND is_delete = false
              AND (
                project_id = #{projectId}
                OR project_id = 0
                <if test="linkedIds != null and !linkedIds.isEmpty()">
                  OR id IN
                  <foreach item="l" collection="linkedIds" open="(" separator="," close=")">#{l}</foreach>
                </if>
              )
            LIMIT 1
            </script>
            """)
    Asset resolveSourceAssetWithLinked(
            @Param("assetId") Long assetId,
            @Param("userId") Long userId,
            @Param("projectId") Long projectId,
            @Param("linkedIds") List<Long> linkedIds
    );
}
