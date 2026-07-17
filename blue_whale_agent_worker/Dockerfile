# Python Agent Worker（Fake / Pydantic-AI orchestrator）
#
# 注意包布局：setup.cfg 用 `package_dir = blue_whale_agent_worker = .`，
# 即包源文件直接在仓库根（__init__.py / worker.py 等），没有 blue_whale_agent_worker/ 子目录。
# 因此 Dockerfile 直接 COPY 整个上下文到 /app，由 pip install . 解析。

FROM python:3.11-slim AS builder
WORKDIR /build
# 只 COPY 打包元数据 + 源文件（.dockerignore 已排除 tests / __pycache__）
COPY pyproject.toml setup.cfg ./
COPY __init__.py __main__.py adapters.py contracts.py fake_orchestrator.py http_gateway.py pydantic_orchestrator.py worker.py ./
# 安装到 /install 便于多阶段复制
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir --prefix=/install .

FROM python:3.11-slim
WORKDIR /app
# 复制 builder 阶段安装好的 site-packages 与入口脚本
COPY --from=builder /install /usr/local
# Worker 本身只暴露内部 HTTP 出站调用，无对外端口
# CMD 由 Compose entrypoint 注入循环脚本（见 deploy/local/scripts/run-worker-loop.sh）
CMD ["python", "-m", "blue_whale_agent_worker", "--help"]
