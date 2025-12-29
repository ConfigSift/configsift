// packages/engine/src/core/compare.ts
import { parseEnv } from "../env/parseEnv";
import { diffEntries } from "./diff";
import { DiffDisplayModel, EnvParseOptions, EnvProfile } from "./types";
import { DEFAULT_RULES } from "../rules/defaultRules";
import { applyRiskRules } from "../rules/applyRules";
import { redactValue } from "./redact";

export type CompareEnvOptions = EnvParseOptions;

export function compareEnv(leftText: string, rightText: string, opts: CompareEnvOptions = {}): DiffDisplayModel {
  const left = parseEnv(leftText, opts);
  const right = parseEnv(rightText, opts);

  const diff = diffEntries(left.entries, right.entries);
  const withRisk = applyRiskRules(diff, DEFAULT_RULES);

  const redactedValues: DiffDisplayModel["redactedValues"] = {};

  for (const c of withRisk.changed) {
    redactedValues[c.key] = { from: redactValue(c.from), to: redactValue(c.to) };
  }
  for (const a of withRisk.added) {
    redactedValues[a.key] = { value: redactValue(a.value) };
  }
  for (const r of withRisk.removed) {
    redactedValues[r.key] = { value: redactValue(r.value) };
  }

  const profile = (opts.profile ?? left.meta.profile ?? "dotenv") as EnvProfile;

  return {
    ...withRisk,
    redactedValues,
    meta: {
      profile,
      parse: {
        left: { errors: left.errors, duplicates: left.duplicates, warnings: left.warnings, meta: left.meta },
        right: { errors: right.errors, duplicates: right.duplicates, warnings: right.warnings, meta: right.meta },
      },
    },
  };
}
