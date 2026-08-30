/**
 * Configurable fault injection for the reference connector.
 *
 * Provides deterministic, seed-based control over delays, duplicates,
 * reordering, malformed data, stale responses, conflict errors, and
 * ambiguous writes.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FaultControlsConfig {
  readonly delayMs: number;
  readonly duplicateEventRate: number;
  readonly reorderEventRate: number;
  readonly malformedDataRate: number;
  readonly staleResponseRate: number;
  readonly conflictErrorRate: number;
  readonly ambiguousWriteRate: number;
  readonly seed: number;
}

export interface FaultControls {
  readonly config: FaultControlsConfig;
  shouldInjectDelay(): boolean;
  getDelayMs(): number;
  shouldDuplicateEvent(): boolean;
  shouldReorderEvents(): boolean;
  shouldReturnMalformedData(): boolean;
  shouldReturnStaleResponse(): boolean;
  shouldReturnConflictError(): boolean;
  shouldReturnAmbiguousWrite(): boolean;
  reset(): void;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_FAULT_CONFIG: FaultControlsConfig = {
  delayMs: 0,
  duplicateEventRate: 0,
  reorderEventRate: 0,
  malformedDataRate: 0,
  staleResponseRate: 0,
  conflictErrorRate: 0,
  ambiguousWriteRate: 0,
  seed: 42,
};

// ─── Simple Deterministic PRNG ────────────────────────────────────────────────

class SeededRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = seed;
  }

  next(): number {
    // Mulberry32
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.#state ^ (this.#state >>> 15), 1 | this.#state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  reset(seed: number): void {
    this.#state = seed;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createFaultControls(config: Partial<FaultControlsConfig> = {}): FaultControls {
  const resolved: FaultControlsConfig = { ...DEFAULT_FAULT_CONFIG, ...config };
  const rng = new SeededRandom(resolved.seed);

  return {
    config: resolved,

    shouldInjectDelay(): boolean {
      return resolved.delayMs > 0;
    },

    getDelayMs(): number {
      return resolved.delayMs;
    },

    shouldDuplicateEvent(): boolean {
      return rng.next() < resolved.duplicateEventRate;
    },

    shouldReorderEvents(): boolean {
      return rng.next() < resolved.reorderEventRate;
    },

    shouldReturnMalformedData(): boolean {
      return rng.next() < resolved.malformedDataRate;
    },

    shouldReturnStaleResponse(): boolean {
      return rng.next() < resolved.staleResponseRate;
    },

    shouldReturnConflictError(): boolean {
      return rng.next() < resolved.conflictErrorRate;
    },

    shouldReturnAmbiguousWrite(): boolean {
      return rng.next() < resolved.ambiguousWriteRate;
    },

    reset(): void {
      rng.reset(resolved.seed);
    },
  };
}
