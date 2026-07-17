package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.ContentReview;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * ContentReview Mapper：逻辑唯一身份见 {@code ContentReview} 类注释与
 * {@code uk_content_review_identity} 唯一键。
 */
public interface ContentReviewMapper extends BaseMapper<ContentReview> {

    @Select("SELECT * FROM content_reviews WHERE project_id = #{projectId} "
            + "AND subject_type = #{subjectType} AND subject_id = #{subjectId} "
            + "AND content_digest = #{contentDigest} AND modality = #{modality} "
            + "AND direction = #{direction} AND policy_version = #{policyVersion} "
            + "AND is_delete = 0 FOR UPDATE")
    ContentReview selectByIdentityForUpdate(
            @Param("projectId") Long projectId,
            @Param("subjectType") String subjectType,
            @Param("subjectId") String subjectId,
            @Param("contentDigest") String contentDigest,
            @Param("modality") String modality,
            @Param("direction") String direction,
            @Param("policyVersion") String policyVersion);
}
