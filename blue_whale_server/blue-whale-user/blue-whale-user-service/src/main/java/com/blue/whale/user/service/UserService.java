package com.blue.whale.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.upload.service.AbstractStorageService;
import com.blue.whale.user.entity.User;
import com.blue.whale.user.mapper.UserMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDateTime;
import java.util.Set;

/**
 * 用户服务
 */
@Slf4j
@Service
public class UserService {

    private final UserMapper userMapper;
    @Nullable
    private final AbstractStorageService storageService;

    public UserService(UserMapper userMapper,
                       @Autowired(required = false) AbstractStorageService storageService) {
        this.userMapper = userMapper;
        this.storageService = storageService;
    }

    /** 允许的头像文件类型 */
    private static final Set<String> ALLOWED_CONTENT_TYPES = Set.of(
            "image/png", "image/jpeg", "image/gif", "image/webp"
    );
    /** 允许的文件后缀 */
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            "png", "jpg", "jpeg", "gif", "webp"
    );
    /** 头像最大 2MB */
    private static final long MAX_AVATAR_SIZE = 2 * 1024 * 1024;

    public User getById(Long userId) {
        return userMapper.selectById(userId);
    }

    /**
     * 更新手机号
     */
    public void updatePhone(Long userId, String newPhone) {
        Long count = userMapper.selectCount(
                new LambdaQueryWrapper<User>().eq(User::getPhone, newPhone)
        );
        if (count > 0) {
            throw new GlobalException(400, "该手机号已被其他账号绑定");
        }

        userMapper.update(null,
                new LambdaUpdateWrapper<User>()
                        .eq(User::getId, userId)
                        .set(User::getPhone, newPhone)
                        .set(User::getGmtModified, LocalDateTime.now())
        );
    }

    /**
     * 更新用户名
     */
    public void updateUsername(Long userId, String username) {
        Long count = userMapper.selectCount(
                new LambdaQueryWrapper<User>()
                        .eq(User::getUsername, username)
                        .ne(User::getId, userId)
        );
        if (count > 0) {
            throw new GlobalException(400, "该用户名已被占用");
        }

        userMapper.update(null,
                new LambdaUpdateWrapper<User>()
                        .eq(User::getId, userId)
                        .set(User::getUsername, username)
                        .set(User::getGmtModified, LocalDateTime.now())
        );
    }

    /**
     * 上传头像。
     *
     * @param userId 用户 ID
     * @param file   头像文件（图片，≤ 2MB）
     * @return 头像访问 URL
     */
    public String uploadAvatar(Long userId, MultipartFile file) {
        // 未配置 TOS 凭证时头像上传不可用
        if (storageService == null) {
            throw new GlobalException(500, "头像上传服务未配置，请联系管理员");
        }

        // 1. 校验文件类型
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_CONTENT_TYPES.contains(contentType)) {
            throw new GlobalException(400, "仅支持 PNG / JPG / GIF / WebP 格式");
        }

        // 2. 从原始文件名提取后缀并二次校验
        String originalFilename = file.getOriginalFilename();
        String suffix = "png";
        if (originalFilename != null && originalFilename.contains(".")) {
            suffix = originalFilename.substring(originalFilename.lastIndexOf('.') + 1).toLowerCase();
        }
        if (!ALLOWED_EXTENSIONS.contains(suffix)) {
            throw new GlobalException(400, "不支持的文件后缀: ." + suffix);
        }

        // 3. 校验文件大小
        if (file.getSize() > MAX_AVATAR_SIZE) {
            throw new GlobalException(400, "文件大小不能超过 2MB");
        }

        // 4. 上传到 TOS
        String url;
        try {
            url = storageService.uploadSuffix(file.getBytes(), suffix);
            log.info("头像上传成功: userId={}, url={}", userId, url);
        } catch (Exception e) {
            log.error("头像上传失败: userId={}", userId, e);
            throw new GlobalException(500, "头像上传失败，请稍后重试");
        }

        // 5. 更新 DB
        userMapper.update(null,
                new LambdaUpdateWrapper<User>()
                        .eq(User::getId, userId)
                        .set(User::getAvatar, url)
                        .set(User::getGmtModified, LocalDateTime.now())
        );

        return url;
    }
}
