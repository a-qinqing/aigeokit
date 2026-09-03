import type { FormValues, RepeatValue, ToolId } from './types';

/**
 * GEO Readiness Checklist.
 *
 * Evaluates the current form values against Generative-Engine-Optimization
 * best practices: entity cross-linking (sameAs), citations, publisher/author
 * entity graphs, freshness, image & canonical signals.
 *
 * Every item is actionable: a human-readable recommendation that tells the
 * user exactly what to add and why an LLM cares about it.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface ChecklistItem {
  id: string;
  status: CheckStatus;
  label: string;
  /** What was found (or missing) in the current data. */
  detail: string;
  /** The actionable fix, phrased for the user. */
  recommendation: string;
}

const str = (v: FormValues, key: string): string => {
  const x = v[key];
  return typeof x === 'string' ? x.trim() : '';
};

const rows = (v: FormValues, key: string): RepeatValue[] =>
  Array.isArray(v[key]) ? (v[key] as RepeatValue[]) : [];

const filledCount = (v: FormValues, key: string): number =>
  rows(v, key).filter((r) => Object.values(r).some((x) => x.trim() !== '')).length;

const item = (
  id: string,
  status: CheckStatus,
  label: string,
  detail: string,
  recommendation: string,
): ChecklistItem => ({ id, status, label, detail, recommendation });

/** Checks that apply to every generator. */
function commonChecks(v: FormValues): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const url = str(v, 'url');

  out.push(
    url
      ? item(
          'canonical',
          'pass',
          'Canonical URL present',
          `Page URL is set: ${url}`,
          'Keep the canonical URL identical to the one in your robots meta and sitemap — deduplication makes LLMs trust the source.',
        )
      : item(
          'canonical',
          'warn',
          'No canonical URL',
          'No page URL is set.',
          'Add the canonical page URL. Entity resolution and deduplication both depend on a stable, consistent URL.',
        ),
  );

  const description = str(v, 'description');
  if (description.length >= 60) {
    out.push(
      item(
        'description',
        'pass',
        'Description is quotable',
        `${description.length} characters — long enough to quote.`,
        'Descriptions are frequently cited verbatim by AI assistants. Keep it accurate: never let the summary contradict the body.',
      ),
    );
  } else if (description.length > 0) {
    out.push(
      item(
        'description',
        'warn',
        'Description is thin',
        `Only ${description.length} characters.`,
        'Expand to 1–2 full sentences (60+ characters). AI assistants quote descriptions verbatim — give them a complete thought.',
      ),
    );
  } else {
    out.push(
      item(
        'description',
        'fail',
        'Description missing',
        'No description was provided.',
        'Write a 1–2 sentence description that states what the page proves or answers. This is one of the cheapest GEO wins.',
      ),
    );
  }

  return out;
}

export function runGeoChecklist(tool: ToolId, v: FormValues): ChecklistItem[] {
  const checks: ChecklistItem[] = commonChecks(v);

  /* --- sameAs: entity cross-linking (all entity tools) --- */
  if (['organization', 'person', 'localbusiness', 'article'].includes(tool)) {
    const count = tool === 'article' ? filledCount(v, 'orgSameAs') : filledCount(v, 'sameAs');
    if (count >= 2) {
      checks.push(
        item(
          'sameAs',
          'pass',
          `${count} sameAs profiles`,
          'Entity is cross-linked across profiles.',
          'Keep profile URLs stable and consistent across pages. LLMs triangulate entities from these links.',
        ),
      );
    } else if (count === 1) {
      checks.push(
        item(
          'sameAs',
          'warn',
          'Only 1 sameAs profile',
          'One social profile is linked.',
          'Add at least one more profile (LinkedIn, X, GitHub, YouTube). Two or more consistent profiles dramatically improve entity confidence.',
        ),
      );
    } else {
      checks.push(
        item(
          'sameAs',
          'fail',
          'No sameAs profiles',
          'No social / external profiles linked.',
          'Add 2+ consistent profiles. sameAs is the #1 entity signal: it lets LLMs verify that this entity is the same one referenced across the web.',
        ),
      );
    }
  }

  /* --- citations (articles) --- */
  if (tool === 'article') {
    const n = filledCount(v, 'citation');
    if (n >= 2) {
      checks.push(
        item(
          'citation',
          'pass',
          `${n} citations`,
          'Sources are attributed.',
          'Citations are the strongest GEO lever — keep them accurate and from authoritative domains.',
        ),
      );
    } else if (n === 1) {
      checks.push(
        item(
          'citation',
          'warn',
          'Only 1 citation',
          'One source is attributed.',
          'Add 2–3 citations with URLs. AI assistants verify claims against linked sources; more verifiable claims = more quotes.',
        ),
      );
    } else {
      checks.push(
        item(
          'citation',
          'fail',
          'No citations',
          'The article cites no sources.',
          'Add 2–3 citations with URLs (studies, official docs, data sources). Claim-verifiability is the core of GEO.',
        ),
      );
    }
  }

  /* --- publisher / author entity graph (articles) --- */
  if (tool === 'article') {
    const author = str(v, 'authorName');
    const publisher = str(v, 'publisherName');
    if (author && publisher) {
      checks.push(
        item(
          'entityGraph',
          'pass',
          'Author → publisher graph complete',
          'Both entities are connected.',
          'A complete author → publisher graph helps Google E-E-A-T and lets LLMs attribute expertise correctly.',
        ),
      );
    } else if (author || publisher) {
      checks.push(
        item(
          'entityGraph',
          'warn',
          'Author or publisher missing',
          `${author ? 'Publisher' : 'Author'} entity is missing.`,
          author
            ? 'Add the publisher entity (site name + logo). AI answers attribute claims to the publisher.'
            : 'Add the author entity (name + bio URL). Expertise attribution is a core GEO ranking factor.',
        ),
      );
    } else {
      checks.push(
        item(
          'entityGraph',
          'fail',
          'No author or publisher',
          'The article has no entity graph.',
          'Add both author (Person) and publisher (Organization with logo). Without them, AI assistants cannot attribute the content.',
        ),
      );
    }

    const logo = str(v, 'publisherLogo');
    checks.push(
      logo
        ? item(
            'publisherLogo',
            'pass',
            'Publisher logo set',
            'Logo is linked to the publisher entity.',
            'A logo also unlocks the knowledge-panel brand treatment in some engines.',
          )
        : item(
            'publisherLogo',
            'warn',
            'No publisher logo',
            'Logo URL is empty.',
            'Add a publisher logo (112×112+). It strengthens brand entity recognition for both search engines and LLMs.',
          ),
    );
  }

  /* --- freshness: published / modified dates --- */
  const published = str(v, 'datePublished');
  const modified = str(v, 'dateModified');
  if (published) {
    const stale =
      modified && published && new Date(modified).getTime() < new Date(published).getTime();
    checks.push(
      stale
        ? item(
            'dates',
            'fail',
            'dateModified before datePublished',
            'The modified date is earlier than the published date.',
            'Fix the dates — inconsistent timestamps erode freshness signals.',
          )
        : item(
            'dates',
            'pass',
            'Freshness dates set',
            modified ? 'Published + modified dates present.' : 'Published date present.',
            'Add dateModified when you update content — recency is a strong trust signal for AI assistants.',
          ),
    );
  } else {
    checks.push(
      item(
        'dates',
        'warn',
        'No publish date',
        'datePublished is empty.',
        'Always set datePublished (ISO format). AI assistants prefer citing recent, dated content.',
      ),
    );
  }

  /* --- image signals --- */
  if (['article', 'product', 'howto', 'localbusiness', 'organization'].includes(tool)) {
    const imgKey = tool === 'organization' ? 'logo' : 'image';
    const img = str(v, imgKey);
    checks.push(
      img
        ? item(
            'image',
            'pass',
            'Image provided',
            `${imgKey} is set.`,
            'Use a 1200×630 or wider image — AI chat previews render thumbnails from this field.',
          )
        : item(
            'image',
            'warn',
            'No image',
            `${imgKey} is empty.`,
            'Add a representative image. Visual entities help AI answers that render rich previews.',
          ),
    );
  }

  /* --- tool-specific depth checks --- */
  if (tool === 'faq') {
    const qas = rows(v, 'faq').filter((r) => r.question?.trim() && r.answer?.trim());
    const shallow = qas.filter((r) => (r.answer ?? '').trim().length < 60).length;
    if (qas.length === 0) {
      checks.push(
        item(
          'faqDepth',
          'fail',
          'No Q&A pairs',
          'Add at least one question with an answer.',
          'Add 3–5 real questions. FAQ schema only helps when the answers are complete enough to quote.',
        ),
      );
    } else if (shallow > 0) {
      checks.push(
        item(
          'faqDepth',
          'warn',
          `${shallow} answer${shallow > 1 ? 's' : ''} too short`,
          'Some answers are under 60 characters.',
          'Expand short answers to 1–3 sentences. AI assistants paraphrase from the full answer text.',
        ),
      );
    } else {
      checks.push(
        item(
          'faqDepth',
          'pass',
          `${qas.length} substantial Q&A pairs`,
          'All answers are quotable length.',
          'Perfect. Keep answers factual and self-contained.',
        ),
      );
    }
  }

  if (tool === 'product') {
    const complete =
      str(v, 'price') !== '' && str(v, 'priceCurrency') !== '' && str(v, 'availability') !== '';
    checks.push(
      complete
        ? item(
            'offerComplete',
            'pass',
            'Offer data complete',
            'Price, currency and availability are set.',
            'Complete offer data qualifies the page for rich results and AI shopping answers.',
          )
        : item(
            'offerComplete',
            'warn',
            'Offer data incomplete',
            'Price, currency or availability is missing.',
            'Add price, currency and availability. AI shopping assistants filter by price — incomplete offers get dropped.',
          ),
    );
  }

  if (tool === 'localbusiness') {
    const addr =
      str(v, 'streetAddress') &&
      str(v, 'addressLocality') &&
      str(v, 'postalCode') &&
      str(v, 'addressCountry');
    checks.push(
      addr
        ? item(
            'address',
            'pass',
            'Full address provided',
            'Street, city, postal code and country are set.',
            'Complete addresses power local AI answers ("coffee near me").',
          )
        : item(
            'address',
            'warn',
            'Address incomplete',
            'Some address fields are empty.',
            'Fill the full PostalAddress. Local AI queries need street, city, postal code and country.',
          ),
    );
  }

  return checks;
}
