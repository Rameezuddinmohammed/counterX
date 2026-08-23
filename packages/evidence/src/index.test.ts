import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("@counter/evidence placeholder", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/evidence");
  });
});
