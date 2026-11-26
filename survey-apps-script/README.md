# Contributor survey email service
The public UI is at /survey/. Apps Script is not served by Pages. The frontend is deliberately disabled until a valid deployed endpoint is configured.

1. In https://script.google.com/ create a standalone Apps Script project owned by the intended sender. Copy Code.gs and appsscript.json (enable manifest visibility in Project Settings).
2. Review the code. Set the script property SURVEY_ENABLED to true only when ready to accept submissions. For a public anonymous endpoint, arrange additional abuse protection (e.g. verified identity or server-verified CAPTCHA); the included global 20/day and one/email/day limits reduce but do not eliminate abuse. Restrict access to signed-in Google users if that fits the audience. No credentials belong in GitHub.
3. Deploy > New deployment > Web app. Execute as the owner; select access appropriate for respondents. Authorize MailApp. Copy the deployed /exec URL (not /dev).
4. Replace the empty ENDPOINT string in survey/survey.js with the exact HTTPS /exec URL. Submit the change through normal Pages review and release gates.
5. Submit an authorized test using your own email; confirm the team inbox and CC receive the HTML/plain-text email and that the browser shows the Apps Script receipt. Verify invalid payloads and repeated addresses are rejected. Never test with uninvolved third-party addresses.

No public response database is created. Rate limiting stores only UTC day, total reservations and SHA-256 email hashes in Script Properties; reset/delete SURVEY_RATE as needed. Apps Script mail quota and access policy depend on the deployment account. A successful MailApp call is not a guarantee of inbox delivery. A failed send after reservation consumes that email's daily slot; admin can investigate and reset the rate key if appropriate. Public deployment is intentionally a separate operational action.

## Ranked topic catalog
The browser and Apps Script accept the same 20 stable topic IDs; applicants still choose exactly five distinct topics and provide a 1–10 skill rating for each. The existing 12 IDs and payload version 1 are unchanged. The new IDs are `real-time`, `zero-gc`, `arena-allocation`, `target-architectures`, `hdl-fpga`, `soa-layout`, `jit-tracing`, `native-aot`. Both email formats preserve rank order and display the catalog labels. Deploy an updated Apps Script version before exposing the expanded browser catalog; the previous server version rejects the new IDs. No external ATS ingestion is configured by this repository.
