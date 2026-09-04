import { TOOLS } from './tools';
import { GENERATORS } from './generators';
import { ADAPTERS, PLATFORM_LABELS } from './adapters';
import { runGeoChecklist, type ChecklistItem } from './geoChecklist';
import type {
  FieldDef,
  FormValues,
  PlatformId,
  RepeatRowField,
  RepeatValue,
  ToolId,
} from './types';

/**
 * Client-side controller. The page is 100% static HTML + this module:
 * no framework, no API calls — form state drives the generators, the
 * platform adapters and the GEO checklist via simple render functions.
 */

interface State {
  tool: ToolId;
  values: FormValues;
  platform: PlatformId;
}

const state: State = {
  tool: 'article',
  values: {},
  platform: 'raw',
};

/* ---------- DOM helpers ---------- */

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------- form state ---------- */

const makeEmptyRow = (f: FieldDef): RepeatValue =>
  (f.rows ?? []).reduce<RepeatValue>((acc, rf) => ({ ...acc, [rf.key]: '' }), {});

function initValues(tool: ToolId): FormValues {
  // Start from field defaults, then let the tool's example payload win where
  // it provides a value (repeat rows keep their example rows intact).
  const values: FormValues = {};
  for (const f of TOOLS[tool].fields) {
    if (f.type === 'repeat') values[f.key] = [makeEmptyRow(f)];
    else if (f.type === 'checkbox') values[f.key] = f.default === true;
    else values[f.key] = f.default !== undefined ? String(f.default) : '';
  }
  for (const [key, val] of Object.entries(TOOLS[tool].example)) {
    if (Array.isArray(val)) {
      if (val.length > 0) values[key] = val; // repeat rows: keep example rows
    } else if (key in values) {
      values[key] = val; // scalars / checkboxes: example wins
    } else {
      values[key] = val;
    }
  }
  return values;
}

function getRepeat(v: FormValues, key: string): RepeatValue[] {
  const x = v[key];
  return Array.isArray(x) ? x : [];
}

function setRepeat(v: FormValues, key: string, rows: RepeatValue[]): void {
  v[key] = rows;
}

/* ---------- form rendering ---------- */

const GROUP_LABELS: Record<string, string> = {
  main: 'Content',
  author: 'Author',
  publisher: 'Publisher & brand',
  citation: 'Citations',
  rating: 'Ratings & reviews',
  offers: 'Offer & pricing',
  address: 'Address',
  geo: 'Map & hours',
  faq: 'Questions & answers',
  steps: 'Steps & materials',
  links: 'Entity links',
};

const inputCls =
  'w-full rounded-lg border border-ink-600/70 bg-ink-850 px-3 py-2 text-sm text-sand-100 ' +
  'placeholder:text-sand-500 focus:border-mint-400 focus:outline-none transition-colors';

function repeatRow(f: FieldDef, row: RepeatValue, i: number): string {
  const fields = (f.rows ?? []).length ? (f.rows as RepeatRowField[]) : [{ key: 'value', type: 'text' as const }];
  const controls = fields
    .map((rf) => {
      const value = row[rf.key] ?? '';
      const span = rf.span === 'half' ? 'md:col-span-1' : 'md:col-span-2';
      const control =
        rf.type === 'textarea'
          ? `<textarea rows="2" class="${inputCls}" data-rf="${esc(rf.key)}" placeholder="${esc(rf.placeholder ?? '')}">${esc(value)}</textarea>`
          : `<input type="${rf.type}" class="${inputCls}" data-rf="${esc(rf.key)}" value="${esc(value)}" placeholder="${esc(rf.placeholder ?? '')}"/>`;
      return `
        <div class="${span}">
          ${rf.label ? `<span class="mb-1 block text-[11px] font-medium uppercase tracking-wide text-sand-500">${esc(rf.label)}</span>` : ''}
          ${control}
        </div>`;
    })
    .join('');

  return `
    <div class="repeat-row grid grid-cols-1 gap-2 rounded-lg border border-ink-700 bg-ink-900 p-3 md:grid-cols-2"
         data-repeat-key="${esc(f.key)}" data-row="${i}">
      ${controls}
      <button type="button" class="remove-row self-end justify-self-end rounded-md px-2 py-1 text-xs text-sand-500 hover:text-red-400 transition-colors" aria-label="Remove row">
        ✕ Remove
      </button>
    </div>`;
}

function fieldControl(f: FieldDef, value: string | boolean | RepeatValue[]): string {
  switch (f.type) {
    case 'select': {
      const options = (f.options ?? [])
        .map(
          (o) =>
            `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`,
        )
        .join('');
      return `<select class="${inputCls}" data-field="${esc(f.key)}">${options}</select>`;
    }
    case 'checkbox':
      return `
        <label class="inline-flex cursor-pointer items-center gap-2 text-sm text-sand-100 select-none">
          <input type="checkbox" class="h-4 w-4 rounded border-ink-600 bg-ink-850 accent-mint-400" data-field="${esc(f.key)}" ${value ? 'checked' : ''}/>
          ${esc(f.label)}
        </label>`;
    case 'textarea':
      return `<textarea rows="3" class="${inputCls}" data-field="${esc(f.key)}" placeholder="${esc(f.placeholder ?? '')}">${esc(String(value ?? ''))}</textarea>`;
    case 'repeat': {
      const rows = Array.isArray(value) ? value : [];
      const rowsHtml = rows.map((r, i) => repeatRow(f, r, i)).join('');
      const addLabel =
        f.rows?.length === 1 && f.rows[0].type === 'url' ? 'profile' : 'row';
      return `
        <div class="space-y-2">
          ${rowsHtml}
          <button type="button" class="add-row rounded-lg border border-dashed border-ink-600 px-3 py-2 text-xs font-medium text-mint-300 hover:border-mint-400 transition-colors" data-repeat="${esc(f.key)}">
            + Add ${addLabel}
          </button>
        </div>`;
    }
    default:
      return `<input type="${f.type}" class="${inputCls}" data-field="${esc(f.key)}" value="${esc(String(value ?? ''))}" placeholder="${esc(f.placeholder ?? '')}"/>`;
  }
}

function renderForm(): void {
  const tool = TOOLS[state.tool];
  const groups: string[] = [];
  for (const f of tool.fields) if (!groups.includes(f.group)) groups.push(f.group);

  const html = groups
    .map(
      (g) => `
      <fieldset class="space-y-4">
        <legend class="mb-2 block text-xs font-semibold uppercase tracking-widest text-mint-400/90">
          ${GROUP_LABELS[g] ?? g}
        </legend>
        ${tool.fields
          .filter((f) => f.group === g)
          .map((f) => {
            const value = state.values[f.key];
            return `
            <div class="space-y-1.5">
              ${f.type === 'checkbox' ? '' : `<label class="block text-[13px] font-medium text-sand-300">${esc(f.label)}</label>`}
              ${fieldControl(f, value)}
              ${f.help ? `<p class="text-xs leading-relaxed text-sand-500">${esc(f.help)}</p>` : ''}
            </div>`;
          })
          .join('')}
      </fieldset>`,
    )
    .join('');

  $<HTMLElement>('#schema-form').innerHTML = html;
  $<HTMLElement>('#form-tool-name').textContent = tool.name;
}

/* ---------- output rendering ---------- */

/** Copy-button label follows the active platform (raw → JSON, WordPress → HTML snippet, Shopify → Liquid). */
const COPY_LABELS: Record<PlatformId, string> = {
  raw: 'Copy JSON-LD',
  wordpress: 'Copy HTML',
  shopify: 'Copy Liquid',
};

function currentCode(): string {
  return ADAPTERS[state.platform](GENERATORS[state.tool](state.values));
}

function renderOutput(): void {
  const code = currentCode();
  $<HTMLElement>('#output-code').textContent = code;
  $<HTMLElement>('#output-meta').textContent =
    `${code.length.toLocaleString()} chars · ${code.split('\n').length} lines · ${state.platform}`;

  document.querySelectorAll<HTMLButtonElement>('.platform-tab').forEach((btn) => {
    const active = btn.dataset.platform === state.platform;
    btn.classList.toggle('tab-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  const copyBtn = $<HTMLButtonElement>('#copy-btn');
  copyBtn.removeAttribute('data-copied');
  copyBtn.textContent = COPY_LABELS[state.platform];
}

/* ---------- GEO checklist rendering ---------- */

const STATUS_ICON: Record<ChecklistItem['status'], string> = {
  pass: '<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.8a1 1 0 0 1 1.4 0z" clip-rule="evenodd"/></svg>',
  warn: '<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M8.26 2.6a2.1 2.1 0 0 1 3.48 0l6.7 10.97a2.1 2.1 0 0 1-1.74 3.18H3.3a2.1 2.1 0 0 1-1.74-3.18L8.26 2.6zM10 7a.9.9 0 0 0-.9.9v3.1a.9.9 0 1 0 1.8 0V7.9A.9.9 0 0 0 10 7zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" clip-rule="evenodd"/></svg>',
  fail: '<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"/></svg>',
};

const STATUS_BADGE: Record<ChecklistItem['status'], string> = {
  pass: 'bg-mint-500/15 text-mint-300 border-mint-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  fail: 'bg-red-500/15 text-red-300 border-red-500/30',
};

function renderChecklist(): void {
  const items = runGeoChecklist(state.tool, state.values);
  const pass = items.filter((i) => i.status === 'pass').length;

  $<HTMLElement>('#checklist-score').textContent = `${pass}/${items.length}`;
  const bar = Math.round((pass / items.length) * 100);
  $<HTMLElement>('#checklist-bar').style.width = `${bar}%`;

  $<HTMLElement>('#checklist-list').innerHTML = items
    .map(
      (i) => `
      <li class="check-item overflow-hidden rounded-lg border border-ink-700 bg-ink-850">
        <button type="button" class="check-head flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-ink-800">
          <span class="${STATUS_BADGE[i.status]} mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border">
            ${STATUS_ICON[i.status]}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium text-sand-100">${i.label}</span>
            <span class="mt-0.5 block text-xs text-sand-500">${esc(i.detail)}</span>
          </span>
          <svg viewBox="0 0 20 20" fill="currentColor" class="chevron mt-1 h-4 w-4 shrink-0 text-sand-500 transition-transform"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd"/></svg>
        </button>
        <div class="check-reco hidden border-t border-ink-700 px-3.5 py-3">
          <p class="text-[13px] leading-relaxed text-sand-300">
            <span class="font-semibold text-mint-300">Fix: </span>${esc(i.recommendation)}
          </p>
        </div>
      </li>`,
    )
    .join('');
}

/* ---------- copy + modal ---------- */

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts / older browsers.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/**
 * Recommendation card — clean and non-intrusive. WPCode link is our
 * affiliate URL (library.wpcode.com/?ref=207).
 */
const RECO_CARD_HTML = `
  <div class="rounded-xl border border-mint-500/25 bg-mint-500/5 p-4">
    <h3 class="text-sm font-bold text-sand-100">Deploying to WordPress or Shopify?</h3>
    <p class="mt-1.5 text-[13px] leading-relaxed text-sand-300">
      Insert this JSON-LD without editing theme files using WPCode Pro.
    </p>
    <div class="mt-3.5 flex flex-wrap gap-2">
      <a href="https://library.wpcode.com/?ref=207" target="_blank" rel="noopener sponsored"
         class="rounded-lg bg-mint-500 px-3.5 py-2 text-xs font-bold text-ink-950 transition-colors hover:bg-mint-400">
        Get WPCode (Special Offer)
      </a>
    </div>
  </div>`;

let lastFocused: HTMLElement | null = null;

function openModal(platform: PlatformId): void {
  $<HTMLElement>('#modal-platform').textContent = PLATFORM_LABELS[platform];
  $<HTMLElement>('#modal-recs').innerHTML = RECO_CARD_HTML;
  lastFocused = document.activeElement as HTMLElement | null;
  const modal = $<HTMLElement>('#copy-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  $<HTMLButtonElement>('#modal-close').focus();
}

function closeModal(): void {
  const modal = $<HTMLElement>('#copy-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  lastFocused?.focus();
}

async function copyAndConfirm(): Promise<void> {
  const ok = await copyText(currentCode());
  const btn = $<HTMLButtonElement>('#copy-btn');
  if (ok) {
    btn.setAttribute('data-copied', 'true');
    btn.textContent = '✓ Copied to clipboard';
    openModal(state.platform);
  } else {
    btn.textContent = 'Copy failed — select the code manually';
  }
  window.setTimeout(() => {
    btn.textContent = COPY_LABELS[state.platform];
  }, 4000);
}

/* ---------- events ---------- */

function wireEvents(): void {
  /* tool cards */
  document.querySelectorAll<HTMLButtonElement>('.tool-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.tool as ToolId;
      if (id === state.tool) return;
      state.tool = id;
      state.values = initValues(id);
      renderForm();
      renderOutput();
      renderChecklist();
      document.querySelectorAll('.tool-card').forEach((c) =>
        c.classList.toggle('card-active', c === card),
      );
      $<HTMLElement>('#builder').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const form = $<HTMLFormElement>('#schema-form');

  /* scalar fields: live update on typing / change */
  form.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.field === undefined) return;
    state.values[t.dataset.field] = (t as HTMLInputElement).value;
    renderOutput();
    renderChecklist();
  });

  form.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.field === undefined) return;
    const el = t as HTMLInputElement;
    state.values[t.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
    renderOutput();
    renderChecklist();
  });

  /* repeat rows: updates land in the row identified by the container */
  form.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    const rowEl = t.closest<HTMLElement>('.repeat-row');
    if (!rowEl || t.dataset.rf === undefined) return;
    const key = rowEl.dataset.repeatKey;
    const idx = Number(rowEl.dataset.row);
    if (!key || Number.isNaN(idx)) return;
    const rows = getRepeat(state.values, key);
    if (!rows[idx]) return;
    rows[idx][t.dataset.rf] = (t as HTMLInputElement).value;
    renderOutput();
    renderChecklist();
  });

  form.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const add = target.closest<HTMLButtonElement>('.add-row');
    if (add) {
      const key = add.dataset.repeat ?? '';
      const f = TOOLS[state.tool].fields.find((x) => x.key === key);
      if (!f) return;
      const rows = getRepeat(state.values, key);
      rows.push(makeEmptyRow(f));
      setRepeat(state.values, key, rows);
      renderForm();
      return;
    }
    const rm = target.closest<HTMLButtonElement>('.remove-row');
    if (rm) {
      const rowEl = rm.closest<HTMLElement>('.repeat-row');
      const key = rowEl?.dataset.repeatKey;
      const idx = Number(rowEl?.dataset.row);
      if (!key || Number.isNaN(idx)) return;
      const rows = getRepeat(state.values, key);
      rows.splice(idx, 1);
      setRepeat(state.values, key, rows);
      renderForm();
    }
  });

  /* toolbar buttons */
  $<HTMLButtonElement>('#load-example').addEventListener('click', () => {
    state.values = initValues(state.tool);
    renderForm();
    renderOutput();
    renderChecklist();
  });

  $<HTMLButtonElement>('#clear-form').addEventListener('click', () => {
    for (const f of TOOLS[state.tool].fields) {
      if (f.type === 'repeat') state.values[f.key] = [makeEmptyRow(f)];
      else state.values[f.key] = f.type === 'checkbox' ? false : '';
    }
    renderForm();
    renderOutput();
    renderChecklist();
  });

  /* platform tabs */
  document.querySelectorAll<HTMLButtonElement>('.platform-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.platform = btn.dataset.platform as PlatformId;
      renderOutput();
    });
  });

  /* copy + download */
  $<HTMLButtonElement>('#copy-btn').addEventListener('click', copyAndConfirm);

  $<HTMLButtonElement>('#download-btn').addEventListener('click', () => {
    const ext = state.platform === 'raw' ? 'json' : state.platform === 'wordpress' ? 'html' : 'liquid';
    const blob = new Blob([currentCode()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aigeokit-${state.tool}-schema.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* GEO checklist: expand recommendation */
  $<HTMLElement>('#checklist-list').addEventListener('click', (e) => {
    const head = (e.target as HTMLElement).closest<HTMLButtonElement>('.check-head');
    if (!head) return;
    const item = head.closest<HTMLElement>('.check-item');
    const reco = item?.querySelector<HTMLElement>('.check-reco');
    const chevron = head.querySelector('.chevron');
    if (!reco) return;
    reco.classList.toggle('hidden');
    chevron?.classList.toggle('rotate-180');
  });

  /* modal */
  $<HTMLButtonElement>('#modal-close').addEventListener('click', closeModal);
  $<HTMLButtonElement>('#modal-close-text').addEventListener('click', closeModal);
  $<HTMLElement>('#modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$<HTMLElement>('#copy-modal').classList.contains('hidden')) {
      closeModal();
    }
  });
  $<HTMLButtonElement>('#modal-copy-again').addEventListener('click', async () => {
    const ok = await copyText(currentCode());
    if (!ok) return;
    const btn = $<HTMLButtonElement>('#modal-copy-again');
    // Keep the label; flash the button a lighter mint as click feedback.
    btn.classList.replace('bg-mint-500', 'bg-mint-300');
    btn.classList.replace('hover:bg-mint-400', 'hover:bg-mint-300');
    window.setTimeout(() => {
      btn.classList.replace('bg-mint-300', 'bg-mint-500');
      btn.classList.replace('hover:bg-mint-300', 'hover:bg-mint-400');
    }, 600);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-quick-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.platform = btn.dataset.quickCopy as PlatformId;
      await copyText(currentCode());
      $<HTMLElement>('#modal-platform').textContent = PLATFORM_LABELS[state.platform];
      renderOutput();
    });
  });
}

/* ---------- init ---------- */

function init(): void {
  state.values = initValues(state.tool);
  renderForm();
  renderOutput();
  renderChecklist();
  wireEvents();
  document.querySelectorAll<HTMLElement>('.tool-card').forEach((c) =>
    c.classList.toggle('card-active', c.dataset.tool === state.tool),
  );
}

init();
