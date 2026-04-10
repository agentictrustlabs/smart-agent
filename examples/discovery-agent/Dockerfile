# Discovery Agent — Nitro Enclave Image
#
# This Dockerfile defines the enclave image that runs inside an AWS Nitro
# Enclave. When built, it produces an EIF (Enclave Image File) with
# deterministic PCR measurements:
#
#   PCR0 = hash of this image (base layers + COPY + CMD)
#   PCR1 = hash of the Linux kernel and bootstrap
#   PCR2 = hash of the application code (agent.py + requirements)
#
# The code measurement stored on-chain is:
#   keccak256(PCR0 || PCR1 || PCR2)
#
# For TEE attestation simulation, paste this entire Dockerfile content
# into the "Enclave Image" field at /tee/simulate.

FROM python:3.11-slim AS base

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Application directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY agent.py /app/agent.py

# No network access in Nitro Enclave — communication via vsock only
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"

# Run the agent
CMD ["python", "/app/agent.py"]
