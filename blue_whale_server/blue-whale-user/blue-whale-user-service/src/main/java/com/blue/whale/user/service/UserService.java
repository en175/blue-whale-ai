package com.blue.whale.user.service;

import com.blue.whale.user.entity.User;
import org.springframework.web.multipart.MultipartFile;

/**
 * 用户服务接口：用户信息查询 / 更新 / 头像上传。
 */
public interface UserService {

    /** 根据 ID 查询用户 */
    User getById(Long userId);

    /** 更新手机号 */
    void updatePhone(Long userId, String newPhone);

    /** 更新用户名 */
    void updateUsername(Long userId, String username);

    /** 上传头像，返回 URL */
    String uploadAvatar(Long userId, MultipartFile file);
}
