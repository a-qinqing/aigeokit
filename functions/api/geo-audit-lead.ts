/**
 * Cloudflare Pages Function — POST /api/geo-audit-lead
 *
 * Receives a GEO Audit request (email + optional website) from /geo-audit/,
 * validates it server-side and forwards it to the webhook configured in the
 * `GEO_AUDIT_WEBHOOK` environment variable (Lark/飞书, Slack, Zapier,
 * Formspree — anything that accepts a JSON POST).
 *
 * Without that variable the request is still accepted and written to the
 * Pages log, so the endpoint is useful the moment the page ships. Set the
 * variable in the Cloudflare Pages dashboard to start receiving leads.
 *
 * Deliberately does not store anything itself: no database, no KV, no
 * third-party SDK — just one outbound POST to a destination you control.
 */

const MAX_BODY_BYTES = 8_000;
const WEBHOOK_TIMEOUT_MS = 6_000;

/** Pragmatic shape check — the webhook destination is the real validator. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

type ApiErrorCode = 'invalid-body' | 'invalid-email' | 'spam' | 'forward-failed';

interface ApiOk {
  ok: true;
  /** True when the lead reached GEO_AUDIT_WEBHOOK; false when it was only logged. */
  forwarded: boolean;
}

interface ApiErr {
  ok: false;
  error: ApiErrorCode;
  message: string;
  /** Short, sanitized reason from the webhook — makes a silent rejection
   *  (HTTP 200 + error code in the body) debuggable from the outside. */
  detail?: string;
}

function json(body: ApiOk | ApiErr, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Strip control characters and cap length — this value ends up in a webhook payload. */
function clean(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength);
}

interface Lead {
  email: string;
  website: string;
  note: string;
  page: string;
  referer: string;
  received_at: string;
}

/** Lark/飞书 custom bots only accept `{ msg_type, content: { text } }` — a
 *  Slack-shaped body is rejected. Pick the shape from the webhook host. */
function isLarkWebhook(url: string): boolean {
  return /(^|\/\/)([a-z0-9-]+\.)*(open\.feishu\.cn|open\.larksuite\.com)\//i.test(url);
}

function buildPayload(webhook: string, lead: Lead): Record<string, unknown> {
  const text = [
    `New GEO Audit request — ${lead.email}`,
    lead.website ? `Website: ${lead.website}` : 'Website: (not given)',
    `Received: ${lead.received_at}`,
  ].join('\n');

  if (isLarkWebhook(webhook)) return { msg_type: 'text', content: { text } };
  return { text, lead };
}

/**
 * A 2xx is not proof of delivery: Lark answers HTTP 200 with a non-zero `code`
 * in the body, and Slack answers 200 with `{ ok: false }`. Returns a short
 * reason when the webhook rejected the message, or null when it accepted.
 */
function rejectionReason(status: number, body: string): string | null {
  if (status < 200 || status >= 300) return `HTTP ${status}`;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null; // plain-text 2xx from a generic endpoint — treat as accepted
  }

  if (typeof parsed.code === 'number' && parsed.code !== 0) {
    const msg = typeof parsed.msg === 'string' ? `: ${parsed.msg}` : '';
    return `code ${parsed.code}${msg}`;
  }
  if (parsed.ok === false) {
    return typeof parsed.error === 'string' ? `ok:false (${parsed.error})` : 'ok:false';
  }
  return null;
}

interface LeadBody {
  email?: unknown;
  website?: unknown;
  note?: unknown;
  /** Honeypot — real visitors never fill a field they cannot see. */
  company?: unknown;
}

export async function onRequestPost({
  request,
  env,
}: {
  request: Request;
  env: { GEO_AUDIT_WEBHOOK?: string };
}): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'invalid-body', message: 'Request body too large.' }, 413);
  }

  let body: LeadBody;
  try {
    body = JSON.parse(raw) as LeadBody;
  } catch {
    return json({ ok: false, error: 'invalid-body', message: 'Expected a JSON body.' }, 400);
  }

  if (clean(body.company, 100)) {
    // Bot filled the honeypot: answer like a success so it has nothing to learn.
    return json({ ok: true, forwarded: false });
  }

  const email = clean(body.email, 254);
  const website = clean(body.website, 300);
  const note = clean(body.note, 1_000);

  if (!EMAIL_RE.test(email)) {
    return json(
      { ok: false, error: 'invalid-email', message: 'Enter a valid email address.' },
      400,
    );
  }

  const lead: Lead = {
    email,
    website,
    note,
    page: 'https://www.aigeokit.com/geo-audit/',
    referer: clean(request.headers.get('referer'), 300),
    received_at: new Date().toISOString(),
  };

  const webhook = env.GEO_AUDIT_WEBHOOK;
  if (!webhook) {
    // Not configured yet — keep the lead discoverable in the Pages log.
    console.log('geo-audit-lead (GEO_AUDIT_WEBHOOK unset)', JSON.stringify(lead));
    return json({ ok: true, forwarded: false });
  }

  const payload = buildPayload(webhook, lead);

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    // Read the body even on 2xx: Lark reports failures in the payload.
    const reason = rejectionReason(res.status, (await res.text()).slice(0, 500));
    if (reason) throw new Error(`webhook rejected: ${reason}`);
  } catch (err) {
    const detail = clean(err instanceof Error ? err.message : String(err), 160);
    console.error('geo-audit-lead forward failed', detail, JSON.stringify(lead));
    return json(
      {
        ok: false,
        error: 'forward-failed',
        message: 'We could not record your request just now — please try again in a moment.',
        detail,
      },
      502,
    );
  }

  return json({ ok: true, forwarded: true });
}
