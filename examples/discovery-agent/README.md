# Discovery Agent — Example TEE Agent

An autonomous AI agent that discovers and evaluates other agents in the Smart Agent trust fabric. Designed to run inside a Trusted Execution Environment (AWS Nitro Enclave).

## Files

| File | Purpose | TEE Simulator Field |
|------|---------|-------------------|
| `Dockerfile` | Enclave image definition (base OS, deps, app code) | **Enclave Image** (→ PCR0) |
| `agent-config.yaml` | Runtime configuration (contracts, model, capabilities) | **Application Config** (→ PCR2) |
| `agent.py` | Agent application code | (included in Dockerfile) |
| `requirements.txt` | Python dependencies | (included in Dockerfile) |

## Testing with TEE Simulator

1. Go to `/tee/simulate` in the web app
2. Select the agent you want to attest (e.g., "Discovery AI Agent")
3. Choose **AWS Nitro Enclave** as TEE architecture
4. Paste the contents of `Dockerfile` into **Enclave Image**
5. Set **Kernel + Bootstrap** to `linux-6.1-nitro-enclave`
6. Paste the contents of `agent-config.yaml` into **Application Config**
7. Click **Simulate Attestation + Record Validation**

The simulator will:
- Compute PCR0 = keccak256(Dockerfile content)
- Compute PCR1 = keccak256("linux-6.1-nitro-enclave")
- Compute PCR2 = keccak256(agent-config.yaml content)
- Call MockTeeVerifier.verifyNitro() on-chain
- Record the validation in AgentValidationProfile
- Display the code measurement and tx hash

## Running Locally (without TEE)

```bash
cd examples/discovery-agent
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python agent.py
```

The agent starts an A2A endpoint on port 8080:

```bash
# Health check
curl http://localhost:8080/health

# Agent card
curl http://localhost:8080/.well-known/agent.json

# Evaluate an agent's trust
curl -X POST http://localhost:8080/tasks \
  -H "Content-Type: application/json" \
  -d '{"type": "evaluate-trust", "agentAddress": "0x1234..."}'
```

## What Happens in a Real TEE

In production (AWS Nitro):

1. The Dockerfile is built into an EIF (Enclave Image File)
2. `nitro-cli build-enclave --docker-uri discovery-agent:latest` produces PCR values
3. The enclave starts with no network/disk access (vsock only)
4. The TEE hardware signs an attestation document containing PCR0-PCR2
5. The attestation is submitted to a verifier contract (Automata DCAP / Base Nitro Validator)
6. The verifier extracts and validates the PCR values against the vendor certificate chain
7. The code measurement is recorded on-chain in AgentValidationProfile
