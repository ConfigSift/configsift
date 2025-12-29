const DEFAULTS = {
    maskChar: "•",
    revealLast: 4,
    revealFirst: 2,
    minMaskLength: 8,
};
function basicMask(value, opts) {
    const len = value.length;
    if (len <= opts.minMaskLength) {
        return { originalLength: len, redacted: opts.maskChar.repeat(Math.max(len, 4)) };
    }
    const first = value.slice(0, Math.min(opts.revealFirst, len));
    const last = value.slice(Math.max(0, len - opts.revealLast));
    const maskLen = Math.max(4, len - first.length - last.length);
    return {
        originalLength: len,
        redacted: `${first}${opts.maskChar.repeat(maskLen)}${last}`,
    };
}
function looksLikeUrl(value) {
    return /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(value) || value.includes("://");
}
function redactUrl(value, opts) {
    try {
        // URL() requires a valid scheme; for non-standard strings this might throw.
        const u = new URL(value);
        const host = u.host; // includes port
        const proto = u.protocol; // includes ':'
        const path = u.pathname && u.pathname !== "/" ? "/…" : "";
        // If username/password exist, mask them.
        const hasCreds = (u.username && u.username.length > 0) || (u.password && u.password.length > 0);
        const creds = hasCreds ? `${opts.maskChar.repeat(6)}@` : "";
        // Mask query/hash if present.
        const qh = (u.search && u.search.length > 0) || (u.hash && u.hash.length > 0) ? "?…" : "";
        const redacted = `${proto}//${creds}${host}${path}${qh}`;
        return { originalLength: value.length, redacted };
    }
    catch {
        // Fallback: mask but preserve up to '://'
        const idx = value.indexOf("://");
        if (idx > 0) {
            const prefix = value.slice(0, idx + 3);
            const rest = value.slice(idx + 3);
            const maskedRest = basicMask(rest, { ...opts, revealFirst: 0 }).redacted;
            return { originalLength: value.length, redacted: prefix + maskedRest };
        }
        return basicMask(value, opts);
    }
}
export function redactValue(value, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    // Smart redaction for URLs/connection strings
    if (looksLikeUrl(value)) {
        return redactUrl(value, o);
    }
    return basicMask(value, o);
}
