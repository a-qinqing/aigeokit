/**
 * Contact form — page controller for /contact/.
 *
 * Reuses the existing first-party /api/geo-audit-lead Pages Function with
 * `kind: 'contact'`, so messages are delivered through the same monitored
 * webhook as GEO Audit requests. The message text is sent as `note` and the
 * endpoint forwards it; nothing is stored by the site itself.
 *
 * All element ids are prefixed `ct-` to stay globally unique.
 */

import { trackEvent } from './analytics';

/* ------------------------------ DOM helpers ----------------------------- */

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

/* ------------------------------- Elements ------------------------------- */

const form = $('ct-form') as HTMLFormElement;
const emailInput = $('ct-email') as HTMLInputElement;
const messageInput = $('ct-message') as HTMLTextAreaElement;
const honeypot = $('ct-company') as HTMLInputElement;
const submitBtn = $('ct-submit') as HTMLButtonElement;
const errorEl = $('ct-error');
const successEl = $('ct-success');
const successEmail = $('ct-success-email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const MAX_MESSAGE = 1_000;

function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

/* ------------------------------- Submit --------------------------------- */

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const note = messageInput.value.trim();
  errorEl.hidden = true;

  if (!EMAIL_RE.test(email)) {
    showError('Enter a valid email address so we can reply.');
    trackEvent('contact_submit', { page: '/contact/', status: 'invalid-email' });
    emailInput.focus();
    return;
  }

  if (!note) {
    showError('Enter a message.');
    trackEvent('contact_submit', { page: '/contact/', status: 'empty-message' });
    messageInput.focus();
    return;
  }

  if (note.length > MAX_MESSAGE) {
    showError(`Keep your message under ${MAX_MESSAGE} characters.`);
    trackEvent('contact_submit', { page: '/contact/', status: 'message-too-long' });
    messageInput.focus();
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
        kind: 'contact',
        email,
        note,
        company: honeypot.value, // honeypot: empty for real visitors
      }),
    });

    const data = (await res.json()) as
      | { ok: true; forwarded: boolean }
      | { ok: false; error: string; message?: string };

    if (!res.ok || !data.ok) {
      throw new Error('message' in data && data.message ? data.message : 'Request failed.');
    }

    trackEvent('contact_submit', {
      page: '/contact/',
      status: 'success',
      forwarded: data.forwarded,
    });

    successEmail.textContent = email;
    form.hidden = true;
    successEl.hidden = false;
    successEl.focus();
  } catch (err) {
    showError(
      err instanceof Error && err.message !== 'Failed to fetch'
        ? err.message
        : 'We could not send your message — please try again in a moment.',
    );
    trackEvent('contact_submit', { page: '/contact/', status: 'error' });
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});
