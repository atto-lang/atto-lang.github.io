use chrono::{DateTime, Datelike, Utc};
use roxmltree::{Document, Node};
use std::{collections::HashSet, env, fs, path::Path};

type Check<T> = Result<T, String>;
const ORIGIN: &str = "https://ores-truffle-oreslang.github.io";
const DC_NS: &str = "http://purl.org/dc/elements/1.1/";
const MAP_NS: &str = "http://www.sitemaps.org/schemas/sitemap/0.9";

fn named(node: Node<'_, '_>, name: &str, ns: Option<&str>) -> bool {
    node.is_element() && node.tag_name().name() == name && node.tag_name().namespace() == ns
}
fn child<'a,'input>(parent: Node<'a,'input>, name: &str, ns: Option<&str>) -> Check<Node<'a,'input>> {
    let mut matches = parent.children().filter(|n| named(*n, name, ns));
    let first = matches.next().ok_or_else(|| format!("Missing {name}"))?;
    if matches.next().is_some() { return Err(format!("Duplicate {name}")); }
    Ok(first)
}
fn value(parent: Node<'_, '_>, name: &str, ns: Option<&str>) -> Check<String> {
    let text = child(parent,name,ns)?.text().unwrap_or("").trim().to_string();
    if text.is_empty() { return Err(format!("Empty {name}")); }
    Ok(text)
}
fn xml(s: &str) -> Check<Document<'_>> {
    if s.len() > 2_000_000 { return Err("XML exceeds size limit".into()); }
    let lower = s.to_ascii_lowercase();
    if lower.contains("<!doctype") || lower.contains("<!entity") {
        return Err("DOCTYPE and entity declarations are unsupported".into());
    }
    Document::parse(s).map_err(|e| format!("Malformed XML: {e}"))
}
fn validate(feed: &str, sitemap: &str) -> Check<()> {
    let rss = xml(feed)?;
    let root = rss.root_element();
    if !named(root,"rss",None) || root.attribute("version") != Some("2.0") {
        return Err("Expected RSS 2.0".into());
    }
    let channel = child(root,"channel",None)?;
    if value(channel,"title",None)? != "AttoLang engineering logs" ||
       value(channel,"link",None)? != format!("{ORIGIN}/logs/") {
        return Err("RSS channel metadata differs".into());
    }
    let items: Vec<_> = channel.children().filter(|n| named(*n,"item",None)).collect();
    if items.len() != 10 { return Err("Expected ten RSS items".into()); }
    let mut seen = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let url = format!("{ORIGIN}/logs/{}/",10-index);
        if value(*item,"link",None)? != url || value(*item,"guid",None)? != url {
            return Err(format!("RSS link/GUID/order mismatch at item {}",index+1));
        }
        if value(*item,"title",None)?.chars().count() <= 15 ||
           value(*item,"description",None)?.chars().count() <= 30 {
            return Err("RSS article title or description too short".into());
        }
        let published = value(*item,"pubDate",None)?;
        let date = DateTime::parse_from_rfc2822(&published)
            .map_err(|e| format!("Invalid RSS pubDate: {e}"))?;
        if date.with_timezone(&Utc).year() != 2026 { return Err("Unexpected publication year".into()); }
        if value(*item,"creator",Some(DC_NS))? != "Alex Mills" {
            return Err("Missing namespaced author attribution".into());
        }
        if !seen.insert(url) { return Err("Duplicate RSS URL".into()); }
    }
    let doc = xml(sitemap)?;
    let map = doc.root_element();
    if !named(map,"urlset",Some(MAP_NS)) { return Err("Bad sitemap namespace".into()); }
    let mut urls = HashSet::new();
    for node in map.children().filter(|n| named(*n,"url",Some(MAP_NS))) {
        urls.insert(value(node,"loc",Some(MAP_NS))?);
    }
    for url in seen {
        if !urls.contains(&url) { return Err(format!("Missing sitemap URL: {url}")); }
    }
    if !urls.contains(&format!("{ORIGIN}/logs/")) { return Err("Missing log archive".into()); }
    Ok(())
}
fn read(path: &Path) -> Check<String> {
    let bytes = fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if bytes.len() > 2_000_000 { return Err("XML exceeds size limit".into()); }
    String::from_utf8(bytes).map_err(|e| format!("Non-UTF-8 XML: {e}"))
}
fn main() {
    let args: Vec<_> = env::args().collect();
    if args.len() != 3 { eprintln!("Usage: rss-validator rss.xml sitemap.xml"); std::process::exit(2); }
    if let Err(e) = validate(&read(Path::new(&args[1])).unwrap_or_else(|e| fail(e)),
                             &read(Path::new(&args[2])).unwrap_or_else(|e| fail(e))) {
        eprintln!("RSS validation failed: {e}");
        std::process::exit(1);
    }
    println!("PASS RSS (Rust): ten XML-valid entries and correct sitemap");
}
fn fail(err: String) -> ! {
    eprintln!("RSS input invalid: {err}");
    std::process::exit(1);
}
#[cfg(test)]
mod tests;
