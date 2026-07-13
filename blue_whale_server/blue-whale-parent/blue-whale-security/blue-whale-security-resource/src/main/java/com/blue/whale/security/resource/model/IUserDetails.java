package com.blue.whale.security.resource.model;

import cn.hutool.core.collection.CollUtil;
import com.blue.whale.security.model.bean.SecureUser;
import com.blue.whale.security.model.enums.UserStatus;
import com.blue.whale.security.resource.helper.ISecurity;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.Collections;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 自定义 UserDetails 用户详情
 *
 * @author 张治保
 * date 2022/2/23
 */
@Getter
@RequiredArgsConstructor
public class IUserDetails implements UserDetails {

	private final SecureUser user;
	private final String password;
	private final Set<String> perms;


	@Override
	public String getPassword() {
		return password;
	}

	@Override
	public String getUsername() {
		return ISecurity.toPrincipal(getUser());
	}

	@Override
	public boolean isAccountNonExpired() {
		return UserStatus.EXPIRED != user.getStatus();
	}

	@Override
	public boolean isAccountNonLocked() {
		return UserStatus.LOCKED != user.getStatus();
	}

	@Override
	public boolean isCredentialsNonExpired() {
		return UserStatus.CREDENTIALS_EXPIRED != user.getStatus();
	}

	@Override
	public boolean isEnabled() {
		return UserStatus.UNAVAILABLE != user.getStatus();
	}


	@Override
	public Collection<? extends GrantedAuthority> getAuthorities() {
		if (CollUtil.isEmpty(perms)) {
			return Collections.emptyList();
		}

		/*
		 * perm
		 */
		Set<SimpleGrantedAuthority> authorities = perms.stream().map(SimpleGrantedAuthority::new).collect(Collectors.toSet());
		return authorities;
	}
}
