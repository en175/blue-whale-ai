# 测试音频夹具

`sine-440-1s.mp3`：1 秒 440Hz 正弦波，供 audio-mix 浏览器验收套件当「混合结果」的字节。

worker 侧只读取/转发这些字节、**不解析音频**（Java 跨端测试连 fallback 都是写死的假字节），
duration 等元数据由网关 mock 的 JSON 与数据库夹具提供，所以这里只要是确定的音频字节即可。

生成（一次性；参数与旧的 `ffmpeg-static` 调用逐字一致）：

```bash
ffmpeg -v error -f lavfi -i "sine=frequency=440:duration=1" \
  -codec:a libmp3lame -q:a 9 sine-440-1s.mp3
```

来历：这三个测试原先在 `beforeAll` 里用 `ffmpeg-static` 现场生成音频。
该 npm 依赖是退役 node worker 留下的孤儿（ADR-0103），2026-09-28 清理时改成检入夹具
—— 顺带去掉构建期从 GitHub 下二进制的失败点（`FFMPEG_BINARIES_URL` 那套创可贴一并摘除）。
