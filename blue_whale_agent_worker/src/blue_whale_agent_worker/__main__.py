import argparse
import os

from .adapters import create_orchestrator
from .http_gateway import JavaRunGateway
from .worker import AgentWorker


def main() -> None:
    parser = argparse.ArgumentParser(description="推进一个 Blue-Whale AgentRun")
    parser.add_argument("--adapter", choices=("fake", "pydantic-ai"), required=True)
    parser.add_argument("--model", default=os.getenv("BLUE_WHALE_LLM_MODEL"))
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--worker-id", required=True)
    args = parser.parse_args()

    gateway = JavaRunGateway(args.base_url, args.worker_id, args.adapter)
    orchestrator = create_orchestrator(args.adapter, args.model, gateway)
    AgentWorker(gateway, orchestrator).run_once()


if __name__ == "__main__":
    main()
