package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.MaterialAssetEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * 素材校验状态镜像 Mapper（ADR-0087 决策 4：worker-java 定时跟进 Processing 行）。
 * <p>
 * 读写谓词约定：{@link #mirrorStatus} 带 user_id 做纵深防御（隔离语义在账号维度），
 * 这与 TS 侧 material-asset-repo.ts 一致。{@link #listProcessingWithin} 是唯一例外——
 * 定时跟进天然跨用户扫描，不加 user_id 谓词，且只取跟进窗口内的行。
 */
@Mapper
public interface MaterialAssetMapper extends BaseMapper<MaterialAssetEntity> {

    /**
     * 取跟进窗口内仍为 Processing 的行（逐行实时查上游）。
     * <p>
     * 窗口 = {@code gmt_create > now - maxAgeMinutes}。超过窗口仍 Processing 的行不再跟进，
     * 也不改写状态（ADR-0087 决策 4：不引入第四种状态）；这类素材若被拿来生成，
     * 拦截点会自己实时查一次上游，正确性不打折。
     * <p>
     * 只取三列：跟进只需要 id / 素材 id / 归属用户。
     */
    @Select("""
            SELECT id, material_id, user_id
            FROM material_assets
            WHERE status = 'Processing'
              AND gmt_create > DATE_SUB(NOW(), INTERVAL #{maxAgeMinutes} MINUTE)
            ORDER BY id ASC
            LIMIT #{limit}
            """)
    List<MaterialAssetEntity> listProcessingWithin(
            @Param("limit") int limit,
            @Param("maxAgeMinutes") int maxAgeMinutes
    );

    /**
     * 镜像上游状态回写（幂等覆盖）。只更新已存在的行——无行意味着没走过 CreateAsset，
     * 语义是「未校验」，不得凭空造行（与 TS mirrorStatus 同款）。
     *
     * @return 受影响行数（0 = 跟进期间该行已被删除，属正常竞态）
     */
    @Update("""
            UPDATE material_assets
            SET status = #{status},
                error_code = #{errorCode},
                error_message = #{errorMessage},
                status_checked_at = NOW(),
                gmt_modified = NOW(),
                version = version + 1
            WHERE material_id = #{materialId}
              AND user_id = #{userId}
            """)
    int mirrorStatus(
            @Param("userId") long userId,
            @Param("materialId") String materialId,
            @Param("status") String status,
            @Param("errorCode") String errorCode,
            @Param("errorMessage") String errorMessage
    );
}
