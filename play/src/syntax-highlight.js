/** Cosmetic tokenizer: follows comment/string boundaries and keywords from
 * ores-truffle-oreslang/oreslang-format (src/lib.rs, keyword_blocks.rs).
 * Only the actual compiler validates syntax; this never evaluates source.
 */
const KEYWORDS = new Set(('pub private define fnc routine class actor module struct trait interface ' +
  'final val const let mut return if then elif elseif else fi while do done for loop break continue ' +
  'match switch select over on when default end async await suspends yield gen generator spawn pipe task supervisor channel use using with is emit defer recover try catch throw raise panic ' +
  'extends implements as new static suspend trap shared untrusted type where AND OR XOR').split(' '));
const TYPES = new Set('int bool boolean void string String Symbol Result Option Generator Error float double'.split(' '));
const LITERALS = new Set('true false null none nil'.split(' '));
const HYPHEN_KEYWORDS = ['critical-read', 'critical-write', 'nb-select', 'transform-pipe'];
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
      const kind = KEYWORDS.has(word) ? 'keyword'
        : TYPES.has(word) ? 'type'
        : LITERALS.has(word) ? 'literal'
        : /^\s*\(/.test(after) ? 'function' : null;
      if (kind) add(kind, i + word.length);
      else { plain += word; i += word.length; }
      continue;
    }
    if ('+-*/%=!<>&|^~?:'.includes(text[i])) { add('operator', i + 1); continue; }
    plain += text[i++];
  }
  flush();
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
