/**
 * GEO Audit request form — page controller for /geo-audit/.
 *
 * Validates the email locally, POSTs { email, website } to the
 * /api/geo-audit-lead Pages Function (which forwards to GEO_AUDIT_WEBHOOK)
 * and swaps the form for a confirmation panel. No payment, no third-party
 * script — the only outbound call is our own first-party endpoint.
 *
 * All element ids are prefixed `ga-` to stay globally unique.
 */

import { trackEvent } from './analytics';

/* ------------------------------ DOM helpers ----------------------------- */

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

/* ------------------------------- Elements ------------------------------- */

const form = $('ga-form') as HTMLFormElement;
const emailInput = $('ga-email') as HTMLInputElement;
const websiteInput = $('ga-website') as HTMLInputElement;
const honeypot = $('ga-company') as HTMLInputElement;
const submitBtn = $('ga-submit') as HTMLButtonElement;
const errorEl = $('ga-error');
const successEl = $('ga-success');
const successEmail = $('ga-success-email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Shared by the invalid-email and request-failed paths. */
function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

/* ------------------------------- Submit --------------------------------- */

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  errorEl.hidden = true;

  if (!EMAIL_RE.test(email)) {
    showError('Enter a valid email address so we can send your report.');
    trackEvent('lead_submit', { page: '/geo-audit/', status: 'invalid' });
    emailInput.focus();
    return;
  }

  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = 'Sending…';

  try {
    const res = await fetch('/api/geo-audit-lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        website: websiteInput.value.trim(),
        company: honeypot.value, // honeypot: empty for real visitors
      }),
    });

    const data = (await res.json()) as
      | { ok: true; forwarded: boolean }
      | { ok: false; error: string; message?: string };

    if (!res.ok || !data.ok) {
      throw new Error('message' in data && data.message ? data.message : 'Request failed.');
    }

    trackEvent('lead_submit', {
      page: '/geo-audit/',
      status: 'success',
      forwarded: data.forwarded,
    });

    successEmail.textContent = email;
    form.hidden = true;
    successEl.hidden = false;
    successEl.focus();
  } catch (err) {
    // Covers a non-JSON 404 (Pages Functions are not served by `astro dev`),
    // a webhook failure, and offline visitors alike.
    showError(
      err instanceof Error && err.message !== 'Failed to fetch'
        ? err.message
        : 'We could not send your request — please try again in a moment.',
    );
    trackEvent('lead_submit', { page: '/geo-audit/', status: 'error' });
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});
