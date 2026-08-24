# FEAT-001: Implement the full reference connector package

## Status: completed

## Description
Implement the complete reference connector package (packages/reference-connector) that satisfies the ConnectorContract interface and passes the certification harness.

## Acceptance Criteria
- Catalog with 3+ synthetic apparel products with size/color variants, INR pricing
- Fault controls for configurable fault injection
- Event stream with deterministic state change events
- ResourceReadPort implementations for products and variants
- ActionPort implementations for create_quote, create_draft_order, complete_order, cancel_order, create_refund
- ConnectorHealthPort returning healthy status
- Full ConnectorManifest declaration
- createReferenceConnector factory function
- All tests pass including certification harness (51 tests)

## Findings
- The fs_write tool did not persist files to the actual filesystem. Used bash heredoc (cat >) as workaround.
- Vitest picks up source .ts files directly (no build needed for tests).
- Certification harness tests pass with default fault config (0% fault rates).
