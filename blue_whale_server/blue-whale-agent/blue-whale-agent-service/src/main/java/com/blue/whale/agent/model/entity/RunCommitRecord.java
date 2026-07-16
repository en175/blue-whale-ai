package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(chain = true)
@TableName("run_commits")
public class RunCommitRecord extends BaseEntity {
    private Long agentRunId;
    private String commitId;
    private String requestHash;
    private Long checkpointId;
    private Long generationJobId;
    private Long userInputRequestId;
    private Long committedCursor;
}
