package com.blue.whale.user.service;

import com.blue.whale.user.dto.LoginResponse;

/**
 * 认证服务接口：发验证码 / 登录注册 / Token 刷新 / 登出 / 换绑手机号。
 */
public interface AuthService {

    /** 发送短信验证码 */
    void sendCode(String phone, String ip);

    /** 验证码登录（无则自动注册） */
    LoginResponse login(String phone, String code);

    /** 刷新双 token */
    LoginResponse refresh(String refreshToken);

    /** 登出：删除 refresh_token */
    void logout(String refreshToken);

    /** 向新手机号发换绑验证码 */
    void sendChangePhoneCode(Long userId, String newPhone, String ip);

    /** 校验验证码并换绑手机号 */
    void changePhone(Long userId, String newPhone, String code);

    /** 密码登录：account 支持手机号或用户名 */
    LoginResponse passwordLogin(String account, String password);

    /** 设置密码（已登录 + 短信验证码） */
    void setPassword(Long userId, String code, String password);

    /** 修改密码：短信验证码+旧密码双重验证，成功后全清 refresh_token 踢设备 */
    void changePassword(Long userId, String code, String oldPassword, String newPassword, String ip);
}
