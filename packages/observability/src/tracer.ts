/**
 * Typed trace context helpers built on top of the OpenTelemetry Tracing API.
 *
 * Provides convenience functions for creating spans with correlation context,
 * propagating safe attributes, and wrapping async operations with traced spans.
 */
import {
  type Span,
  type Tracer,
  type SpanOptions,
  SpanStatusCode,
  trace,
  context as otelContext,
} from "@opentelemetry/api";
import type { CorrelationId, Environment } from "@counter/domain";
import { ATTR } from "./attributes.js";

/**
 * Context that is propagated through traces.
 */
export interface TraceContext {
  readonly correlationId?: CorrelationId;
  readonly environment?: Environment;
  readonly scopeKind?: string;
  readonly actorKind?: string;
}

/**
 * Gets a named tracer from the global tracer provider.
 */
export function getTracer(name: string, version?: string): Tracer {
  return trace.getTracer(name, version);
}

/**
 * Gets the currently active span from the context, if any.
 */
export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/**
 * Sets trace context attributes (correlationId, environment, scope) on a span.
 * Only safe, non-PII values are set.
 */
export function setTraceContextAttributes(span: Span, ctx: TraceContext): void {
  if (ctx.correlationId !== undefined) {
    span.setAttribute(ATTR.CORRELATION_ID, ctx.correlationId);
  }
  if (ctx.environment !== undefined) {
    span.setAttribute(ATTR.ENVIRONMENT, ctx.environment);
  }
  if (ctx.scopeKind !== undefined) {
    span.setAttribute(ATTR.SCOPE_KIND, ctx.scopeKind);
  }
  if (ctx.actorKind !== undefined) {
    span.setAttribute(ATTR.ACTOR_KIND, ctx.actorKind);
  }
}

/**
 * Options for the withSpan higher-order function.
 */
export interface WithSpanOptions {
  readonly tracer: Tracer;
  readonly name: string;
  readonly spanOptions?: SpanOptions;
  readonly traceContext?: TraceContext;
}

/**
 * Wraps an async operation in a traced span. Automatically:
 * - Creates a child span with the given name
 * - Sets trace context attributes if provided
 * - Records exceptions and sets error status on failure
 * - Ends the span on completion or error
 */
export async function withSpan<T>(
  options: WithSpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const { tracer, name, spanOptions, traceContext } = options;

  return tracer.startActiveSpan(name, spanOptions ?? {}, async (span) => {
    if (traceContext !== undefined) {
      setTraceContextAttributes(span, traceContext);
    }

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: unknown) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Gets the current OpenTelemetry context. Useful for propagation across
 * async boundaries such as job queues and outbox processors.
 */
export function getCurrentContext(): ReturnType<typeof otelContext.active> {
  return otelContext.active();
}
