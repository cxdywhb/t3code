import { describe, expect, it } from "vite-plus/test";
import { collaborationStage } from "./ResearchCollaboration.logic";

describe("collaboration stages", () => {
  it("keeps reviews separate from design and includes rework rounds", () => {
    expect(collaborationStage("design-review-2")).toBe("design-review-");
    expect(collaborationStage("design-2")).toBe("design-");
    expect(collaborationStage("prd-2")).toBe("prd-");
    expect(collaborationStage("archive")).toBe("archive");
    expect(collaborationStage("unknown")).toBeNull();
  });
});
