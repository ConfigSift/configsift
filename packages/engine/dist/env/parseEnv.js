const BASIC_DEFAULTS = {
    allowExportPrefix: true,
    allowEmptyValues: true,
    allowDuplicateKeys: true,
    stripInlineComments: true,
    allowMultiline: false,
    expandVariables: false,
};
const DOTENV_DEFAULTS = {
    allowExportPrefix: true,
    allowEmptyValues: true,
    allowDuplicateKeys: true,
    stripInlineComments: true,
    allowMultiline: true,
    expandVariables: true,
};
function detectProfile(opts) {
    return (opts.profile ?? "dotenv");
}
/**
 * Strip inline comments but NOT inside quotes.
 * Supports ` #` and ` ;` style. (Requires whitespace before comment char.)
 */
function stripInlineCommentSmart(value) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === "'" && !inDouble)
            inSingle = !inSingle;
        else if (ch === `"` && !inSingle)
            inDouble = !inDouble;
        if (inSingle || inDouble)
            continue;
        // comment begins when # or ; appears after whitespace
        if ((ch === "#" || ch === ";") && i > 0) {
            const prev = value[i - 1];
            if (prev === " " || prev === "\t") {
                return value.slice(0, i).trimEnd();
            }
        }
    }
    return value.trimEnd();
}
function unquoteAndUnescape(value) {
    const v = value.trim();
    const isDouble = v.startsWith(`"`) && v.endsWith(`"`);
    const isSingle = v.startsWith(`'`) && v.endsWith(`'`);
    if (!isDouble && !isSingle)
        return v;
    let inner = v.slice(1, -1);
    // dotenv-like: only unescape in double quotes
    if (isDouble) {
        inner = inner
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\"/g, `"`)
            .replace(/\\\\/g, `\\`);
    }
    return inner;
}
function expandVars(value, dict) {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b) => {
        const k = a || b;
        if (!k)
            return m;
        return Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : m;
    });
}
export function parseEnv(input, opts = {}) {
    const profile = detectProfile(opts);
    const defaults = profile === "basic" ? BASIC_DEFAULTS : DOTENV_DEFAULTS;
    const o = {
        profile,
        expandFrom: opts.expandFrom ?? {},
        ...defaults,
        ...opts,
    };
    const text = String(input ?? "").replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    const entries = {};
    const errors = [];
    const warnings = [];
    const dupMap = new Map();
    const recordDup = (key, lineNo) => {
        const prev = dupMap.get(key) ?? [];
        prev.push(lineNo);
        dupMap.set(key, prev);
    };
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const lineNo = i + 1;
        let line = raw.trim();
        if (!line)
            continue;
        if (line.startsWith("#"))
            continue;
        // BOM safety
        if (lineNo === 1)
            line = line.replace(/^\uFEFF/, "");
        let working = line;
        // allow `export KEY=...` (case-insensitive, any whitespace)
        if (o.allowExportPrefix) {
            const m = working.match(/^export\s+/i);
            if (m)
                working = working.slice(m[0].length).trim();
        }
        const eq = working.indexOf("=");
        if (eq < 0) {
            errors.push({ line: lineNo, code: "INVALID_LINE", message: "Missing '='", raw });
            continue;
        }
        const key = working.slice(0, eq).trim();
        let value = working.slice(eq + 1); // keep spacing for comment stripping
        if (!key) {
            errors.push({ line: lineNo, code: "EMPTY_KEY", message: "Empty key before '='", raw });
            continue;
        }
        if (!o.allowEmptyValues && value.trim() === "") {
            errors.push({ line: lineNo, code: "INVALID_LINE", message: "Empty value not allowed", raw });
            continue;
        }
        // Multiline quoted values (dotenv style)
        const startsWithQuote = value.trim().startsWith(`"`) || value.trim().startsWith(`'`);
        if (o.allowMultiline && startsWithQuote) {
            const trimmed = value.trim();
            const quoteChar = trimmed[0];
            const endsSameLine = trimmed.length >= 2 && trimmed.endsWith(quoteChar);
            if (!endsSameLine) {
                // accumulate until we find closing quote
                let acc = value;
                let found = false;
                while (i + 1 < lines.length) {
                    i++;
                    acc += "\n" + lines[i];
                    const t = acc.trimEnd();
                    if (t.endsWith(quoteChar)) {
                        found = true;
                        value = acc;
                        break;
                    }
                }
                if (!found) {
                    errors.push({
                        line: lineNo,
                        code: "UNTERMINATED_QUOTE",
                        message: "Unterminated quoted value (multiline)",
                        raw,
                    });
                    continue;
                }
            }
        }
        if (o.stripInlineComments)
            value = stripInlineCommentSmart(value);
        else
            value = value.trimEnd();
        const unquoted = unquoteAndUnescape(value);
        // Duplicate tracking
        recordDup(key, lineNo);
        if (!o.allowDuplicateKeys && Object.prototype.hasOwnProperty.call(entries, key)) {
            errors.push({ line: lineNo, code: "INVALID_LINE", message: `Duplicate key '${key}'`, raw });
            continue;
        }
        // Variable expansion (optional)
        let finalValue = unquoted;
        if (o.expandVariables) {
            const dict = { ...o.expandFrom, ...entries };
            finalValue = expandVars(finalValue, dict);
        }
        entries[key] = finalValue; // last wins
    }
    const duplicates = Array.from(dupMap.entries())
        .filter(([, ls]) => ls.length > 1)
        .map(([key, ls]) => ({ key, lines: ls }));
    if (duplicates.length > 0)
        warnings.push(`Found ${duplicates.length} duplicate key(s). Last value wins.`);
    if (errors.length > 0)
        warnings.push(`Found ${errors.length} parse error(s). Some lines were ignored.`);
    return {
        format: "env",
        entries,
        duplicates,
        errors,
        warnings,
        meta: { lineCount: lines.length, profile },
    };
}
