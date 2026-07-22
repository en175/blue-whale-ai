package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * AgentRun 租约鉴权原语：校验 {@code X-Worker-Id} 持有未过期的 run 租约。
 *
 * <p>Conversation（IK2QBZ）与创作现场（IK2QC7）只读查询共用同一鉴权语义——以 runId 为根，
 * workerId 必须等于 {@code run.leaseOwner} 且 {@code leaseExpiresAt} 未过期。抽公共原语避免
 * 复制粘贴导致的安全漂移：将来改 lease 校验语义（如追加 fencing_token 校验）只改一处，
 * 不会因漏改某份副本而留下越权侧门。Project 范围由 run 绑定闭环——Worker 拿不到别的
 * Project 的 run 租约。
 */
@Component
@RequiredArgsConstructor
public class RunLeaseGuard {

    private final AgentRunMapper agentRunMapper;

    /**
     * 校验 workerId 持有 runId 的有效租约，返回鉴权通过的 AgentRun；任一不符抛规范化异常：
     * 缺 workerId → UNAUTHORIZED；run 不存在 → RESOURCE_NOT_FOUND；租约归属或过期不符 →
     * AGENT_RUN_CONFLICT（统一不泄漏资源存在性细节）。
     */
    public AgentRun requireLeasedRun(Long runId, String workerId) {
        if (workerId == null || workerId.isBlank()) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "未认证");
        }
        AgentRun run = agentRunMapper.selectById(runId);
        if (run == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        LocalDateTime now = agentRunMapper.selectCurrentTime();
        if (!workerId.equals(run.getLeaseOwner())
                || run.getLeaseExpiresAt() == null
                || !run.getLeaseExpiresAt().isAfter(now)) {
            throw new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE,
                    SystemCode.AGENT_RUN_CONFLICT.getMsg());
        }
        return run;
    }
}
