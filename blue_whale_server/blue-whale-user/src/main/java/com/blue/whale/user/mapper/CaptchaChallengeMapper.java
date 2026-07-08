package com.blue.whale.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.user.entity.CaptchaChallenge;
import org.apache.ibatis.annotations.Mapper;

/**
 * 图形验证码 Mapper
 */
@Mapper
public interface CaptchaChallengeMapper extends BaseMapper<CaptchaChallenge> {
}
