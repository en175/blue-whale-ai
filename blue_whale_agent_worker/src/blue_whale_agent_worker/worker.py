from .contracts import OrchestratorPort, RunGateway


class AgentWorker:
    def __init__(self, gateway: RunGateway, orchestrator: OrchestratorPort) -> None:
        self._gateway = gateway
        self._orchestrator = orchestrator

    def run_once(self) -> None:
        work = self._gateway.claim()
        proposal = self._orchestrator.advance(work)
        self._gateway.commit(
            work.agent_run_id,
            proposal.to_commit_payload(work),
        )
