package com.bluewhale.worker.infrastructure.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.worker.domain.entity.GenerationOutboxEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

@Mapper
public interface GenerationOutboxMapper extends BaseMapper<GenerationOutboxEntity> {

    @Select("""
            SELECT * FROM generation_outbox
            WHERE send_state = 'pending'
            ORDER BY id ASC
            LIMIT #{limit}
            """)
    List<GenerationOutboxEntity> listPending(@Param("limit") int limit);

    @Update("""
            UPDATE generation_outbox
            SET send_state = 'sent', sent_at = NOW(), gmt_modified = NOW()
            WHERE id = #{id} AND send_state = 'pending'
            """)
    int markSent(@Param("id") Long id);

    @Update("""
            UPDATE generation_outbox
            SET attempts = attempts + 1, gmt_modified = NOW()
            WHERE id = #{id} AND send_state = 'pending'
            """)
    int bumpAttempts(@Param("id") Long id);
}
