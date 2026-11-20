import type { APIRoute } from "astro";
import { engineeringLogs } from "../data/engineering-logs.mjs";

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const rfc822 = (date: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00Z` : date).toUTCString();

export const GET: APIRoute = ({ site }) => {
  if (!site) return new Response("Site URL must be configured", { status: 500 });

  const root = new URL("/", site);
  const items = engineeringLogs.map((entry) => {
    const canonical = new URL(`/logs/${entry.number}/`, root).href;
    return [
      "    <item>",
      `      <title>${escapeXml(entry.title)}</title>`,
      `      <link>${escapeXml(canonical)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(canonical)}</guid>`,
      `      <description>${escapeXml(entry.summary)}</description>`,
      `      <pubDate>${rfc822(entry.publishedAt)}</pubDate>`,
      `      <dc:creator>${escapeXml(entry.author)}</dc:creator>`,
      "    </item>",
    ].join("\n");
  }).join("\n");
  const feedUrl = new URL("/rss.xml", root).href;
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    "    <title>AttoLang engineering logs</title>",
    `    <link>${escapeXml(new URL("/logs/", root).href)}</link>`,
    "    <description>Architecture notes, engineering decisions, and open design questions from AttoLang. Posts may describe proposals rather than shipped language features.</description>",
    `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    "    <language>en</language>",
    `    <lastBuildDate>${rfc822(engineeringLogs[0].modified)}</lastBuildDate>`,
    items,
    "  </channel>",
    "</rss>",
  ].join("\n");

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
};
