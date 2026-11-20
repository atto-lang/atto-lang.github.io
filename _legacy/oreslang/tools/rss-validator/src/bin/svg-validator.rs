use roxmltree::{Document, Node};
use std::{collections::HashSet, env, fs, path::Path};
type Check<T> = Result<T, String>;
const NS: &str = "http://www.w3.org/2000/svg";
const LIMIT: usize = 2 * 1024 * 1024;
fn svg(node: Node<'_, '_>, name: &str) -> bool {
    node.is_element() && node.tag_name().namespace() == Some(NS) && node.tag_name().name() == name
}
fn validate(bytes: &[u8], path: &str) -> Check<()> {
    if bytes.len() > LIMIT { return Err(format!("{path}: SVG exceeds 2 MiB")); }
    let text = std::str::from_utf8(bytes).map_err(|_| format!("{path}: invalid UTF-8"))?;
    let lower = text.to_ascii_lowercase();
    if lower.contains("<!doctype") || lower.contains("<!entity") {
        return Err(format!("{path}: DTD/entity declarations prohibited"));
    }
    let doc = Document::parse(text).map_err(|e| format!("{path}: invalid XML: {e}"))?;
    let root = doc.root_element();
    if !svg(root,"svg") { return Err(format!("{path}: invalid SVG namespace")); }
    // SVG XML processing instructions can load off-site stylesheets.
    if doc.descendants().any(|n| n.is_pi()) {
        return Err(format!("{path}: XML processing instructions prohibited"));
    }
    if root.attribute("role") != Some("img") { return Err(format!("{path}: role=img required")); }
    let view = root.attribute("viewBox").ok_or("viewBox required")?;
    let nums: Result<Vec<f64>,_> = view.split(|c: char| c.is_ascii_whitespace() || c==',')
        .filter(|s| !s.is_empty()).map(str::parse).collect();
    let nums = nums.map_err(|_| format!("{path}: invalid viewBox"))?;
    if nums.len()!=4 || nums.iter().any(|n| !n.is_finite()) || nums[2]<=0.0 || nums[3]<=0.0 {
        return Err(format!("{path}: invalid viewBox dimensions"));
    }
    let titles: Vec<_> = root.children().filter(|n| svg(*n,"title")).collect();
    let descs: Vec<_> = root.children().filter(|n| svg(*n,"desc")).collect();
    if titles.len()!=1 || titles[0].text().unwrap_or("").trim().is_empty() {
        return Err(format!("{path}: exactly one non-empty title required"));
    }
    if descs.len()!=1 || descs[0].text().unwrap_or("").trim().is_empty() {
        return Err(format!("{path}: exactly one non-empty description required"));
    }
    // Stylesheets can @import or reference external URLs outside XML attributes.
    // This site publishes diagrams with inline SVG presentation attributes only.
    let forbidden = ["script","foreignObject","image","iframe","animate","set","style"];
    let nodes: Vec<_> = root.descendants().filter(|n| n.is_element()).collect();
    let mut ids = HashSet::new();
    for node in &nodes {
        let local=node.tag_name().name();
        if node.tag_name().namespace() != Some(NS) {
            return Err(format!("{path}: non-SVG namespace forbidden"));
        }
        if forbidden.iter().any(|x| local.eq_ignore_ascii_case(x)) {
            return Err(format!("{path}: forbidden element {local}"));
        }
        if let Some(id)=node.attribute("id") {
            if !ids.insert(id.to_string()) { return Err(format!("{path}: duplicate id {id}")); }
        }
    }
    for node in &nodes {
        for attr in node.attributes() {
            let name=attr.name().to_ascii_lowercase();
            if name.starts_with("on") || ["href","src","style","base"].contains(&name.as_str()) {
                return Err(format!("{path}: prohibited attribute {name}"));
            }
            let value=attr.value();
            let lower=value.to_ascii_lowercase();
            if lower.contains("@import") {
                return Err(format!("{path}: CSS imports forbidden"));
            }
            let mut cursor=0;
            while let Some(found)=lower[cursor..].find("url(") {
                let start=cursor+found+4;
                let end=lower[start..].find(')').map(|n| start+n).ok_or("unterminated url()")?;
                let target=value[start..end].trim().trim_matches('"');
                if !target.starts_with('#') || target.len()<2 || !ids.contains(&target[1..]) {
                    return Err(format!("{path}: external, malformed, or unresolved URL reference"));
                }
                cursor=end+1;
            }
        }
    }
    Ok(())
}
fn main() {
    let files: Vec<_> = env::args().skip(1).collect();
    if files.is_empty() { eprintln!("usage: svg-validator <file.svg>..."); std::process::exit(2); }
    for file in files {
        let bytes=fs::read(Path::new(&file)).unwrap_or_else(|e| {
            eprintln!("{file}: {e}"); std::process::exit(1)
        });
        if let Err(e)=validate(&bytes,&file) { eprintln!("{e}"); std::process::exit(1); }
        println!("PASS {file}: accessible, self-contained SVG");
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    const GOOD: &[u8]=br#"<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 100 100"><title>Title</title><desc>Description</desc><defs><linearGradient id="paint"/></defs><rect fill="url(#paint)"/></svg>"#;
    #[test] fn accepts_valid_diagram(){assert!(validate(GOOD,"fixture.svg").is_ok());}
    #[test] fn rejects_malformed_xml(){assert!(validate(b"<svg>","fixture.svg").is_err());}
    #[test] fn rejects_wrong_namespace(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("http://www.w3.org/2000/svg","urn:bad");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_missing_role(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace(" role=\"img\"","");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_missing_title(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("<title>Title</title>","");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_script(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("</svg>","<script/></svg>");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_event_handler(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("<rect ","<rect onload=\"x\" ");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_external_reference(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("url(#paint)","url(https://example.invalid/x)");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_dangling_reference(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("url(#paint)","url(#missing)");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_bad_viewbox(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("0 0 100 100","0 0 -1 100");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_oversized(){assert!(validate(&vec![b' ';LIMIT+1],"large.svg").is_err());}
    #[test] fn rejects_invalid_utf8(){assert!(validate(&[0xff,0xfe],"bad.svg").is_err());}
    #[test] fn rejects_embedded_stylesheet(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("</svg>","<style>@import url(https://evil.invalid/a.css);</style></svg>");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_style_attributes(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("<rect ","<rect style=\"fill:url(https://evil.invalid/a)\" ");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_xml_stylesheet_pi(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("<svg ","<?xml-stylesheet href=\"https://evil.invalid/a.css\"?><svg ");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_xml_base(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("<rect ","<rect xml:base=\"https://evil.invalid/\" ");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
    #[test] fn rejects_foreign_namespace(){let s=String::from_utf8(GOOD.to_vec()).unwrap().replace("</svg>","<evil:foreign xmlns:evil=\"urn:evil\"/></svg>");assert!(validate(s.as_bytes(),"fixture.svg").is_err());}
}
