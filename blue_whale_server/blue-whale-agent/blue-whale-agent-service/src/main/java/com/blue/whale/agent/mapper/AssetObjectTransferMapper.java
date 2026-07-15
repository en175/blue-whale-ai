package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.AssetObjectTransfer;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;

public interface AssetObjectTransferMapper extends BaseMapper<AssetObjectTransfer> {

    @Select("SELECT * FROM asset_object_transfers WHERE transfer_token = #{token} "
            + "AND is_delete = 0 FOR UPDATE")
    AssetObjectTransfer selectByTokenForUpdate(@Param("token") String token);

    @Select("SELECT * FROM asset_object_transfers WHERE status = 'active' "
            + "AND expires_at <= #{now} AND is_delete = 0 ORDER BY id LIMIT 1 FOR UPDATE")
    AssetObjectTransfer selectExpiredForUpdate(@Param("now") LocalDateTime now);
}
