import { Severity } from "../core/types";
export type Rule = {
    id: string;
    severity: Severity;
    keyPattern?: RegExp;
    valuePattern?: RegExp;
    message: string | ((key: string) => string);
};
export declare const DEFAULT_RULES: Rule[];
//# sourceMappingURL=defaultRules.d.ts.map