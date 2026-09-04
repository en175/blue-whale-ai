# 图片请求映射走目录 + 内置解析器，本期不改 Seedream

IKCUFZ：GPT / banana / Seedream 的 `size` 语义不同，网关透传会 400。映射放在本仓调用方，不放网关。
解析器内置在代码里，管理端只选择、不能新建渠道或编写 JSONPath。响应三家共用 `data[].url`。
请求：Seedream 维持现行 `seedream-image-size` 代码表（一个 `size`）；GPT 用能力行交叉格得到一个 `size`，
GPT 交叉格只能填官方 `size` 枚举（含 2K/4K 像素与 `auto`）；未填的组合前端不展示。
GPT 全量 `1K` 不提供 `16:9`（无真 16:9 的 1K 枚举）。Banana 一维映射不变。
管理端按能力类型分表单，不填 `provider_id`，消费端不返回调用值。

否决：上网关做字段转换；管理端可编程解析器；本期把 Seedream 迁进目录或换成另一套 1K 像素表。
