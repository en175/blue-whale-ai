package com.blue.whale.agent.model.dto;

import lombok.Data;

/**
 * 前端直传 commit 请求：前端分片直传完成后，凭 storageKey 调后端落 Asset。
 *
 * <p>后端 HEAD object 校验对象真实存在 + size/MIME 匹配后 insert asset；
 * 同 storageKey 幂等（已落库直接返回）。</p>
 *
 * @author: IK3PKB
 */
@Data
public class CommitUploadRequest {
    /** 所属项目 ID */
    private Long projectId;
    /** 资源类型：image / video / audio */
    private String type;
    /** 前端直传目标 key（Next.js prepare 生成，传给前端） */
    private String storageKey;
    /** Content-Type，如 image/png */
    private String contentType;
    /** 字节大小 */
    private Long size;
    /** 图片宽度（前端读，可选） */
    private Integer width;
    /** 图片高度（前端读，可选） */
    private Integer height;
    /** 视频/音频时长秒（前端读 metadata，可选） */
    private Integer duration;
}
