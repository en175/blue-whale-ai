# Blue Whale Server

Blue-Whale AI Canvas 的后端服务（FastAPI / Python）。

与前端 [`blue_whale_web`](../blue_whale_web) 对应。当前为最小可运行骨架，后续按业务逐步对接图片/视频生成、积分、审核等能力。

## 环境要求

- Python 3.10+

## 安装

```bash
cd blue_whale_server
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
```

## 运行

```bash
uvicorn app.main:app --reload
```

默认监听 http://localhost:8000，API 文档见 http://localhost:8000/docs。

## 测试

```bash
pytest
```

## 目录结构

```
blue_whale_server/
├── app/
│   ├── main.py          # FastAPI 应用入口（含 CORS 中间件）
│   └── api/
│       └── health.py    # /health 健康检查
├── tests/
│   └── test_health.py
├── requirements.txt      # 运行时依赖
└── requirements-dev.txt  # 运行时 + 开发/测试依赖
```

## 与前端联调

CORS 已允许 `http://localhost:3000`（前端默认端口）。前端用 `dev:lan` 局域网调试时，需在 `app/main.py` 的 `allow_origins` 中追加对应来源。
