# ADR-0009: Target AWS Mumbai with OpenTofu-managed services

- **Status:** Accepted
- **Date:** 2025-02-15
- **Requirements:** 10, 14, 15

## Decision

The private pilot target is AWS `ap-south-1` (Mumbai). OpenTofu 1.9.0 with AWS provider 5.85.0 defines private networking, ECS Fargate services/tasks, RDS PostgreSQL, S3 evidence storage, Secrets Manager, KMS, Application Load Balancer, WAF, Route 53, ACM, telemetry components, IAM, backups, and environment isolation. Images are built with Docker Engine 27.5.1/Buildx 0.19.3 and use immutable identifiers.

Local/test workflows require no AWS credentials. Infrastructure validation is static before Gate A; plans, provisioning, and applies require approved credentials and are restricted to the named environment.

## Consequences

The pilot has an India-region, managed-service path while local development stays portable. IaC must implement migration checks, health gates, rollback, build identification, and separate sandbox/pilot/production state.
