/** Cosmetic tokenizer: follows comment/string boundaries and keywords from
 * ores-truffle-oreslang/oreslang-format (src/lib.rs, keyword_blocks.rs).
 * Only the actual compiler validates syntax; this never evaluates source.
 */
const KEYWORDS = new Set(('pub private define declare fnc mtd routine class actor module namespace import pkg from self struct trait interface enum ' +
  'final export external internal protected pure requires critical guard val const let mut return if ifnot unless then elif elseif else fi while do done for loop break continue ' +
  'match switch select over on when default end async await suspends yield gen generator spawn pipe task block supervisor channel use using with is emit defer recover try catch finally throw raise panic ' +
  'extends implements as new static suspend trap shared untrusted type where AND OR XOR borrow take share copy').split(' '));
const TYPES = new Set('int bool boolean void string String Symbol Result Option Generator Error float double Map List Array Vector Set Record Tuple Pair Entry'.split(' '));
const LITERALS = new Set('true false null none nil'.split(' '));
const HYPHEN_KEYWORDS = ['critical-read', 'critical-write', 'nb-select', 'transform-pipe'];
const OWNERSHIP_KEYWORDS = new Set(['borrow', 'take', 'share', 'copy']);
const USER_TYPE_DECLARATORS = new Set(['class', 'actor', 'struct', 'trait', 'interface', 'enum', 'type']);
export function tokenizeAtto(source) {
  const text = String(source), tokens = [];
  let i = 0, plain = '';
  const flush = () => { if (plain) { tokens.push({text: plain, kind: null}); plain = ''; } };
  const add = (kind, end) => { flush(); tokens.push({text: text.slice(i, end), kind}); i = end; };
  while (i < text.length) {
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      add('comment', end < 0 ? text.length : end); continue;
    }
    if (text.startsWith('/*', i)) {
      let end = i + 2, depth = 1;
      while (end < text.length && depth) {
        if (text.startsWith('/*', end)) { depth++; end += 2; }
        else if (text.startsWith('*/', end)) { depth--; end += 2; }
        else end++;
      }
      add('comment', end); continue;
    }
    if (text[i] === '"' || text[i] === "'" || text[i] === '\x60') {
      const quote = text[i]; let end = i + 1;
      while (end < text.length) {
        if (text[end] === '\\') { end += Math.min(2, text.length - end); continue; }
        if (text[end++] === quote) break;
      }
      add('string', end); continue;
    }
    let special = false;
    for (const word of HYPHEN_KEYWORDS) {
      if (text.startsWith(word, i) && !/[A-Za-z0-9_]/.test(text[i + word.length] || '')) {
        add('keyword', i + word.length); special = true; break;
      }
    }
    if (special) continue;
    // A contiguous yield* delegates to an iterable. Plain yield + multiplication
    // remains separately tokenized; comments and strings were handled above.
    if (text.startsWith('yield*', i)) { add('keyword', i + 6); continue; }
    const number = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|[0-9][0-9_]*(?:\.[0-9_]+)?)/.exec(text.slice(i));
    if (number) { add('number', i + number[0].length); continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    if (id) {
      const word = id[0], after = text.slice(i + word.length);
      const kind = word === 'eq' || word === 'neq' ? 'operator-accent'
        : word === 'block' || word === 'task' ? 'concurrency'
        : KEYWORDS.has(word) ? 'keyword'
        : TYPES.has(word) ? 'type'
        : LITERALS.has(word) ? 'literal'
        : /^\s*\(/.test(after) ? 'function' : null;
      if (kind) add(kind, i + word.length);
      else add(null, i + word.length); // retain identifier boundaries for user-defined types
      continue;
    }
    // Keep map arrows intact (also used by the pending collection-preview PR).
    if (text.startsWith('=>', i)) { add('operator', i + 2); continue; }
    if (text[i] === '=' || text[i] === '^') { add('operator-accent', i + 1); continue; }
    if (text[i] === '!') {
      const previous = tokens[tokens.length - 1];
      if ((previous?.kind === 'keyword' && OWNERSHIP_KEYWORDS.has(previous.text)) ||
          previous?.kind === 'ownership-bang') {
        add('ownership-bang', i + 1); continue;
      }
    }
    if ('+-*/%=!<>&|^~?:'.includes(text[i])) { add('operator', i + 1); continue; }
    plain += text[i++];
  }
  flush();
  // Lightweight declaration awareness: classify local type names everywhere,
  // including references preceding the declaration. Never scan comments/strings
  // as source; these remain opaque tokens. No compiler/semantic claims are made.
  const userTypes = new Set();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== 'keyword' || !USER_TYPE_DECLARATORS.has(token.text)) continue;
    let next = index + 1;
    while (next < tokens.length && (tokens[next].kind === 'comment' ||
        (tokens[next].kind === null && /^\s+$/.test(tokens[next].text)))) next++;
    if (tokens[next]?.kind === null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tokens[next].text))
      userTypes.add(tokens[next].text);
  }
  for (const token of tokens) {
    if (userTypes.has(token.text) && (token.kind === null || token.kind === 'function'))
      token.kind = 'user-type';
  }
  return tokens;
}
export function renderHighlighted(source, root) {
  const tokens = tokenizeAtto(source);
  if (tokens.length > 12000) {
    root.replaceChildren(document.createTextNode(source)); return;
  }
  const fragment = document.createDocumentFragment();
  for (const token of tokens) {
    if (!token.kind) fragment.appendChild(document.createTextNode(token.text));
    else {
      const span = document.createElement('span');
      span.className = 'tok-' + token.kind;
      span.textContent = token.text; // user source is never HTML
      fragment.appendChild(span);
    }
  }
  root.replaceChildren(fragment);
}
