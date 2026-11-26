import { describe, expect, it } from "@effect/vitest";

import { museModelCapabilities, resolveMuseReasoningEffort } from "./modelCatalog.ts";

describe("Muse model catalog", () => {
  it("normalizes saved and implicit efforts against the selected model before dispatch", () => {
    const unknown = museModelCapabilities({ variants: "unknown" });
    expect(unknown).toBeNull();
    expect(resolveMuseReasoningEffort(unknown, undefined)).toBeUndefined();
    expect(resolveMuseReasoningEffort(unknown, "max")).toBe("max");
    expect(resolveMuseReasoningEffort(unknown, "unsupported")).toBeUndefined();
    const detailed = museModelCapabilities({
      variants: "unknown",
      reasoningEffortVariants: [{ tier: "medium" }, { tier: "max" }],
    });
    expect(resolveMuseReasoningEffort(detailed, undefined)).toBe("medium");
    const restricted = museModelCapabilities({ variants: ["xhigh"] });
    expect(resolveMuseReasoningEffort(restricted, undefined)).toBe("xhigh");
    expect(resolveMuseReasoningEffort(restricted, "low")).toBe("xhigh");
    expect(
      resolveMuseReasoningEffort(museModelCapabilities({ variants: [] }), "max"),
    ).toBeUndefined();
    expect(resolveMuseReasoningEffort(undefined, "max")).toBe("max");
  });
});
