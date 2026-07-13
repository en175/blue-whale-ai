package com.blue.whale.tool.idem;

import com.blue.whale.global.i18n.I18NPropertiesLoader;
import org.springframework.lang.NonNull;

import java.util.Set;

/**
 * IdemI18NLoader
 *
 * @author: Jiyeon2__
 * date: 2024/8/19
 * description:
 */
public class IdemI18NLoader implements I18NPropertiesLoader {
	@Override
	@NonNull
	public Set<String> paths() {
		return Set.of("i18n/idem");
	}
}
