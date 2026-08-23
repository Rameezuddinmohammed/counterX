import { describe, expect, it } from "vitest";
import { APP_NAME } from "./index.js";

describe("@counter/local-mcp placeholder", () => {
  it("exposes its app identity", () => {
    expect(APP_NAME).toBe("@counter/local-mcp");
  });
});
