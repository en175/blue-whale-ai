package com.blue.whale.agent.vo;

import com.blue.whale.agent.model.TemplateCardDto;

import java.util.List;

/**
 * 模板卡片分页响应
 */
public class TemplatePageVo {

    /** 当前页数据 */
    private List<TemplateCardDto> records;
    /** 总记录数 */
    private long total;
    /** 当前页码 */
    private long current;
    /** 每页条数 */
    private long size;
    /** 总页数 */
    private long pages;

    public TemplatePageVo() {
    }

    /**
     * 全参构造器
     */
    public TemplatePageVo(List<TemplateCardDto> records, long total, long current, long size, long pages) {
        this.records = records;
        this.total = total;
        this.current = current;
        this.size = size;
        this.pages = pages;
    }

    public List<TemplateCardDto> getRecords() {
        return records;
    }

    public void setRecords(List<TemplateCardDto> records) {
        this.records = records;
    }

    public long getTotal() {
        return total;
    }

    public void setTotal(long total) {
        this.total = total;
    }

    public long getCurrent() {
        return current;
    }

    public void setCurrent(long current) {
        this.current = current;
    }

    public long getSize() {
        return size;
    }

    public void setSize(long size) {
        this.size = size;
    }

    public long getPages() {
        return pages;
    }

    public void setPages(long pages) {
        this.pages = pages;
    }
}
