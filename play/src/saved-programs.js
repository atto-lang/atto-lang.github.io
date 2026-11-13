/** Explicit, browser-local saved programs: no server and no automatic writes. */
export const STORAGE_KEY = 'atto.playground.saved-programs.v1';
export const MAX_PROGRAMS = 30;
export const MAX_SOURCE_BYTES = 65536;
export const MAX_BACKUP_BYTES = 512 * 1024;
export const BACKUP_FORMAT = 'atto.playground.programs.v1';
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
/** Mutations fail closed on malformed local data instead of silently overwriting it. */
function strictStoragePrograms(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  if (typeof raw !== 'string' || raw.length > MAX_BACKUP_BYTES * 2)
    throw new Error('Saved program library is malformed; refusing to overwrite it');
  let values;
  try { values = JSON.parse(raw); }
  catch { throw new Error('Saved program library is malformed; refusing to overwrite it'); }
  if (!Array.isArray(values) || values.length > MAX_PROGRAMS || parsePrograms(raw).length !== values.length)
    throw new Error('Saved program library is malformed; refusing to overwrite it');
  return parsePrograms(raw);
}
export function parsePrograms(raw) {
  let data;
  if (typeof raw !== 'string' && raw !== null && raw !== undefined) return [];
  if (raw && raw.length > MAX_BACKUP_BYTES * 2) return [];
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
  const previous = strictStoragePrograms(storage);
  if (previous.length >= MAX_PROGRAMS && !previous.some(p => p.name === cleaned))
    throw new Error('30 saved programs maximum; delete one first');
  const next = [{name: cleaned, source: code, updatedAt: now}, ...previous.filter(p => p.name !== cleaned)];
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
export function deleteProgram(storage, name) {
  const cleaned = normalizedName(name), previous = strictStoragePrograms(storage);
  const next = previous.filter(p => p.name !== cleaned);
  if (previous.length === next.length) throw new Error('Saved program not found');
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}


/** Portable backup format. No remote storage, evaluation or source upload. */
export function exportPrograms(storage) {
  const json = JSON.stringify({format: BACKUP_FORMAT, programs: strictStoragePrograms(storage)}, null, 2) + '\n';
  if (encoder.encode(json).length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds 512 KiB; export fewer or smaller programs');
  return json;
}

/** Validate an entire import before making exactly one localStorage write. */
export function decodeBackup(json) {
  if (typeof json !== 'string' || encoder.encode(json).length > MAX_BACKUP_BYTES)
    throw new Error('Backup exceeds 512 KiB or is not text');
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('Backup is not valid JSON'); }
  if (!data || Array.isArray(data) || typeof data !== 'object' ||
      data.format !== BACKUP_FORMAT || !Array.isArray(data.programs) ||
      data.programs.length > MAX_PROGRAMS)
    throw new Error('Unsupported or oversized AttoLang backup');
  const names = new Set(), programs = [];
  for (const program of data.programs) {
    if (!program || typeof program !== 'object' || Array.isArray(program))
      throw new Error('Malformed backup entry');
    const name = normalizedName(program.name);
    if (name !== program.name || names.has(name))
      throw new Error('Invalid or duplicated backup program name');
    names.add(name);
    const source = validSource(program.source);
    if (!Number.isSafeInteger(program.updatedAt) || program.updatedAt < 0)
      throw new Error('Invalid backup timestamp');
    programs.push({name, source, updatedAt: program.updatedAt});
  }
  return programs;
}
export function importPrograms(storage, json, {onConflict = 'reject'} = {}) {
  if (!['reject', 'replace', 'keep'].includes(onConflict))
    throw new Error('Unsupported import collision policy');
  const incoming = decodeBackup(json);
  const existing = strictStoragePrograms(storage);
  const names = new Set(existing.map(p => p.name));
  const conflicts = incoming.filter(p => names.has(p.name)).map(p => p.name);
  if (conflicts.length && onConflict === 'reject')
    throw new Error('Import conflict: existing saved program name(s): ' + conflicts.join(', '));
  const newRecords = onConflict === 'keep'
    ? incoming.filter(p => !names.has(p.name)) : incoming;
  const newNames = new Set(newRecords.map(p => p.name));
  const next = [...newRecords, ...existing.filter(p => !newNames.has(p.name))];
  if (next.length > MAX_PROGRAMS) throw new Error('Import would exceed 30 saved programs');
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return {programs: next, imported: newRecords.length, conflicts: conflicts.length};
}
