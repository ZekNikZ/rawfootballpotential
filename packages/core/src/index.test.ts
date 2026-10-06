import { describe, expect, it } from "vitest";
import { SLOT_KINDS } from "./index";

describe("core skeleton", () => {
  it("exports slot kinds", () => {
    expect(SLOT_KINDS).toContain("starter");
  });
});
