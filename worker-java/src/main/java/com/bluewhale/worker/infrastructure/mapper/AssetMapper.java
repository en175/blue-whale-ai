package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.application.service.AssetSourceService;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 资产 Mapper（契约 §8：资产落库与源资产解析）。
 */
@Mapper
public interface AssetMapper extends BaseMapper<AssetEntity> {

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
     * storage_key 为 null 的空判在 AssetSourceService（TS :99-100）。
     */
    @Select("""
            <script>
            SELECT storage_key, url, mime, type FROM assets
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
    AssetEntity resolveSourceAssetWithLinked(
            @Param("assetId") Long assetId,
            @Param("userId") Long userId,
            @Param("projectId") Long projectId,
            @Param("linkedIds") List<Long> linkedIds
    );

    // ========== 音频/图片输入素材解析（blade-② asset-ops.ts:30-79） ==========

    /**
     * 解析输入素材（resolveInputAssets，asset-ops.ts:34-58）。
     * <p>
     * 归属三分支（IKDD4Z）：本项目直接 ∪ 全局素材(project_id=0) ∪ project_asset 显式关联。
     * 返回 id/type/url/mime/size/width/height/duration_ms/material_id（select 与 TS :46-57 逐字一致）。
     */
    @Select("""
            <script>
            SELECT id, type, url, mime, size, width, height, duration_ms, material_id
            FROM assets
            WHERE id IN
            <foreach item="aid" collection="assetIds" open="(" separator="," close=")">#{aid}</foreach>
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
            </script>
            """)
    List<AssetEntity> resolveInputAssetsWithLinked(
            @Param("assetIds") List<Long> assetIds,
            @Param("userId") Long userId,
            @Param("projectId") Long projectId,
            @Param("linkedIds") List<Long> linkedIds
    );
}
