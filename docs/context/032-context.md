# 032-context — 打包给团队后首页提交无法跳转画布 / WebSocket HMR 报错

## 问题现象
将项目文件打包给团队后，他们在首页点击「提交」无法跳转到 `/canvas` 页面，浏览器控制台报错：

```
web-socket.ts:50 WebSocket connection to 'ws://192.168.55.129:3000/_next/webpack-hmr?id=...' failed
```

## 根因
`_next/webpack-hmr` 是 Next.js 开发模式（`next dev`）的**热模块替换（HMR）WebSocket**。当团队通过局域网 IP（如 `192.168.55.129:3000`）访问由 `npm run dev` 启动的服务时，HMR 客户端会尝试连接该 IP 上的 WebSocket 端口。如果 dev server 没有绑定到 `0.0.0.0`，或者内网存在防火墙/代理拦截 WebSocket，连接就会失败，导致页面行为异常。

**简言之：团队不应该用 `npm run dev` 来分发和运行项目。**

## 解决方案

### 推荐方式：使用生产构建（正式环境）

1. 在打包前或团队拿到项目后执行构建：

   ```bash
   npm install
   npm run build
   ```

2. 构建完成后，用生产模式启动：

   ```bash
   npm start
   ```

3. 团队成员访问对应机器的 IP:3000 即可。

   - 生产模式没有 HMR WebSocket，因此不会出现该报错。
   - 首页点击提交后跳转到 `/canvas` 不再受 WebSocket 影响。

### 如需在局域网内用 dev 模式调试

如果团队确实需要开发模式联调，使用新增的 `dev:lan` 脚本，让 dev server 监听 `0.0.0.0`：

```bash
npm run dev:lan
```

或生产模式监听所有网卡：

```bash
npm run start:lan
```

## 改动

- `package.json`：新增两个脚本
  - `dev:lan`: `next dev -H 0.0.0.0`
  - `start:lan`: `next start -H 0.0.0.0`

## 关键文件

- `package.json`

## 备注

- `next start` 默认已监听 `0.0.0.0`，但显式加上 `-H 0.0.0.0` 更稳妥。
- 若团队那边仍有防火墙问题，生产模式（`npm start`）是最可靠的方案。
- 建议团队拿到的不是源码 zip，而是先构建好的 `.next` 产物 + `package.json` + `node_modules`，运行 `npm start` 即可。
