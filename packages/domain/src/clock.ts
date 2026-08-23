import { instantFromEpochMilliseconds, type Instant } from "./instant.js";

export interface Clock {
  now(): Instant;
}

export type EpochMillisecondsSource = () => number;

export class SystemClock implements Clock {
  readonly #source: EpochMillisecondsSource;

  public constructor(source: EpochMillisecondsSource = Date.now) {
    this.#source = source;
  }

  public now(): Instant {
    const instant = instantFromEpochMilliseconds(this.#source());
    if (!instant.ok) {
      throw new RangeError(instant.error.message);
    }
    return instant.value;
  }
}
