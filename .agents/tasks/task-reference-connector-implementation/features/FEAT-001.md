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
- All tests pass including certification harness

## Findings
- Review fix pass addressed: cancel releases correct variant/quantity via OrderRegistry, complete_order uses orderId field instead of quoteId, documented fault controls reset as intentional, documented BigInt double-parse as acceptable for test fixture.
- 51 tests pass in the connector package.
