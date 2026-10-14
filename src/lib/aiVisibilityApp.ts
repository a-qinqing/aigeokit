/**
 * AI Visibility Checker — landing-page controller.
 *
 * Phase one is intentionally demo-only: no backend, no third-party API calls,
 * no crawling. The hero form validates the entered URL locally, swaps the
 * sample report's domain label and reveals the demo score card. Live AI
 * visibility analysis is not part of this release.
 *
 * All element ids are prefixed `aiv-` to stay globally unique.
 */

import { bindGeoAuditCtaTracking, trackEvent } from './analytics';

/* ------------------------------ DOM helpers ----------------------------- */

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

/* ------------------------------- Elements ------------------------------- */

const form = $('aiv-form') as HTMLFormElement;
const input = $('aiv-url') as HTMLInputElement;
const statusEl = $('aiv-status');
const errorEl = $('aiv-error');
const demoDomain = $('aiv-demo-domain');
const scoreDomain = $('aiv-score-domain');
const scoreCard = $('aiv-score-card');

/* ------------------------------ URL parsing ----------------------------- */

/** Normalize user input into a hostname, or null when it is not a usable URL. */
function toHostname(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes('.') || /\s/.test(url.hostname)) return null;
    return url.hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

/* ------------------------------ Demo report ----------------------------- */

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const host = toHostname(input.value);
  trackEvent('analyze_visibility_click', {
    page: '/ai-visibility-checker/',
    valid_url: Boolean(host),
  });
  if (!host) {
    errorEl.textContent =
      'Enter a website URL such as https://example.com — or just example.com.';
    errorEl.hidden = false;
    statusEl.hidden = true;
    input.focus();
    return;
  }

  errorEl.hidden = true;
  demoDomain.textContent = host;
  scoreDomain.textContent = host;
  statusEl.hidden = false;

  // Draw the eye to the sample report without pretending a crawl happened.
  scoreCard.classList.add('aiv-reveal');
  window.setTimeout(() => scoreCard.classList.remove('aiv-reveal'), 1800);
  scoreCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ------------------------- Conversion tracking -------------------------- */

bindGeoAuditCtaTracking();
