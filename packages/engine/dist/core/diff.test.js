// packages/engine/src/core/diff.test.ts
import { describe, it, expect } from "vitest";
import { diffEntries } from "./diff";
describe("diffEntries", () => {
    it("diffs entries", () => {
        const res = diffEntries({ A: "1", B: "2" }, { A: "1", B: "3", C: "4" });
        expect(res.changed.map((x) => x.key)).toEqual(["B"]);
        expect(res.added.map((x) => x.key)).toEqual(["C"]);
        expect(res.removed.map((x) => x.key)).toEqual([]);
        expect(res.unchanged.map((x) => x.key)).toEqual(["A"]);
    });
});
