import argparse

from .fake_orchestrator import FakeOrchestrator
from .http_gateway import JavaRunGateway
from .worker import AgentWorker


def main() -> None:
    parser = argparse.ArgumentParser(description="推进一个 Blue-Whale AgentRun")
    parser.add_argument("--adapter", choices=("fake",), required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--worker-id", required=True)
    args = parser.parse_args()

    gateway = JavaRunGateway(args.base_url, args.worker_id, args.adapter)
    if args.adapter == "fake":
        AgentWorker(gateway, FakeOrchestrator()).run_once()


if __name__ == "__main__":
    main()
