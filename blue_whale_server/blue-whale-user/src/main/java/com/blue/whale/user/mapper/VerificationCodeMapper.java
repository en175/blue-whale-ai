package com.blue.whale.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.user.entity.VerificationCode;
import org.apache.ibatis.annotations.Mapper;

/**
 * 验证码 Mapper
 */
@Mapper
public interface VerificationCodeMapper extends BaseMapper<VerificationCode> {
}
