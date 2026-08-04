# Seedance 上游真人脸验证结论：报错即官方满血版证据

> 核验日期：2026-08-04
> 工单：IK6FB1「使用真人人脸做参考生成视频，验证上游 API 是否为 seedance2.0 满血版」
> 范围：解读真人脸参考图生成失败的报错，判断上游链路真实性。未发起新的付费请求。

## 结论

1. **上游链路为真实火山方舟 Seedance 2.0 官方通道。本次失败不是「上游不是满血版」
   的证据，恰恰是满血版的证据。** 报错内层的
   `InputImageSensitiveContentDetected.PrivacyInformation` 是火山方舟官方内容审核
   错误码（见[方舟错误码文档](https://www.volcengine.com/docs/82379/1099476)），
   只有请求真正进入火山方舟的输入审核层才会返回。降级模型或伪造中转不会返回
   火山专属错误码。
2. **「真人脸参考生成成功」在满血版上必然失败。** 火山方舟官方明确：Seedance 2.0
   不接受任意直接上传的真人人脸参考图/视频。所以本工单设计的验收方式（真人脸
   生成成功 = 满血版）方向反了——满血版的正确行为就是拒绝。依据：本仓
   [`2026-07-29-seedance-video-reference-inputs.md`](2026-07-29-seedance-video-reference-inputs.md)
   §2.1（来源为火山官方文档
   [创建视频生成任务 API](https://www.volcengine.com/docs/82379/1520757)、
   [录入真人形象素材](https://www.volcengine.com/docs/82379/2315856)）。
3. **报错链路解剖**：外层 `Failed to submit video generation job: Upstream submit
   failed (400)` 由部署的 NewAPI 网关产生；`{"code":"fail_to_fetch_task",...}`
   是 NewAPI 对上游任务类 400 的统一包装；最内层 JSON 是火山方舟原文透传。
   即：产品 → NewAPI 网关（`blue_whale_api` 同族）→ 火山方舟，模型
   `doubao-seedance-2-0-260128`（见
   `blue_whale_web/lib/generation/handle-create-generation-job.ts`）。

## 官方允许的真人形象输入路径

| 路径 | 说明 |
| --- | --- |
| 授权录入真人形象素材 | 走火山官方录入流程，产出 `asset://` ID 与授权状态 |
| 预置虚拟人像 | 火山提供的虚拟形象 |
| 本账号生成素材再输入 | 本账号近 30 天内由 Seedance 2.0 系列生成的含人脸视频可再次输入 |

来源：[录入真人形象素材](https://www.volcengine.com/docs/82379/2315856)、
[Seedance 2.0 安全说明](https://www.volcengine.com/activity/Seedance2-0-security)。

## 如需「正向」验证满血能力

改用满血版上必然成功的用例，任选其一：

1. 非真人素材多模态参考：1~9 张非真人参考图（如物品/动漫形象）+ 提示词，
   应成功提交并出片；
2. 首尾帧模式：2 张非真人图分别为 `first_frame`/`last_frame`；
3. 参考视频输入：任意无真人脸的 2~15 秒 MP4 作为 `reference_video`
   （只有 Seedance 2.0 系列支持视频输入，成功即证明是 2.0 而非 1.5/1.0）。

## 产品后续建议

- 前端错误文案应把 `InputImageSensitiveContentDetected` 翻译成用户可理解的话术
  （如「参考图包含真人人脸，官方模型不支持直接使用」），不透传英文 JSON；
- 若业务确需真人形象，走「授权录入真人形象素材」接入，另立工单。
