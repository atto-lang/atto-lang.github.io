/**
 * Fail-closed URL policy for generated static pages.
 * URLs in HTML attributes are entity-decoded by browsers before navigation:
 * comparing raw HTML strings alone misses dangerous encoded schemes.
 *
 * Relative/local and HTTPS links, plus mailto/tel anchors, remain valid.
 * Executable, inline-data, privileged, unknown schemes and bidi-spoofing\n * controls fail the build.
 */
const namedEntities = new Map([
  ["amp", "&"], ["quot", '"'], ["apos", "'"], ["lt", "<"], ["gt", ">"],
  ["colon", ":"], ["Tab", "\t"], ["NewLine", "\n"],
]);

export function decodeUrlAttribute(raw) {
  if (typeof raw !== "string" || raw.length > 8192) {
    throw new Error("Invalid or oversized HTML URL attribute");
  }
  return raw
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/giu, (whole, hex, dec) => {
      const point = Number.parseInt(hex ?? dec, hex === undefined ? 10 : 16);
      return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff
        && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : "\uFFFD";
    })
    .replace(/&([a-z][a-z0-9]+);/giu, (whole, name) =>
      namedEntities.get(name) ?? whole);
}

export function validatedSiteUrl(raw, base, attribute = "href") {
  const decoded = decodeUrlAttribute(raw);
  if (!decoded || decoded !== decoded.trim()
      || /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(decoded)) {
    throw new Error("Unsafe whitespace or control character in " + attribute + ": " + raw);
  }
  let target;
  try { target = new URL(decoded, base); }
  catch { throw new Error("Malformed URL in " + attribute + ": " + raw); }
  const allowed = attribute === "href"
    ? ["http:", "https:", "mailto:", "tel:"]
    : ["http:", "https:"];
  if (!allowed.includes(target.protocol)) {
    throw new Error("Unsafe or unsupported URL scheme in " + attribute + ": " + raw);
  }
  // Public production pages must not link to insecure HTTP origins.
  // Retain same-origin loopback HTTP for local Astro preview builds.
  if (target.protocol === "http:") {
    const baseUrl = new URL(base);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname.toLowerCase());
    if (!loopback || baseUrl.protocol !== "http:" || target.origin !== baseUrl.origin) {
      throw new Error("Insecure external HTTP URL forbidden in " + attribute + ": " + raw);
    }
  }
  if (target.protocol === "http:" || target.protocol === "https:") {
    if (target.username || target.password) {
      throw new Error("Credential-bearing URL forbidden in " + attribute + ": " + raw);
    }
  }
  return target;
}

/**
 * Iterate full opening tags, respecting quoted ">" and "<" characters.
 * A regex ending at the first ">" silently truncates an unsafe real href/src
 * when an unrelated attribute contains ">" before that href/src.
 */
export function* siteTags(html) {
  if(typeof html!=="string") throw new TypeError("HTML markup must be a string");
  const opener=/<(?:a|link|script|img|source|iframe|embed|object|form|video|audio|track|base)\b/giu;
  let match;
  while((match=opener.exec(html))!==null) {
    let quote=null;
    let end=-1;
    for(let i=opener.lastIndex;i<html.length;i++) {
      const ch=html[i];
      if(quote!==null) {
        if(ch===quote) quote=null;
      } else if(ch==='"'||ch==="'") {
        quote=ch;
      } else if(ch===">") {
        end=i+1;
        break;
      } else if(ch==="<") {
        throw new Error("Malformed HTML opening tag before another tag");
      }
    }
    if(end<0) throw new Error("Unterminated HTML opening tag");
    yield html.slice(match.index,end);
    opener.lastIndex=end;
  }
}

/** Read an actual attribute, never a lookalike inside another quoted value. */
export function htmlAttribute(tag, name) {
  if(typeof tag!=="string" || !/^<[A-Za-z]/u.test(tag)
      || typeof name!=="string" || !/^[a-z][a-z0-9-]*$/iu.test(name))
    throw new TypeError("Invalid HTML tag or attribute selector");
  let i=1;
  // Skip tag name, then parse attributes as a lexical sequence.
  while(i<tag.length && !/[\t\n\f\r />]/u.test(tag[i])) i++;
  const wanted=name.toLowerCase();
  while(i<tag.length) {
    while(i<tag.length && /[\t\n\f\r ]/u.test(tag[i])) i++;
    if(i>=tag.length||tag[i]===">") break;
    if(tag[i]==="/"&&tag[i+1]===">") break;
    const begin=i;
    while(i<tag.length && !/[\t\n\f\r />=]/u.test(tag[i])) i++;
    if(i===begin) throw new Error("Malformed HTML attribute name");
    const key=tag.slice(begin,i).toLowerCase();
    while(i<tag.length && /[\t\n\f\r ]/u.test(tag[i])) i++;
    let value="";
    if(tag[i]==="=") {
      i++;
      while(i<tag.length && /[\t\n\f\r ]/u.test(tag[i])) i++;
      if(tag[i]==="'"||tag[i]==='"') {
        const quote=tag[i++];
        const valueStart=i;
        while(i<tag.length&&tag[i]!==quote) i++;
        if(i>=tag.length) throw new Error("Unterminated quoted HTML attribute");
        value=tag.slice(valueStart,i++);
      } else {
        const valueStart=i;
        while(i<tag.length&&!/[\t\n\f\r >]/u.test(tag[i])) i++;
        if(i===valueStart) throw new Error("Missing HTML attribute value");
        value=tag.slice(valueStart,i);
      }
    }
    // HTML drops duplicate attributes after the first occurrence.
    if(key===wanted) return value;
  }
  return null;
}
