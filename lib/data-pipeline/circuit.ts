import "server-only";

import {
  DataPipelineError,
  dataPipelineError,
  type DataPipelineDependency,
} from "./errors";

export type CircuitState = "closed" | "open" | "half-open";

export type CircuitSnapshot = {
  state: CircuitState;
  consecutiveFailures: number;
  openUntil: number;
  halfOpenProbeActive: boolean;
};

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil = 0;
  private halfOpenProbeActive = false;
  private readonly dependency: DataPipelineDependency;
  private readonly now: () => number;

  constructor(input: {
    dependency: DataPipelineDependency;
    now?: () => number;
  }) {
    this.dependency = input.dependency;
    this.now = input.now ?? Date.now;
  }

  snapshot(): CircuitSnapshot {
    const now = this.now();
    return {
      state:
        this.openUntil > now
          ? "open"
          : this.consecutiveFailures >= 3
            ? "half-open"
            : "closed",
      consecutiveFailures: this.consecutiveFailures,
      openUntil: this.openUntil,
      halfOpenProbeActive: this.halfOpenProbeActive,
    };
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const now = this.now();
    const isHalfOpen = this.consecutiveFailures >= 3 && this.openUntil <= now;
    if (this.openUntil > now || (isHalfOpen && this.halfOpenProbeActive)) {
      throw dataPipelineError({
        dependency: this.dependency,
        code: "circuit_open",
        retryable: true,
        countsTowardCircuit: false,
        metadata: { state: this.openUntil > now ? "open" : "half-open" },
      });
    }
    if (isHalfOpen) this.halfOpenProbeActive = true;

    try {
      const result = await operation();
      this.consecutiveFailures = 0;
      this.openUntil = 0;
      return result;
    } catch (error) {
      const counts =
        error instanceof DataPipelineError
          ? error.countsTowardCircuit
          : true;
      if (counts) {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= 3) {
          this.openUntil = this.now() + 30_000;
        }
      }
      throw error;
    } finally {
      if (isHalfOpen) this.halfOpenProbeActive = false;
    }
  }
}
