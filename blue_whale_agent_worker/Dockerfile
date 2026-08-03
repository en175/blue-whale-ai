# Python Agent Worker（Fake / Pydantic-AI orchestrator）
#
# 标准 src 布局：包源文件在 src/blue_whale_agent_worker/，
# setup.cfg 用 `package_dir = = src` + `packages.find where = src` 解析。

FROM python:3.11-slim AS builder
WORKDIR /build
# 只 COPY 打包元数据 + 包源目录（tests / .venv 等本来就不进入安装产物）
COPY pyproject.toml setup.cfg ./
COPY src/ src/
# 安装到 /install 便于多阶段复制
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir --prefix=/install .

FROM python:3.11-slim
WORKDIR /app
# 复制 builder 阶段安装好的 site-packages 与入口脚本
COPY --from=builder /install /usr/local
# Worker 本身只暴露内部 HTTP 出站调用，无对外端口
# CMD 由 Compose entrypoint 注入循环脚本（原 deploy/local 脚本已随 Java 退役删除）
CMD ["python", "-m", "blue_whale_agent_worker", "--help"]
