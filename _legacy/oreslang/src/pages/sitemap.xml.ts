import type { APIRoute } from "astro";

// Discover static Astro pages from the source tree, so adding a page automatically
// adds its canonical route instead of relying on a manually maintained list.
const pages = Object.keys(import.meta.glob("./**/*.astro"));

export const GET: APIRoute = ({ site }) => {
  if (!site) {
    return new Response("Site URL must be configured", { status: 500 });
  }

  const urls = pages
    .map((file) => {
      const path = file
        .replace(/^\.\//, "")
        .replace(/^index\.astro$/, "")
        .replace(/\/index\.astro$/, "/")
        .replace(/\.astro$/, "/");
      return new URL("/" + path, site).href;
    })
    .sort();

  const uniqueUrls = [...new Set(urls)];
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...uniqueUrls.map((url) => '  <url><loc>' + url.replace(/&/g, "&amp;") + '</loc></url>'),
    "</urlset>",
  ].join("\n");

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
