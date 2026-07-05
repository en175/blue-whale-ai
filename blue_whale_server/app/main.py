from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router

app = FastAPI(
    title="Blue Whale API",
    description="Blue-Whale AI Canvas 后端服务",
    version="0.1.0",
)

# 前端 blue_whale_web 默认运行在 http://localhost:3000。
# 部署或局域网联调时（前端 dev:lan），按需追加允许的来源。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, tags=["health"])
