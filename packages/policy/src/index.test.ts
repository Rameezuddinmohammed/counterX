import { describe, expect, it } from "vitest";
import { PolicyEngine, InMemoryLimitStore, reduceToDecision } from "./index.js";

describe("@counter/policy package identity", () => {
  it("exports PolicyEngine class", () => {
    expect(PolicyEngine).toBeDefined();
  });

  it("exports InMemoryLimitStore class", () => {
    expect(InMemoryLimitStore).toBeDefined();
  });

  it("exports reduceToDecision function", () => {
    expect(reduceToDecision).toBeDefined();
  });
});
