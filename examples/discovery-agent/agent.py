"""
Discovery Agent — an autonomous AI agent that discovers and evaluates
other agents in the Smart Agent trust fabric.

This agent runs inside a TEE (Trusted Execution Environment) to guarantee
that its evaluation logic cannot be tampered with and its private keys
remain sealed within the enclave.

Capabilities:
  - Discovers agents registered in the trust graph
  - Evaluates agent trust profiles (relationships, reviews, disputes)
  - Submits structured reviews via delegated execution
  - Reports findings to its operating organization

Runtime:
  - Designed for AWS Nitro Enclave (also compatible with Intel TDX via dstack)
  - Reads trust graph state via RPC
  - Signs transactions with TEE-bound keys
  - Exposes an A2A (Agent-to-Agent) endpoint for task requests
"""

import os
import json
import hashlib
import logging
from dataclasses import dataclass, asdict
from typing import Optional
from http.server import HTTPServer, BaseHTTPRequestHandler

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("discovery-agent")

# ─── Configuration ───────────────────────────────────────────────────

@dataclass
class AgentConfig:
    """Agent configuration loaded from environment."""
    agent_name: str = "Discovery Agent"
    agent_address: str = ""          # Smart account address (set by deployer)
    rpc_url: str = "http://127.0.0.1:8545"
    chain_id: int = 31337
    relationship_contract: str = ""
    review_contract: str = ""
    trust_profile_contract: str = ""
    delegation_manager: str = ""
    a2a_port: int = 8080
    evaluation_interval: int = 300   # seconds between evaluation cycles
    min_trust_score: int = 50        # minimum score to consider an agent trusted
    model: str = "gpt-4"            # LLM model for evaluation reasoning

    @classmethod
    def from_env(cls) -> "AgentConfig":
        return cls(
            agent_name=os.getenv("AGENT_NAME", "Discovery Agent"),
            agent_address=os.getenv("AGENT_ADDRESS", ""),
            rpc_url=os.getenv("RPC_URL", "http://127.0.0.1:8545"),
            chain_id=int(os.getenv("CHAIN_ID", "31337")),
            relationship_contract=os.getenv("AGENT_RELATIONSHIP_ADDRESS", ""),
            review_contract=os.getenv("AGENT_REVIEW_ADDRESS", ""),
            trust_profile_contract=os.getenv("AGENT_TRUST_PROFILE_ADDRESS", ""),
            delegation_manager=os.getenv("DELEGATION_MANAGER_ADDRESS", ""),
            a2a_port=int(os.getenv("A2A_PORT", "8080")),
            evaluation_interval=int(os.getenv("EVALUATION_INTERVAL", "300")),
            min_trust_score=int(os.getenv("MIN_TRUST_SCORE", "50")),
            model=os.getenv("MODEL", "gpt-4"),
        )


# ─── Trust Evaluation ───────────────────────────────────────────────

@dataclass
class TrustEvaluation:
    """Result of evaluating an agent's trust profile."""
    agent_address: str
    agent_name: str
    relationship_count: int
    review_count: int
    avg_review_score: float
    open_disputes: int
    has_tee_attestation: bool
    trust_score: int
    recommendation: str      # endorses, recommends, neutral, flags, disputes
    reasoning: str

    @property
    def is_trusted(self) -> bool:
        return self.trust_score >= 50


def evaluate_agent(agent_address: str, config: AgentConfig) -> TrustEvaluation:
    """
    Evaluate an agent's trustworthiness based on on-chain data.

    In production, this would:
    1. Query AgentRelationship for active edges
    2. Query AgentReviewRecord for review history
    3. Query AgentDisputeRecord for open disputes
    4. Query AgentValidationProfile for TEE attestations
    5. Use an LLM to synthesize a recommendation

    For this example, we simulate the evaluation.
    """
    logger.info(f"Evaluating agent {agent_address[:10]}...")

    # Simulated on-chain data (would be RPC calls in production)
    relationship_count = 5
    review_count = 3
    avg_score = 72.0
    open_disputes = 0
    has_tee = True

    # Compute trust score
    score = 0
    if relationship_count > 0:
        score += 25
    if relationship_count >= 3:
        score += 15
    if review_count >= 2:
        score += 15
    if avg_score >= 60:
        score += 25
    if open_disputes == 0:
        score += 20

    # Determine recommendation
    if score >= 80:
        recommendation = "endorses"
    elif score >= 60:
        recommendation = "recommends"
    elif score >= 40:
        recommendation = "neutral"
    elif score >= 20:
        recommendation = "flags"
    else:
        recommendation = "disputes"

    return TrustEvaluation(
        agent_address=agent_address,
        agent_name=f"Agent {agent_address[:8]}",
        relationship_count=relationship_count,
        review_count=review_count,
        avg_review_score=avg_score,
        open_disputes=open_disputes,
        has_tee_attestation=has_tee,
        trust_score=score,
        recommendation=recommendation,
        reasoning=f"Agent has {relationship_count} relationships, "
                  f"{review_count} reviews (avg {avg_score}), "
                  f"{open_disputes} disputes. "
                  f"{'TEE attested.' if has_tee else 'No TEE attestation.'}",
    )


# ─── A2A Endpoint ────────────────────────────────────────────────────

class A2AHandler(BaseHTTPRequestHandler):
    """
    Agent-to-Agent (A2A) HTTP endpoint.

    Accepts task requests from other agents or orchestrators.
    Follows the A2A standard for inter-agent communication.
    """

    config: AgentConfig  # set by the server

    def do_GET(self):
        """Health check and agent card."""
        if self.path == "/health":
            self._respond(200, {"status": "healthy", "agent": self.config.agent_name})
        elif self.path == "/.well-known/agent.json":
            self._respond(200, {
                "name": self.config.agent_name,
                "description": "Discovers and evaluates agents in the trust fabric",
                "capabilities": ["evaluate-trust", "submit-review", "discover-agents"],
                "tee": {
                    "architecture": "aws-nitro",
                    "attested": True,
                },
                "supportedTrust": ["reputation", "tee-attestation"],
                "a2a": {"version": "1.0"},
            })
        else:
            self._respond(404, {"error": "Not found"})

    def do_POST(self):
        """Handle task requests."""
        if self.path == "/tasks":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length)) if content_length > 0 else {}

            task_type = body.get("type", "")

            if task_type == "evaluate-trust":
                agent_addr = body.get("agentAddress", "")
                if not agent_addr:
                    self._respond(400, {"error": "agentAddress required"})
                    return
                result = evaluate_agent(agent_addr, self.config)
                self._respond(200, {"task": "evaluate-trust", "result": asdict(result)})

            elif task_type == "discover-agents":
                # In production: query relationship contract for all agents
                self._respond(200, {
                    "task": "discover-agents",
                    "result": {"agents": [], "message": "Discovery not yet connected to RPC"},
                })

            else:
                self._respond(400, {"error": f"Unknown task type: {task_type}"})
        else:
            self._respond(404, {"error": "Not found"})

    def _respond(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode())

    def log_message(self, format, *args):
        logger.info(f"A2A {args[0]}")


# ─── Main ────────────────────────────────────────────────────────────

def main():
    config = AgentConfig.from_env()

    logger.info(f"Starting {config.agent_name}")
    logger.info(f"  Agent address: {config.agent_address or '(not set)'}")
    logger.info(f"  RPC: {config.rpc_url}")
    logger.info(f"  Chain ID: {config.chain_id}")
    logger.info(f"  A2A port: {config.a2a_port}")
    logger.info(f"  Model: {config.model}")

    # Start A2A server
    A2AHandler.config = config
    server = HTTPServer(("0.0.0.0", config.a2a_port), A2AHandler)
    logger.info(f"A2A endpoint listening on port {config.a2a_port}")
    logger.info(f"  Health: http://localhost:{config.a2a_port}/health")
    logger.info(f"  Agent card: http://localhost:{config.a2a_port}/.well-known/agent.json")
    logger.info(f"  Tasks: POST http://localhost:{config.a2a_port}/tasks")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
