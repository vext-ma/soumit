/**
 * A webhook receiver that does the four things a real one must.
 *
 *   node examples/node/webhook-receiver.js
 *   # then point an endpoint at http://<your-host>/hooks/soumit
 *
 * Requires Node 18+. No dependencies.
 *
 * The four things:
 *
 *   1. Verify over the RAW bytes, before any JSON parse. Re-serialising
 *      changes whitespace and key order, and the MAC will not match.
 *   2. Compare in constant time. `===` on a hex string leaks the correct
 *      value one byte at a time.
 *   3. Reject stale timestamps. Without a tolerance check a valid signature
 *      is valid forever and a captured delivery can be replayed at will.
 *   4. Deduplicate on X-Soumit-Event-Id. Delivery is at-least-once, so
 *      duplicates are normal operation rather than an incident.
 *
 * ...plus one more that is really about your uptime: respond 2xx immediately
 * and do the work afterwards. Working inline turns a slow downstream into a
 * retry storm on top of an already-slow system.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = process.env.PORT || 3000;
const SIGNING_SECRET = process.env.SOUMIT_WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 300;

if (!SIGNING_SECRET) {
  console.error("Set SOUMIT_WEBHOOK_SECRET — shown once, when the endpoint was created.");
  process.exit(1);
}

/**
 * In production this belongs in Redis or a table with a TTL, not in memory:
 * a process restart must not make you reprocess a day of events.
 */
const seenEventIds = new Set();

function verifySignature(header, rawBody) {
  if (!header) return false;

  const parts = Object.fromEntries(
    header
      .split(",")
      .map((piece) => {
        const index = piece.indexOf("=");
        return index > 0
          ? [piece.slice(0, index).trim(), piece.slice(index + 1).trim()]
          : null;
      })
      .filter(Boolean),
  );

  const { t: timestamp, v1: signature } = parts;
  if (!timestamp || !signature) return false;

  // (3) Replay defence.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  // (1) MAC over "<t>.<raw body>", raw bytes.
  const expected = createHmac("sha256", SIGNING_SECRET)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");

  // (2) Constant time.
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleEvent(event) {
  switch (event.type) {
    case "analysis.completed":
      // The event says the analysis finished — not that it is trustworthy.
      // Fetch it and read quality.tier before letting it drive anything.
      console.log("  analysis completed for", event.resource.id);
      break;

    case "verdict.changed":
      console.log("  verdict changed on", event.resource.id, event.data);
      break;

    case "tender.deadline_approaching":
      console.log("  deadline approaching:", event.resource.id, event.data);
      break;

    case "award.published":
      console.log("  award published for", event.resource.id);
      break;

    default:
      // Unknown types are added without a version bump. Ignore, do not throw.
      console.log("  unhandled event type:", event.type);
  }
}

const server = createServer((request, response) => {
  if (request.method !== "POST" || !request.url.startsWith("/hooks/soumit")) {
    response.writeHead(404).end();
    return;
  }

  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const rawBody = Buffer.concat(chunks);

    if (!verifySignature(request.headers["x-soumit-signature"], rawBody)) {
      console.warn("rejected: bad or stale signature");
      response.writeHead(400).end("invalid signature");
      return;
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      response.writeHead(400).end("invalid json");
      return;
    }

    const eventId = request.headers["x-soumit-event-id"];
    const attempt = request.headers["x-soumit-attempt"];

    // (4) Deduplicate. Still answer 200 — a duplicate is not an error, and a
    // non-2xx would earn us the whole retry schedule for nothing.
    if (seenEventIds.has(eventId)) {
      console.log(`duplicate ${eventId} (attempt ${attempt}) — acknowledged, not reprocessed`);
      response.writeHead(200).end("ok");
      return;
    }
    seenEventIds.add(eventId);

    // Acknowledge first, work after.
    response.writeHead(200).end("ok");

    console.log(`${event.type} ${eventId} (attempt ${attempt})`);
    handleEvent(event).catch((error) => {
      // We already returned 200, so there is no retry coming. Anything that
      // can fail here needs its own queue and its own retry.
      console.error("  handler failed:", error);
    });
  });
});

server.listen(PORT, () => {
  console.log(`listening on :${PORT} — POST /hooks/soumit`);
});
