import { describe, expect, it } from "vitest";
import { APP_NAME } from "./identity.js";

describe("@counter/wallet-console placeholder", () => {
  it("exposes its app identity", () => {
    expect(APP_NAME).toBe("@counter/wallet-console");
  });
});
