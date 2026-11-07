/** Explicit, browser-local saved programs: no server and no automatic writes. */
export const STORAGE_KEY = 'atto.playground.saved-programs.v1';
export const MAX_PROGRAMS = 30;
export const MAX_SOURCE_BYTES = 65536;
const encoder = new TextEncoder();
function normalizedName(name) {
  if (typeof name !== 'string') throw new Error('Program name must be text');
  const value = name.trim();
  if (!value || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error('Program name must be 1–64 characters without control characters');
  return value;
}
function validSource(source) {
  if (typeof source !== 'string' || encoder.encode(source).length > MAX_SOURCE_BYTES)
    throw new Error('Program must be text no larger than 64 KiB');
  return source;
}
export function parsePrograms(raw) {
  let data;
  try { data = JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const result = [], seen = new Set();
  for (const entry of data) {
    try {
      if (!entry || typeof entry !== 'object') continue;
      const name = normalizedName(entry.name), source = validSource(entry.source);
      if (seen.has(name)) continue;
      seen.add(name);
      result.push({name, source, updatedAt: Number.isSafeInteger(entry.updatedAt) && entry.updatedAt >= 0 ? entry.updatedAt : 0});
      if (result.length === MAX_PROGRAMS) break;
    } catch { /* refuse malformed saved data */ }
  }
  return result;
}
export function readPrograms(storage) { return parsePrograms(storage.getItem(STORAGE_KEY)); }
export function saveProgram(storage, name, source, now = Date.now()) {
  const cleaned = normalizedName(name), code = validSource(source);
  const previous = readPrograms(storage);
  if (previous.length >= MAX_PROGRAMS && !previous.some(p => p.name === cleaned))
    throw new Error('30 saved programs maximum; delete one first');
  const next = [{name: cleaned, source: code, updatedAt: now}, ...previous.filter(p => p.name !== cleaned)];
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
export function deleteProgram(storage, name) {
  const cleaned = normalizedName(name), previous = readPrograms(storage);
  const next = previous.filter(p => p.name !== cleaned);
  if (previous.length === next.length) throw new Error('Saved program not found');
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
