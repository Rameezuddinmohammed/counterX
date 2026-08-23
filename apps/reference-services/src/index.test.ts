import { describe, expect, it } from "vitest";
import { APP_NAME } from "./index.js";

describe("@counter/reference-services placeholder", () => {
  it("exposes its app identity", () => {
    expect(APP_NAME).toBe("@counter/reference-services");
  });
});
