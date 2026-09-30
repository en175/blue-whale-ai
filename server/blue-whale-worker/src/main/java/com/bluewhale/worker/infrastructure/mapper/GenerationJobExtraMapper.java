package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.GenerationJobExtraEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 生成任务扩展位 Mapper（IKJCOE / ADR-0120）。
 * <p>
 * 与 TS 侧 {@code generation-jobs-extra-repo.ts} 逐字同源：extra_key 用被迁移列的原字段名，
 * value_type ∈ string/number/boolean/json，number 存十进制字符串。
 * <p>
 * 写路径用 {@code ON DUPLICATE KEY UPDATE} 落在唯一索引
 * {@code uk_generation_job_extras__job_key(generation_job_id, extra_key)} 上，
 * 不靠应用层判重。
 */
@Mapper
public interface GenerationJobExtraMapper extends BaseMapper<GenerationJobExtraEntity> {

    /**
     * 查一个任务的全部扩展位。
     */
    @Select("""
            SELECT * FROM generation_job_extras
            WHERE generation_job_id = #{jobId}
            """)
    List<GenerationJobExtraEntity> findByJobId(@Param("jobId") Long jobId);

    /**
     * 批量查多个任务的扩展位（列表页投影用；调用方在内存里按 job 分组，避免逐行 N+1）。
     * <p>
     * ⚠️ {@code jobIds} **必须非空**：MyBatis 对空集合什么都不输出（连括号都不输出），
     * 渲染成 {@code ... IN   AND ...} 的坏 SQL。空列表由调用方在进入本方法前短路。
     */
    @Select("""
            <script>
            SELECT * FROM generation_job_extras
            WHERE generation_job_id IN
            <foreach collection="jobIds" item="item" open="(" separator="," close=")">#{item}</foreach>
            </script>
            """)
    List<GenerationJobExtraEntity> findByJobIds(@Param("jobIds") List<Long> jobIds);

    /**
     * 写一个扩展位（存在即覆盖）。
     * <p>
     * ⚠️ 「原 COALESCE(#{x}, col) = 非空才覆盖」的语义**不在 SQL 里**：调用方必须自己
     * 判空后决定要不要调本方法（TS 侧同理，用 {@code undefined} 表达「不动这个键」）。
     * 把判空藏在 SQL 里会让「写 null」与「不写」两种意图无法区分。
     */
    @Insert("""
            INSERT INTO generation_job_extras
                (generation_job_id, extra_key, value_type, value_text, gmt_create, gmt_modified)
            VALUES
                (#{jobId}, #{extraKey}, #{valueType}, #{valueText}, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                value_type = VALUES(value_type),
                value_text = VALUES(value_text),
                gmt_modified = NOW()
            """)
    int upsert(
            @Param("jobId") Long jobId,
            @Param("extraKey") String extraKey,
            @Param("valueType") String valueType,
            @Param("valueText") String valueText
    );
}
