package com.bluewhale.worker.infrastructure.persistence.mapper;

import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.application.service.AssetSourceService;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface AssetMapper extends BaseMapper<AssetEntity> {

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

    @Select("""
            SELECT id FROM assets
            WHERE generation_job_id = #{generationJobId}
              AND storage_key = #{storageKey}
            LIMIT 1
            """)
    Long findReferencingAssetId(
            @Param("generationJobId") Long generationJobId,
            @Param("storageKey") String storageKey
    );

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
