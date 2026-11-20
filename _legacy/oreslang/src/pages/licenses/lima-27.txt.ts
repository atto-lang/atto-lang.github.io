import type { APIRoute } from "astro";
import { lima27LicenseText } from "../../data/lima27.mjs";

export const GET: APIRoute = () => new Response(lima27LicenseText + "\n", {
  headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": 'inline; filename="LIMA-27.txt"',
    "X-Content-Type-Options": "nosniff",
  },
});
