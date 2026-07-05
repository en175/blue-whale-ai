from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    """健康检查端点，供前端探活与部署健康检查使用。"""
    return {"status": "ok"}
