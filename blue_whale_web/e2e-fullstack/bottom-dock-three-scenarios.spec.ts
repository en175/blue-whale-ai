/**
 * BottomDock 三场景全栈验收（IK2BDN T6.3）
 *
 * 最高层验收接缝：真实 BottomDock 控件 → 实际 Project GenerationJob HTTP 端点
 * （经 Web rewrite → Gateway → Agent Service，含真实 JWT 认证）→ 持久化 Job 输入/输出槽位
 * → 治理事实链（ContentReview/CostReservation/AuditRecord/ProjectEvent/ProviderTask）。
 * 不模拟生成接口、不以 React state 或工作区源码代替运行态行为。
 *
 * 场景：① 四输出组图（1:1/2K/数量4）② 私有参考图鉴权预览与提交 ③ 联网搜索开/关；
 * 横切：构建身份 == checkout revision、幂等重放与页面恢复无重复事实、
 * 重试只处理失败槽位、缺 model_id fail-closed 负向回归。
 *
 * 治理事实（content_reviews/cost_reservations/audit_records/generation_provider_tasks）
 * 没有 HTTP 查询出口，经 _fixtures/acceptance-db.ts 只读直连验收栈 MySQL，
 * SQL 口径与 BottomDockGenerationJobIT/LocalFakeGenerationIT 完全一致。
 *
 * 由 scripts/run-mvp-acceptance.sh 驱动（隔离 Compose 全栈 bw-mvp-acceptance，Fake Provider）。
 * 串行 describe：场景二的参考 Asset 来自场景一的产物，重试/负向依赖前面 Job 全部终态。
 */
import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  bearerClient,
  createProject,
  fetchSnapshot,
  loginViaApi,
  seedSession,
  type FullstackSession,
} from "./_fixtures/fullstack-auth";
import {
  queryAcceptanceDb,
  queryAcceptanceDbCount,
} from "./_fixtures/acceptance-db";
import {
  closeImageSettings,
  openImageDock,
  pickReferenceFromCanvas,
  selectAspectRatio,
  selectQuantity,
  selectSize,
  SETTINGS_TRIGGER,
  setWebSearch,
  submitImageCommand,
  type ImageCommandCapture,
} from "./_fixtures/bottom-dock";

/** Job 详情（GET /api/projects/{pid}/generation-jobs/{jobId}）的持久化输入。 */
interface PersistedJobInput {
  prompt?: string;
  aspect_ratio?: string;
  model_id?: string;
  size?: string;
  web_search?: boolean;
  reference_asset_ids?: number[];
  expected_output_count?: number;
}

interface CapabilityModel {
  model_id: string;
  model_label: string;
  supported_sizes: Array<{ id: string; label: string }>;
  features: { quantity_max: number; tools: boolean };
}

const GENERATION_NODE = '.react-flow__node[data-id^="generation-job-"]';

/** 成功 Job 的治理事实链：SQL 口径与 BottomDockGenerationJobIT 一致。 */
function assertGovernanceChain(jobId: number, slotCount: number): void {
  // 内容审核：每个输出槽位 decided + pass
  const reviews = queryAcceptanceDb(
    `SELECT review_state, decision FROM content_reviews ` +
      `WHERE subject_id LIKE 'generation-job:${jobId}:slot:%'`,
  );
  expect(reviews, `Job ${jobId} 应有 ${slotCount} 条内容审核`).toHaveLength(
    slotCount,
  );
  for (const [state, decision] of reviews) {
    expect(`${state}:${decision}`).toBe("decided:pass");
  }

  // 成本预留：唯一行且已结算
  const reservations = queryAcceptanceDb(
    `SELECT status FROM cost_reservations WHERE generation_job_id = ${jobId}`,
  );
  expect(reservations.map((row) => row[0])).toEqual(["SETTLED"]);

  // 关键审计动作（按 correlation_id 关联，与后端 IT 同口径）
  const actions = queryAcceptanceDb(
    `SELECT DISTINCT action FROM audit_records ` +
      `WHERE correlation_id = 'generation-job:${jobId}'`,
  ).flat();
  for (const action of [
    "cost_reservation.create",
    "cost_reservation.provider_admission",
    "generation_provider.call_outcome",
    "content_review.decision",
    "cost_reservation.settle",
  ]) {
    expect(actions, `缺少审计动作 ${action}`).toContain(action);
  }

  // Provider 付费调用：恰好每槽位一次，无额外调用
  const providerSlots = queryAcceptanceDb(
    `SELECT slot_index FROM generation_provider_tasks ` +
      `WHERE generation_job_id = ${jobId} ORDER BY slot_index`,
  )
    .flat()
    .map(Number);
  expect(providerSlots, "Provider 调用必须恰好对应输出槽位").toEqual(
    Array.from({ length: slotCount }, (_, index) => index),
  );

  // Project events：asset.created 与 generation_job.output_attached 每槽位各一条
  const attachedEvents = queryAcceptanceDbCount(
    `SELECT COUNT(*) FROM project_events ` +
      `WHERE event_type = 'generation_job.output_attached' ` +
      `AND aggregate_id LIKE '${jobId}:%'`,
  );
  expect(attachedEvents).toBe(slotCount);
  const assetCreatedEvents = queryAcceptanceDbCount(
    `SELECT COUNT(*) FROM project_events WHERE event_type = 'asset.created' ` +
      `AND JSON_EXTRACT(payload, '$.generation_job_id') = ${jobId}`,
  );
  expect(assetCreatedEvents).toBe(slotCount);
}

/** Job 的 Provider 调用槽位数（无重复付费调用断言用）。 */
function providerCallCount(jobId: number): number {
  return queryAcceptanceDbCount(
    `SELECT COUNT(*) FROM generation_provider_tasks WHERE generation_job_id = ${jobId}`,
  );
}

/** 四张治理/事实表的全局计数快照（负向回归「拒绝后不产生任何持久化事实」断言用）。 */
function globalFactCounts(): {
  jobs: number;
  reservations: number;
  providerTasks: number;
  events: number;
} {
  return {
    jobs: queryAcceptanceDbCount(`SELECT COUNT(*) FROM generation_jobs`),
    reservations: queryAcceptanceDbCount(
      `SELECT COUNT(*) FROM cost_reservations`,
    ),
    providerTasks: queryAcceptanceDbCount(
      `SELECT COUNT(*) FROM generation_provider_tasks`,
    ),
    events: queryAcceptanceDbCount(`SELECT COUNT(*) FROM project_events`),
  };
}

async function fetchJobDetail(
  api: APIRequestContext,
  projectId: number,
  jobId: number,
): Promise<{ status: string; input: PersistedJobInput }> {
  const res = await api.get(
    `/api/projects/${projectId}/generation-jobs/${jobId}`,
  );
  if (!res.ok()) {
    throw new Error(`Job 详情获取失败：${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    data: { status: string; input: PersistedJobInput };
  };
  return body.data;
}

/** 轮询 Snapshot 直到 Job 到达目标状态，返回该 Job 的快照投影。 */
async function waitJobStatus(
  api: APIRequestContext,
  projectId: number,
  jobId: number,
  status: string,
  timeout = 180_000,
) {
  let found:
    | Awaited<ReturnType<typeof fetchSnapshot>>["generation_jobs"][number]
    | undefined;
  await expect
    .poll(
      async () => {
        const snap = await fetchSnapshot(api, projectId);
        found = snap.generation_jobs.find(
          (job) => String(job.job_id) === String(jobId),
        );
        return found?.status;
      },
      { timeout, message: `等待 Job ${jobId} 到达 ${status}` },
    )
    .toBe(status);
  return found!;
}

test.describe.serial("BottomDock 三场景全栈验收（IK2BDN T6.3）", () => {
  const baseURL = process.env.BW_ACCEPTANCE_BASE_URL ?? "http://localhost:3100";
  let session: FullstackSession;
  let api: APIRequestContext;
  let projectId: number;
  let capabilityModel: CapabilityModel;

  // 场景间共享事实（串行依赖）
  let scenarioOne: ImageCommandCapture;
  let scenarioOneAssetIds: number[] = [];

  test.beforeAll(async () => {
    session = await loginViaApi(baseURL);
    api = await bearerClient(baseURL, session);
    // 串行套件共享验收库：本套件使用私有 Project，与其他 spec 的 Job/Asset/节点隔离
    projectId = await createProject(api, `T63 三场景验收 ${Date.now()}`);
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    // App 首次挂载会旋转 refresh_token（旧 RT 随即作废）：每个测试用全新登录态播种，
    // 避免上一页旋转后本页种子失效弹出登录框
    const pageSession = await loginViaApi(baseURL);
    await seedSession(page, pageSession);
    await page.goto(`/canvas?project=${projectId}`);
  });

  test("运行制品构建身份等于本轮 checkout revision", async ({ page }) => {
    const res = await page.request.get(`${baseURL}/build-info`);
    expect(res.ok()).toBeTruthy();
    const info = (await res.json()) as {
      git_commit: string;
      build_time: string;
    };
    expect(info.git_commit, "git_commit 不能是 unknown").not.toBe("unknown");
    expect(info.git_commit.trim()).not.toBe("");
    expect(info.build_time, "build_time 不能是 unknown").not.toBe("unknown");
    expect(info.build_time.trim()).not.toBe("");
    // 强断言：运行制品 revision == 本轮 checkout revision（run-mvp-acceptance.sh 导出 GIT_COMMIT）
    const checkoutRevision = (
      process.env.GIT_COMMIT ??
      execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        encoding: "utf-8",
      }).trim()
    ).trim();
    expect(info.git_commit).toBe(checkoutRevision);
  });

  test("场景一：四输出组图的 UI/payload/持久化输入一致性与治理事实链", async ({
    page,
  }) => {
    // 能力表唯一权威：支持 1:1、2K、数量 4 的图片模型
    const modelsRes = await api.get("/api/generation/models?capability=image");
    const models = ((await modelsRes.json()) as { data: CapabilityModel[] })
      .data;
    capabilityModel = models.find(
      (model) =>
        model.supported_sizes.some((size) => size.id === "2k") &&
        model.features.quantity_max >= 4,
    )!;
    expect(
      capabilityModel,
      "能力表必须有支持 2K 与数量 4 的图片模型",
    ).toBeTruthy();

    await openImageDock(page);

    await test.step("UI 选择：模型 / 1:1 / 2K / 数量 4", async () => {
      await selectAspectRatio(page, "1:1");
      await selectSize(page, "2K");
      await closeImageSettings(page);
      await selectQuantity(page, "4x");
      // UI 可见选择与能力表一致（防止控件只改显示）
      const trigger = page.getByRole("button", { name: SETTINGS_TRIGGER });
      await expect(trigger).toContainText(capabilityModel.model_label);
      await expect(trigger).toContainText("1:1");
      await expect(trigger).toContainText("2K");
      await expect(
        page.getByRole("button", { name: "生成数量" }),
      ).toContainText("4x");
    });

    const prompt = `蓝鲸四图 T63S1-${Date.now()}`;
    scenarioOne = await submitImageCommand(page, prompt);

    await test.step("HTTP payload 与 UI 选择一致", async () => {
      expect(scenarioOne.payload.type).toBe("image");
      expect(scenarioOne.payload.input_asset_ids).toEqual([]);
      expect(scenarioOne.payload.expected_output_count).toBe(4);
      expect(scenarioOne.payload.parameters.model_id).toBe(
        capabilityModel.model_id,
      );
      expect(scenarioOne.payload.parameters.aspect_ratio).toBe("1:1");
      expect(scenarioOne.payload.parameters.size).toBe("2k");
      expect(scenarioOne.payload.parameters.web_search).toBe(false);
      expect(scenarioOne.payload.parameters.prompt).toContain("T63S1");
      expect(scenarioOne.jobId).toBeGreaterThan(0);
      expect(scenarioOne.idempotencyKey).not.toBe("");
    });

    await test.step("持久化 Job 输入与 payload 一致，四个输出槽位各绑定可访问 Asset", async () => {
      const job = await waitJobStatus(
        api,
        projectId,
        scenarioOne.jobId,
        "succeeded",
      );
      expect(job.outputs).toHaveLength(4);
      scenarioOneAssetIds = [];
      for (const [index, output] of job.outputs!.entries()) {
        expect(output.slot_index).toBe(index);
        expect(output.status).toBe("succeeded");
        expect(output.asset_id, `槽位 ${index} 必须绑定 Asset`).toBeTruthy();
        scenarioOneAssetIds.push(Number(output.asset_id));
      }
      // 每个 Asset 都能以登录身份读取内容
      for (const assetId of scenarioOneAssetIds) {
        const content = await api.get(
          `/api/projects/${projectId}/assets/${assetId}/content`,
        );
        expect(content.ok(), `Asset ${assetId} 内容必须可访问`).toBeTruthy();
      }

      const detail = await fetchJobDetail(api, projectId, scenarioOne.jobId);
      expect(detail.input.model_id).toBe(capabilityModel.model_id);
      expect(detail.input.aspect_ratio).toBe("1:1");
      expect(detail.input.size).toBe("2k");
      expect(detail.input.web_search).toBe(false);
      expect(detail.input.expected_output_count).toBe(4);
    });

    await test.step("治理事实链完整，Provider 调用恰好四次", async () => {
      assertGovernanceChain(scenarioOne.jobId, 4);
    });
  });

  test("场景二：私有参考图鉴权预览与提交（input_asset_ids 只含所选 Asset）", async ({
    page,
  }) => {
    // 参考素材来自场景一的真实产物（纯 HTTP 闭环准备，不直插 DB）。
    // 四个恢复节点按 48+i*32 级联排布互相覆盖，slot-3 位于最顶层可点击（slot-0 被遮挡）。
    const referenceAssetId = scenarioOneAssetIds[3];
    expect(referenceAssetId, "场景一必须产出参考 Asset").toBeTruthy();

    // 画布节点由 Snapshot 恢复（含鉴权出图），等待其 blob: 渲染完成
    const nodeSelector = `.react-flow__node[data-id="generation-job-${scenarioOne.jobId}-slot-3"] img`;
    await expect(page.locator(nodeSelector)).toHaveAttribute("src", /^blob:/, {
      timeout: 30_000,
    });

    await openImageDock(page);
    await pickReferenceFromCanvas(page, nodeSelector);

    const prompt = `参考图二创 T63S2-${Date.now()}`;
    const capture = await submitImageCommand(page, prompt);

    expect(capture.payload.input_asset_ids).toEqual([referenceAssetId]);
    expect(capture.payload.expected_output_count).toBe(1);

    await waitJobStatus(api, projectId, capture.jobId, "succeeded");
    const detail = await fetchJobDetail(api, projectId, capture.jobId);
    expect(detail.input.reference_asset_ids).toEqual([referenceAssetId]);
    expect(detail.input.expected_output_count).toBe(1);

    assertGovernanceChain(capture.jobId, 1);
  });

  test("场景三：联网搜索开/关的 payload 与持久化输入一致", async ({ page }) => {
    expect(
      capabilityModel.features.tools,
      "能力表模型必须支持联网搜索",
    ).toBeTruthy();

    await openImageDock(page);

    const onCapture = await test.step("开关打开：web_search=true", async () => {
      await setWebSearch(page, true);
      await closeImageSettings(page);
      return submitImageCommand(page, `联网搜索开 T63S3-${Date.now()}`);
    });
    expect(onCapture.payload.parameters.web_search).toBe(true);
    await waitJobStatus(api, projectId, onCapture.jobId, "succeeded");
    const onDetail = await fetchJobDetail(api, projectId, onCapture.jobId);
    expect(onDetail.input.web_search).toBe(true);
    assertGovernanceChain(onCapture.jobId, 1);

    const offCapture =
      await test.step("开关关闭：web_search=false", async () => {
        await setWebSearch(page, false);
        await closeImageSettings(page);
        return submitImageCommand(page, `联网搜索关 T63S3-${Date.now()}`);
      });
    expect(offCapture.payload.parameters.web_search).toBe(false);
    await waitJobStatus(api, projectId, offCapture.jobId, "succeeded");
    const offDetail = await fetchJobDetail(api, projectId, offCapture.jobId);
    expect(offDetail.input.web_search).toBe(false);
    assertGovernanceChain(offCapture.jobId, 1);
  });

  test("幂等重放与页面恢复不产生重复 Job、重复节点或重复 Provider 调用", async ({
    page,
  }) => {
    await test.step("相同幂等命令重放：返回首次接纳结果，不创建第二个原始 Job", async () => {
      const replay = await api.post(
        `/api/projects/${projectId}/generation-jobs`,
        {
          headers: { "Idempotency-Key": scenarioOne.idempotencyKey },
          data: scenarioOne.payload,
        },
      );
      expect(replay.ok()).toBeTruthy();
      const replayBody = (await replay.json()) as {
        data: { generation_job_id: number };
      };
      expect(replayBody.data.generation_job_id).toBe(scenarioOne.jobId);
      // 幂等接纳记录唯一、原始 Job 唯一、Provider 调用不增加
      expect(
        queryAcceptanceDbCount(
          `SELECT COUNT(*) FROM command_idempotency ` +
            `WHERE idempotency_key = '${scenarioOne.idempotencyKey}'`,
        ),
      ).toBe(1);
      expect(
        queryAcceptanceDbCount(
          `SELECT COUNT(*) FROM generation_jobs ` +
            `WHERE JSON_EXTRACT(input, '$.prompt') LIKE '%T63S1%'`,
        ),
      ).toBe(1);
      expect(providerCallCount(scenarioOne.jobId)).toBe(4);
    });

    await test.step("刷新页面从 Project 状态恢复：节点不重复、Provider 事实不变", async () => {
      await page.reload();
      // Snapshot 恢复场景一的四个输出节点，不重复
      await expect(
        page.locator(
          `.react-flow__node[data-id^="generation-job-${scenarioOne.jobId}-slot-"]`,
        ),
      ).toHaveCount(4, { timeout: 30_000 });
      await expect(page.locator(GENERATION_NODE)).not.toHaveCount(0);
      expect(providerCallCount(scenarioOne.jobId)).toBe(4);
    });
  });

  test("重试只处理失败槽位：原 Job 终态与成功输出不被改写，无重复付费调用", async () => {
    // fake:failure 为确定性指令（须精确匹配 prompt）：原始失败、关联重试成功
    const create = await api.post(
      `/api/projects/${projectId}/generation-jobs`,
      {
        headers: { "Idempotency-Key": `t63-retry-origin-${Date.now()}` },
        data: {
          type: "image",
          input_asset_ids: [],
          expected_output_count: 1,
          parameters: {
            prompt: "fake:failure",
            aspect_ratio: "1:1",
            model_id: capabilityModel.model_id,
            size: "2k",
            web_search: false,
          },
        },
      },
    );
    expect(create.status()).toBe(202);
    const originJobId = Number(
      ((await create.json()) as { data: { generation_job_id: number } }).data
        .generation_job_id,
    );

    const originJob = await waitJobStatus(
      api,
      projectId,
      originJobId,
      "failed",
    );
    expect(originJob.outputs).toHaveLength(1);
    expect(originJob.outputs![0].status).toBe("failed");
    expect(originJob.outputs![0].asset_id ?? null).toBeNull();

    await test.step("重试创建带重试关系的新 Job，只重建失败槽位", async () => {
      const retry = await api.post(
        `/api/projects/${projectId}/generation-jobs/${originJobId}/retry`,
        { headers: { "Idempotency-Key": `t63-retry-${Date.now()}` } },
      );
      expect(retry.status()).toBe(202);
      const retryJobId = Number(
        ((await retry.json()) as { data: { generation_job_id: number } }).data
          .generation_job_id,
      );
      expect(retryJobId).not.toBe(originJobId);

      const retryJob = await waitJobStatus(
        api,
        projectId,
        retryJobId,
        "succeeded",
      );
      expect(String(retryJob.retry_of_job_id)).toBe(String(originJobId));
      expect(retryJob.outputs).toHaveLength(1);
      expect(retryJob.outputs![0].slot_index).toBe(0);
      expect(retryJob.outputs![0].status).toBe("succeeded");

      // 原 Job 终态与失败事实不被改写；两侧 Provider 调用各一次，无重复付费
      const originAfter = await waitJobStatus(
        api,
        projectId,
        originJobId,
        "failed",
      );
      expect(originAfter.outputs![0].asset_id ?? null).toBeNull();
      expect(providerCallCount(originJobId)).toBe(1);
      expect(providerCallCount(retryJobId)).toBe(1);

      assertGovernanceChain(retryJobId, 1);
    });
  });

  test("负向回归：缺少 model_id 返回稳定参数错误且不产生任何持久化事实", async () => {
    const marker = `t63-negative-${Date.now()}`;
    // 串行套件此前所有 Job 均已终态，全局计数在拒绝前后必须不变
    const countsBefore = globalFactCounts();

    const res = await api.post(`/api/projects/${projectId}/generation-jobs`, {
      headers: { "Idempotency-Key": `t63-negative-${Date.now()}` },
      data: {
        type: "image",
        input_asset_ids: [],
        expected_output_count: 1,
        parameters: { prompt: marker, aspect_ratio: "1:1" },
      },
    });
    expect(res.status()).toBe(400);
    const bodyText = await res.text();
    expect(bodyText).toContain("VALIDATION_FAILED");
    expect(bodyText).toContain("生成参数不在服务端能力范围内");

    expect(globalFactCounts()).toEqual(countsBefore);
  });
});
