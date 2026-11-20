"""Validate generated RSS and sitemap using Python's standard-library XML parser."""
from datetime import timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree

dist = Path(__file__).resolve().parents[1] / "dist"
feed = ElementTree.parse(dist / "rss.xml").getroot()
assert feed.tag == "rss" and feed.attrib.get("version") == "2.0"
channel = feed.find("channel")
assert channel is not None
assert channel.findtext("title") == "AttoLang engineering logs"
assert channel.findtext("link") == "https://ores-truffle-oreslang.github.io/logs/"
items = channel.findall("item")
assert len(items) == 10, f"Expected ten articles, found {len(items)}"
links = []
for index, item in enumerate(items):
    number = 10 - index
    expected_url = f"https://ores-truffle-oreslang.github.io/logs/{number}/"
    assert item.findtext("link") == expected_url
    assert item.findtext("guid") == expected_url
    assert item.findtext("title") and len(item.findtext("title")) > 15
    assert item.findtext("description") and len(item.findtext("description")) > 30
    published = parsedate_to_datetime(item.findtext("pubDate"))
    assert published is not None and published.tzinfo is not None
    assert published.astimezone(timezone.utc).year == 2026
    assert item.findtext("{http://purl.org/dc/elements/1.1/}creator") == "Alex Mills"
    links.append(expected_url)
assert len(set(links)) == 10

sitemap = ElementTree.parse(dist / "sitemap.xml").getroot()
ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
locations = {node.text for node in sitemap.findall(".//s:loc", ns)}
assert set(links).issubset(locations), "Some feed entries are missing from sitemap"
assert "https://ores-truffle-oreslang.github.io/logs/" in locations
print("PASS RSS: ten XML-valid, dated, unique articles with matching sitemap URLs")
