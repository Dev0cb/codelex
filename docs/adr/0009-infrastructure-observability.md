# 0009 — Kubernetes, Terraform, ArgoCD; OpenTelemetry-based observability

- Status: Accepted · Date: 2026-10-01 · Reversibility: Two-way door (costly)

## Context
Many services, multi-region ambition, need for reproducible environments and strong observability.

## Decision
Managed Kubernetes (cloud provider chosen by a follow-up ADR on cost/regions incl. Africa & Europe latency),
Terraform for cloud resources, Helm library chart for services, ArgoCD GitOps for promotion, External Secrets,
cosign-signed images. Observability: OpenTelemetry SDKs + collector → Prometheus/Grafana, Tempo, Loki;
Sentry for mobile/web crashes; SLOs as code with burn-rate alerts.

## Consequences
Platform work up front (Phase 0/2); local dev uses docker compose, not k8s; serverless allowed for edge
functions (OG images, Daily payload) when justified.
