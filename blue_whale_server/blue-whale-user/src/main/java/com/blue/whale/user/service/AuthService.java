package com.blue.whale.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.user.config.JwtUtil;
import com.blue.whale.user.dto.LoginResponse;
import com.blue.whale.user.entity.User;
import com.blue.whale.user.entity.VerificationCode;
import com.blue.whale.user.mapper.UserMapper;
import com.blue.whale.user.mapper.VerificationCodeMapper;
import com.blue.whale.user.sms.SmsProvider;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 认证服务：发验证码 / 登录注册
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserMapper userMapper;
    private final VerificationCodeMapper verificationCodeMapper;
    private final CaptchaService captchaService;
    private final SmsProvider smsProvider;
    private final JwtUtil jwtUtil;

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /** 同一手机号发送间隔（秒） */
    private static final long SEND_INTERVAL_SEC = 60;
    /** 单手机号每天上限 */
    private static final int PHONE_DAILY_LIMIT = 10;
    /** 单IP每小时上限 */
    private static final int IP_HOURLY_LIMIT = 20;
    /** 验证码有效期（分钟） */
    private static final int CODE_EXPIRE_MINUTES = 5;
    /** 验证码长度 */
    private static final int CODE_LENGTH = 6;

    // ==================== 发码 ====================

    /**
     * 发送短信验证码（四层限流）
     *
     * @param phone         手机号
     * @param ip            客户端IP
     * @param captchaToken  图形验证码 token
     * @param captchaAnswer 图形验证码答案
     */
    @Transactional(rollbackFor = Exception.class)
    public void sendCode(String phone, String ip, String captchaToken, String captchaAnswer) {
        // 层4：图形验证码校验
        captchaService.verify(captchaToken, captchaAnswer);

        // 手机号格式校验
        if (!phone.matches("1[3-9]\\d{9}")) {
            throw new GlobalException(400, "手机号格式不正确");
        }

        LocalDateTime now = LocalDateTime.now();

        // 层2：单手机号今日次数
        long todayCount = verificationCodeMapper.selectCount(
                new LambdaQueryWrapper<VerificationCode>()
                        .eq(VerificationCode::getPhone, phone)
                        .ge(VerificationCode::getGmtCreate, LocalDate.now().atStartOfDay())
        );
        if (todayCount >= PHONE_DAILY_LIMIT) {
            throw new GlobalException(429, "该手机号今日发送次数已达上限");
        }

        // 层3：同IP近1小时次数
        long ipCount = verificationCodeMapper.selectCount(
                new LambdaQueryWrapper<VerificationCode>()
                        .eq(VerificationCode::getIp, ip)
                        .ge(VerificationCode::getGmtCreate, now.minusHours(1))
        );
        if (ipCount >= IP_HOURLY_LIMIT) {
            throw new GlobalException(429, "操作过于频繁，请稍后再试");
        }

        // 层1：同手机号60s间隔
        VerificationCode lastCode = verificationCodeMapper.selectOne(
                new LambdaQueryWrapper<VerificationCode>()
                        .eq(VerificationCode::getPhone, phone)
                        .ge(VerificationCode::getGmtCreate, now.minusSeconds(SEND_INTERVAL_SEC))
                        .orderByDesc(VerificationCode::getGmtCreate)
                        .last("LIMIT 1")
        );
        if (lastCode != null) {
            throw new GlobalException(429, "发送过于频繁，请60秒后再试");
        }

        // 生成验证码
        String code = generateCode();
        log.info("生成验证码: phone={}, code={}", phone, code);

        // 持久化
        VerificationCode vc = new VerificationCode()
                .setPhone(phone)
                .setCode(code)
                .setIp(ip)
                .setGmtExpire(now.plusMinutes(CODE_EXPIRE_MINUTES))
                .setIsUsed(false)
                .setGmtCreate(now);
        verificationCodeMapper.insert(vc);

        // 发送短信
        smsProvider.send(phone, code);
    }

    // ==================== 登录 ====================

    /**
     * 手机号 + 验证码登录/注册
     */
    @Transactional(rollbackFor = Exception.class)
    public LoginResponse login(String phone, String code) {
        // 查最新未用过期的验证码
        VerificationCode vc = verificationCodeMapper.selectOne(
                new LambdaQueryWrapper<VerificationCode>()
                        .eq(VerificationCode::getPhone, phone)
                        .eq(VerificationCode::getIsUsed, false)
                        .gt(VerificationCode::getGmtExpire, LocalDateTime.now())
                        .orderByDesc(VerificationCode::getGmtCreate)
                        .last("LIMIT 1")
        );

        if (vc == null) {
            throw new GlobalException(401, "验证码已过期，请重新获取");
        }

        if (!vc.getCode().equals(code)) {
            throw new GlobalException(401, "验证码错误");
        }

        // 标记验证码已用
        vc.setIsUsed(true);
        verificationCodeMapper.updateById(vc);

        // 查用户：有则登录，无则注册
        User user = userMapper.selectOne(
                new LambdaQueryWrapper<User>()
                        .eq(User::getPhone, phone)
                        .last("LIMIT 1")
        );

        boolean isNewUser = (user == null);
        if (isNewUser) {
            user = new User()
                    .setPhone(phone)
                    .setUsername(generateUsername())
                    .setStatus("NORMAL");
            user.setGmtCreate(LocalDateTime.now());
            user.setGmtModified(LocalDateTime.now());
            user.setVersion(1);
            user.setDeleted(false);
            userMapper.insert(user);
            log.info("新用户注册: id={}, phone={}, username={}", user.getId(), phone, user.getUsername());
        } else {
            log.info("用户登录: id={}, phone={}", user.getId(), phone);
        }

        // 生成 JWT
        String token = jwtUtil.generate(String.valueOf(user.getId()), phone);

        return LoginResponse.builder()
                .token(token)
                .userId(user.getId())
                .username(user.getUsername())
                .phone(user.getPhone())
                .isNewUser(isNewUser)
                .build();
    }

    // ==================== 内部方法 ====================

    /**
     * 生成6位随机数字验证码
     */
    private String generateCode() {
        int code = SECURE_RANDOM.nextInt(1_000_000);  // 0 ~ 999999
        return String.format("%06d", code);             // pad to 6 digits
    }

    /**
     * 生成唯一用户名：用户 + 4位随机数（查重）
     */
    private String generateUsername() {
        String username;
        int maxRetries = 20;
        do {
            int n = ThreadLocalRandom.current().nextInt(10000);
            username = "用户" + String.format("%04d", n);
            Long count = userMapper.selectCount(
                    new LambdaQueryWrapper<User>().eq(User::getUsername, username)
            );
            if (count == 0) return username;
        } while (--maxRetries > 0);
        // 兜底：加随机后缀
        return "用户" + System.currentTimeMillis() % 100000;
    }
}
