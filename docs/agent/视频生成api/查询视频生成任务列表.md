`DELETE https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}` [运行](https://api.volcengine.com/api-explorer/?action=DeleteContentsGenerationsTasks&data=%7B%22id%22%3A%22cgt-20250331175019-68d9t%22%7D&groupName=%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90API&query=%7B%7D&serviceCode=ark&version=2024-01-01)

取消排队中的视频生成任务，或者删除视频生成任务记录。

<span id="5w4RMn7i"></span>
## 鉴权

本接口支持 API Key 鉴权，详见[鉴权认证方式](https://www.volcengine.com/docs/82379/1298459)。

<span id="RxN8G2nH"></span>
## 请求参数

> 跳转 [响应参数](https://www.volcengine.com/docs/82379/1521720#7mi8G8RI)


<span id="2uOPJhak"></span>
### Path 参数


---



**id** `string` `必选`

需要取消或者删除的视频生成任务。

任务状态不同，调用`DELETE`接口，执行的操作有所不同，具体说明如下：


|当前任务状态 |是否支持DELETE操作 |操作含义 |DELETE操作后任务状态 |
|---|---|---|---|
|queued |是 |任务取消排队，任务状态被变更为cancelled。 |cancelled |
|running |否 |\- |\- |
|succeeded |是 |删除视频生成任务记录，后续将不支持查询。 |\- |
|failed |是 |删除视频生成任务记录，后续将不支持查询。 |\- |
|cancelled |否 |\- |\- |
|expired |是 |删除视频生成任务记录，后续将不支持查询。 |\- |



---



<span id="7mi8G8RI"></span>
## 响应参数

> 跳转 [请求参数](https://www.volcengine.com/docs/82379/1521720#RxN8G2nH)


本接口无返回参数。



