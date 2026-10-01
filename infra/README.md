# infra

Terraform (`infra/terraform`), Helm charts and ArgoCD apps (`infra/k8s`), SLOs as code (`infra/slo`).
Owner: `devops-sre` (ADR 0009). Applying infrastructure changes happens only from CI with approval; local agents
may only run `terraform plan`, `fmt` and `validate`.
