package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.model.dto.JobListItemResponse;
import com.blue.whale.agent.model.dto.JobStatusResponse;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.service.governance.CostReservationService;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 生成任务查询服务：任务状态单查与列表分页（{@code JobController} 轮询 / SSE 前置校验）。
 *
 * <p>任务生命周期写入由队列路径负责（GenerationJobCommandService / GenerationWorker /
 * GenerationResultAcceptanceService）。
 */
@Service
@RequiredArgsConstructor
public class GenerationJobService {

    private final GenerationJobMapper jobMapper;
    private final AssetMapper assetMapper;
    private final ProjectService projectService;
    private final CostReservationService costReservationService;

    /** 查询任务状态，供前端轮询。 */
    public JobStatusResponse getJobStatus(Long jobId, Long userId) {
        GenerationJob job = jobMapper.selectById(jobId);
        if (job == null || !java.util.Objects.equals(job.getUserId(), userId)) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        projectService.requireOwned(job.getProjectId(), userId);
        JobStatusResponse.AssetDto assetDto = null;
        if (GenerationJob.STATUS_SUCCEEDED.equals(job.getStatus())
                && job.getOutputAssetIds() != null && !job.getOutputAssetIds().isEmpty()) {
            Asset asset = assetMapper.selectById(job.getOutputAssetIds().get(0));
            if (asset != null) {
                assetDto = new JobStatusResponse.AssetDto(asset.getId(), asset.getUrl(), asset.getType());
            }
        }
        Map<String, Object> publicError = null;
        if (GenerationJob.STATUS_FAILED.equals(job.getStatus())) {
            Map<String, Object> storedError = job.getError() == null ? Map.of() : job.getError();
            publicError = GenerationPublicError.project(
                    storedError,
                    job.getType(),
                    costReservationService.budgetEffect(job.getId()).wireValue());
        }
        return new JobStatusResponse(
                job.getId(), job.getStatus(), job.getProgress(), assetDto, publicError);
    }

    /**
     * 任务列表（生成流页）：按 {@code userId} + {@code type/status/projectId} 过滤，分页，按创建时间倒序。
     * 产出资源（outputAssets）一次性按 outputAssetIds 批量查 assets 补 url，避免 N+1。
     */
    public Page<JobListItemResponse> listJobs(Long userId, String type, String status, Long projectId, int page, int size) {
        Page<GenerationJob> jobPage = jobMapper.selectPage(new Page<>(page, size),
                Wrappers.<GenerationJob>lambdaQuery()
                        .eq(GenerationJob::getUserId, userId)
                        .eq(type != null && !type.isBlank(), GenerationJob::getType, type)
                        .eq(status != null && !status.isBlank(), GenerationJob::getStatus, status)
                        .eq(projectId != null, GenerationJob::getProjectId, projectId)
                        .orderByDesc(GenerationJob::getGmtCreate));

        List<Long> assetIds = jobPage.getRecords().stream()
                .filter(j -> j.getOutputAssetIds() != null)
                .flatMap(j -> j.getOutputAssetIds().stream())
                .distinct()
                .toList();
        Map<Long, Asset> assetMap = new HashMap<>();
        if (!assetIds.isEmpty()) {
            for (Asset a : assetMapper.selectBatchIds(assetIds)) {
                assetMap.put(a.getId(), a);
            }
        }

        List<JobListItemResponse> items = jobPage.getRecords().stream()
                .map(j -> new JobListItemResponse(j.getId(), j.getType(), j.getStatus(), j.getProgress(),
                        j.getInput(), j.getGmtCreate(), resolveOutputAssets(j, assetMap)))
                .toList();

        Page<JobListItemResponse> result = new Page<>(jobPage.getCurrent(), jobPage.getSize(), jobPage.getTotal());
        result.setRecords(items);
        return result;
    }

    private List<JobListItemResponse.OutputAsset> resolveOutputAssets(GenerationJob job, Map<Long, Asset> assetMap) {
        if (job.getOutputAssetIds() == null) {
            return List.of();
        }
        return job.getOutputAssetIds().stream()
                .map(assetMap::get)
                .filter(a -> a != null)
                .map(a -> new JobListItemResponse.OutputAsset(a.getId(), a.getUrl(), a.getType(), a.getWidth(), a.getHeight()))
                .toList();
    }

}
