package com.blue.whale.tool.idem.model;

import com.blue.whale.global.exception.Error;
import com.blue.whale.global.i18n.I18N;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * IdemError
 *
 * @author: Jiyeon2__
 * date: 2024/8/19
 * description:
 */
@Getter
@RequiredArgsConstructor
public enum IdemError implements Error {
	/**
	 * 重复提交不生效
	 */
	REPEAT_SUBMIT(IdemCode.REPEAT_SUBMIT, "");

	private final int code;

	private final String msgCode;

	@Override
	public int code() {
		return code;
	}

	@Override
	public String msg() {
		return I18N.msg("idem.repeat.submit");
	}
}
