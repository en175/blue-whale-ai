package com.blue.whale.global.i18n;

import org.springframework.lang.NonNull;

import java.util.Set;

/**
 * I18N
 *
 * @author: Jiyeon2__
 * date: 2024/8/14
 * description: 国际化路径配置加载器
 */
public interface I18NPropertiesLoader {

	/**
	 * 国际化配置路径
	 *
	 * @return 路径集合
	 */
	@NonNull
	Set<String> paths();
}
