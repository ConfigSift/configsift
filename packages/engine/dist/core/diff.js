export function diffEntries(left, right) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    const allKeys = Array.from(new Set([...leftKeys, ...rightKeys])).sort((a, b) => a.localeCompare(b));
    const added = [];
    const removed = [];
    const changed = [];
    const unchanged = [];
    for (const key of allKeys) {
        const inL = Object.prototype.hasOwnProperty.call(left, key);
        const inR = Object.prototype.hasOwnProperty.call(right, key);
        if (!inL && inR) {
            added.push({ key, value: right[key] });
            continue;
        }
        if (inL && !inR) {
            removed.push({ key, value: left[key] });
            continue;
        }
        const from = left[key];
        const to = right[key];
        if (from !== to)
            changed.push({ key, from, to });
        else
            unchanged.push({ key, value: from });
    }
    return { added, removed, changed, unchanged };
}
