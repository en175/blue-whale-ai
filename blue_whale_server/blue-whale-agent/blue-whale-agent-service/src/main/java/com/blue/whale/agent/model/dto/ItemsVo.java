package com.blue.whale.agent.model.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

/**
 * 列表包装：{@code { "items": [...] }}。对齐前端契约。
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class ItemsVo<T> {

    private List<T> items;
}
