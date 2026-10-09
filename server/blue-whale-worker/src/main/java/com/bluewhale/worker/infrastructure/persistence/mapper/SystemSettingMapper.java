package com.bluewhale.worker.infrastructure.persistence.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface SystemSettingMapper {

    @Select("SELECT setting_value FROM system_settings WHERE setting_key = #{key}")
    String selectValue(@Param("key") String key);
}
