/**
 * 这个可部署单元报出去的服务名（IKB29O）。
 *
 * 单独一个模块、并且在 main.ts 里第一个被 import：ESM 按 import 顺序求值，各服务模块顶层的
 * `createLogger(...)` 因此都排在这句之后。写在 main.ts 的函数体里就晚了——那时模块顶层的代码
 * 早已跑完，期间写出的任何一行都会顶着主 API 的名字。
 *
 * 它是一个常量，不是环境变量。服务名是代码的事实；做成 `CONTAINER_NAME` 的那一版，忘配一次
 * 就是同一个容器里每个模块自报一个不同的服务名，而且没有任何一处会红。
 */
import { setLogServiceName } from "@blue-whale/core/logging";

setLogServiceName("blue-whale-generation-worker");
