/**
 * Shared GTM / dataLayer helper.
 *
 * The Google Tag Manager container in Layout.astro creates `window.dataLayer`
 * before any page script runs, so every event pushed here is immediately
 * available as a GTM trigger. Pushes are always plain `{ event, ...params }`
 * objects — GTM reads `event` as the trigger name and the rest as variables.
 */

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

/** Push one analytics event. Safe to call before GTM finishes loading. */
export function trackEvent(event: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}

/**
 * Wire every `[data-track="request-geo-audit"]` CTA on the page to the
 * `request_geo_audit_click` event. Called by each page controller so the
 * listener is bound exactly once per page load.
 */
export function bindGeoAuditCtaTracking(): void {
  document.querySelectorAll<HTMLElement>('[data-track="request-geo-audit"]').forEach((el) => {
    el.addEventListener('click', () => {
      const label = (el.dataset.trackLabel || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      trackEvent('request_geo_audit_click', { page: window.location.pathname, label });
    });
  });
}
