package com.bluewhale.worker.infrastructure.persistence.mapper;

import com.bluewhale.worker.domain.entity.MaterialAssetEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

@Mapper
public interface MaterialAssetMapper extends BaseMapper<MaterialAssetEntity> {

    @Select("""
            SELECT id, material_id, user_id
            FROM user_material_info
            WHERE status = 'Processing'
              AND gmt_create > DATE_SUB(NOW(), INTERVAL #{maxAgeMinutes} MINUTE)
            ORDER BY id ASC
            LIMIT #{limit}
            """)
    List<MaterialAssetEntity> listProcessingWithin(
            @Param("limit") int limit,
            @Param("maxAgeMinutes") int maxAgeMinutes
    );

    @Update("""
            UPDATE user_material_info
            SET status = #{status},
                error_code = #{errorCode},
                error_message = #{errorMessage},
                status_checked_at = NOW(),
                gmt_modified = NOW(),
                version = version + 1
            WHERE material_id = #{materialId}
              AND user_id = #{userId}
              AND (#{status} = 'Failed' OR status <> 'Failed')
            """)
    int mirrorStatus(
            @Param("userId") long userId,
            @Param("materialId") String materialId,
            @Param("status") String status,
            @Param("errorCode") String errorCode,
            @Param("errorMessage") String errorMessage
    );

    @Update("""
            UPDATE user_assets
            SET material_id = NULL,
                gmt_modified = NOW(),
                version = version + 1
            WHERE material_id = #{materialId}
              AND user_id = #{userId}
            """)
    int clearMaterialLink(
            @Param("userId") long userId,
            @Param("materialId") String materialId
    );
}
