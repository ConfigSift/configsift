function msg(rule, key) {
    return typeof rule.message === "function" ? rule.message(key) : rule.message;
}
/**
 * applyRiskRules
 * Improvements vs previous:
 * - Adds stable dedupe (ruleId + ctx + key + optional message signature)
 * - For "changed", evaluates BOTH from + to for valuePattern rules (catches risky removal)
 * - Truncates findings with a warning, instead of returning 1000+ findings
 * - Adds small metadata to message (ctx + which side matched) without breaking older UIs
 */
export function applyRiskRules(diff, rules) {
    const findings = [];
    const warnings = [];
    // If you want to keep all findings, set to Infinity.
    const MAX_FINDINGS = 500;
    // Dedupe by rule+ctx+key+note (note distinguishes from/to matches cleanly)
    const seen = new Set();
    const pushFinding = (key, rule, context, note) => {
        // keep fingerprint stable; note is optional but helps avoid duplicate "from"/"to" spam
        const fingerprint = `${rule.id}::${context}::${key}::${note ?? ""}`;
        if (seen.has(fingerprint))
            return;
        seen.add(fingerprint);
        if (findings.length >= MAX_FINDINGS)
            return;
        const base = msg(rule, key);
        const meta = note ? ` (${context}; ${note})` : ` (${context})`;
        findings.push({
            key,
            severity: rule.severity,
            ruleId: rule.id,
            message: `${base}${meta}`,
        });
    };
    const matchesKey = (rule, key) => {
        return rule.keyPattern ? rule.keyPattern.test(key) : true;
    };
    const matchesValue = (rule, value) => {
        if (!rule.valuePattern)
            return true; // no value constraint
        if (value === undefined)
            return false; // valuePattern exists but no value provided
        return rule.valuePattern.test(value);
    };
    const matches = (rule, key, value) => {
        return matchesKey(rule, key) && matchesValue(rule, value);
    };
    // ADDED
    for (const a of diff.added) {
        for (const rule of rules) {
            if (matches(rule, a.key, a.value)) {
                pushFinding(a.key, rule, "added");
            }
        }
    }
    // REMOVED
    for (const r of diff.removed) {
        for (const rule of rules) {
            if (matches(rule, r.key, r.value)) {
                pushFinding(r.key, rule, "removed");
            }
        }
    }
    // CHANGED
    for (const c of diff.changed) {
        for (const rule of rules) {
            // If rule only cares about keyPattern (no valuePattern), evaluate once.
            if (!rule.valuePattern) {
                if (matchesKey(rule, c.key))
                    pushFinding(c.key, rule, "changed");
                continue;
            }
            // For valuePattern rules, evaluate both sides:
            // - "to" catches risky enabling (e.g., DEBUG=true)
            // - "from" catches risky disabling/removal that still matters to flag
            const toHit = matches(rule, c.key, c.to);
            const fromHit = matches(rule, c.key, c.from);
            if (toHit)
                pushFinding(c.key, rule, "changed", "matches new value");
            if (fromHit && !toHit)
                pushFinding(c.key, rule, "changed", "matches old value");
        }
    }
    if (findings.length >= MAX_FINDINGS) {
        warnings.push(`Risk findings capped at ${MAX_FINDINGS}. Consider filtering rules or narrowing inputs to reduce noise.`);
    }
    else if (findings.length > 200) {
        warnings.push("Large number of risk findings. Consider filtering.");
    }
    return { ...diff, findings, warnings };
}
