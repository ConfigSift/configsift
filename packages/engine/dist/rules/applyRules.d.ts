import { DiffResult, DiffWithRisk } from "../core/types";
import { Rule } from "./defaultRules";
/**
 * applyRiskRules
 * Improvements vs previous:
 * - Adds stable dedupe (ruleId + ctx + key + optional message signature)
 * - For "changed", evaluates BOTH from + to for valuePattern rules (catches risky removal)
 * - Truncates findings with a warning, instead of returning 1000+ findings
 * - Adds small metadata to message (ctx + which side matched) without breaking older UIs
 */
export declare function applyRiskRules(diff: DiffResult, rules: Rule[]): DiffWithRisk;
//# sourceMappingURL=applyRules.d.ts.map