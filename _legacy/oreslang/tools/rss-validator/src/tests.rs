use super::*;
fn fixtures() -> (String, String) {
  let mut articles = String::new();
  let mut locations = format!("<url><loc>{ORIGIN}/logs/</loc></url>");
  for number in (1..=10).rev() {
    let url = format!("{ORIGIN}/logs/{number}/");
    articles.push_str(&format!(
      r#"<item><title>AttoLang engineering update {number}</title><link>{url}</link><guid>{url}</guid><description>Architecture, actors and systems compiler engineering.</description><pubDate>Thu, 08 Oct 2026 12:00:00 GMT</pubDate><dc:creator>Alex Mills</dc:creator></item>"#
    ));
    locations.push_str(&format!("<url><loc>{url}</loc></url>"));
  }
  (format!(r#"<rss version="2.0" xmlns:dc="{DC_NS}"><channel><title>AttoLang engineering logs</title><link>{ORIGIN}/logs/</link>{articles}</channel></rss>"#),
   format!(r#"<urlset xmlns="{MAP_NS}">{locations}</urlset>"#))
}
#[test] fn valid_feed() { let (a,b)=fixtures(); assert!(validate(&a,&b).is_ok()); }
#[test] fn malformed_xml() { let (a,b)=fixtures(); assert!(validate(&a.replace("</rss>",""),&b).is_err()); }
#[test] fn invalid_escaping() { let (a,b)=fixtures(); assert!(validate(&a.replace("AttoLang engineering logs","AttoLang & logs"),&b).is_err()); }
#[test] fn duplicate_or_wrong_order() { let (a,b)=fixtures(); assert!(validate(&a.replace("/logs/8/","/logs/9/"),&b).is_err()); }
#[test] fn bad_publication_date() { let (a,b)=fixtures(); assert!(validate(&a.replace("Thu, 08 Oct 2026 12:00:00 GMT","invalid"),&b).is_err()); }
#[test] fn wrong_publication_year() { let (a,b)=fixtures(); assert!(validate(&a.replace("Oct 2026","Oct 2025"),&b).is_err()); }
#[test] fn wrong_author_namespace() { let (a,b)=fixtures(); assert!(validate(&a.replace(DC_NS,"https://wrong.invalid"),&b).is_err()); }
#[test] fn missing_sitemap_entry() {
  let (a,b)=fixtures();
  let row=format!("<url><loc>{ORIGIN}/logs/9/</loc></url>");
  assert!(validate(&a,&b.replace(&row,"")).is_err());
}
#[test] fn wrong_sitemap_namespace() { let (a,b)=fixtures(); assert!(validate(&a,&b.replace(MAP_NS,"https://wrong.invalid")).is_err()); }
#[test] fn huge_document() { let (a,b)=fixtures(); assert!(validate(&(a+" "+&"x".repeat(2_000_000)),&b).is_err()); }
