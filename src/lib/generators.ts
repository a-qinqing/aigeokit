import type { FormValues, RepeatValue, SchemaObject, ToolId } from './types';

/**
 * Pure-frontend JSON-LD generators.
 * Every builder is a deterministic pure function of the form values:
 * input → JSON-LD object. No network, no state, no side effects.
 */

const CONTEXT = 'https://schema.org';

/* ---------- value helpers ---------- */

const str = (v: FormValues, key: string): string => {
  const x = v[key];
  return typeof x === 'string' ? x.trim() : '';
};

const bool = (v: FormValues, key: string): boolean => v[key] === true || v[key] === 'true';

const num = (v: FormValues, key: string): number | undefined => {
  const s = str(v, key);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

const rows = (v: FormValues, key: string): RepeatValue[] =>
  Array.isArray(v[key]) ? (v[key] as RepeatValue[]) : [];

const rowText = (row: RepeatValue, key: string): string => (row[key] ?? '').trim();

/** Drop undefined / empty strings / empty arrays / empty objects. */
function compact(obj: Record<string, unknown>): SchemaObject {
  const out: SchemaObject = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'string' && val === '') continue;
    if (Array.isArray(val) && val.length === 0) continue;
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) continue;
    out[k] = val;
  }
  return out;
}

/* ---------- generators ---------- */

function article(v: FormValues): SchemaObject {
  const url = str(v, 'url');
  const authorName = str(v, 'authorName');
  const publisherName = str(v, 'publisherName');
  const sameAs = rows(v, 'orgSameAs')
    .map((r) => rowText(r, 'url'))
    .filter(Boolean);

  const citations = rows(v, 'citation')
    .map((r) => rowText(r, 'text'))
    .filter(Boolean)
    .map((c) => {
      if (/^https?:\/\//i.test(c)) return { '@type': 'CreativeWork', url: c };
      return c; // plain-text reference stays a string
    });

  const published = str(v, 'datePublished');
  const modified = str(v, 'dateModified');
  const isFree = bool(v, 'isAccessibleForFree');

  return compact({
    '@context': CONTEXT,
    '@type': str(v, 'type') || 'Article',
    '@id': url ? `${url}#article` : undefined,
    headline: str(v, 'headline'),
    description: str(v, 'description'),
    image: str(v, 'image') ? [str(v, 'image')] : undefined,
    articleSection: str(v, 'articleSection'),
    inLanguage: str(v, 'inLanguage'),
    datePublished: published,
    dateModified: modified,
    wordCount: num(v, 'wordCount'),
    isAccessibleForFree: isFree ? true : undefined,
    url,
    mainEntityOfPage: url ? { '@type': 'WebPage', '@id': url } : undefined,
    author: authorName
      ? compact({
          '@type': 'Person',
          name: authorName,
          url: str(v, 'authorUrl'),
          jobTitle: str(v, 'authorJobTitle'),
        })
      : undefined,
    publisher: publisherName
      ? compact({
          '@type': 'Organization',
          name: publisherName,
          url: str(v, 'publisherUrl'),
          logo: str(v, 'publisherLogo')
            ? { '@type': 'ImageObject', url: str(v, 'publisherLogo') }
            : undefined,
          sameAs,
        })
      : undefined,
    citation: citations.length ? citations : undefined,
  });
}

function faq(v: FormValues): SchemaObject {
  const qas = rows(v, 'faq')
    .map((r) => ({ q: rowText(r, 'question'), a: rowText(r, 'answer') }))
    .filter((r) => r.q && r.a);

  return compact({
    '@context': CONTEXT,
    '@type': 'FAQPage',
    headline: str(v, 'headline'),
    url: str(v, 'url'),
    mainEntity: qas.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  });
}

function product(v: FormValues): SchemaObject {
  const ratingValue = num(v, 'ratingValue');
  const ratingCount = num(v, 'ratingCount');
  const reviewRating = num(v, 'reviewRatingValue');

  return compact({
    '@context': CONTEXT,
    '@type': 'Product',
    name: str(v, 'name'),
    url: str(v, 'url'),
    description: str(v, 'description'),
    image: str(v, 'image') ? [str(v, 'image')] : undefined,
    brand: str(v, 'brand') ? { '@type': 'Brand', name: str(v, 'brand') } : undefined,
    sku: str(v, 'sku'),
    mpn: str(v, 'mpn'),
    offers: compact({
      '@type': 'Offer',
      url: str(v, 'offersUrl'),
      priceCurrency: str(v, 'priceCurrency'),
      price: num(v, 'price'),
      availability: str(v, 'availability') ? `${CONTEXT}/${str(v, 'availability')}` : undefined,
      itemCondition: str(v, 'itemCondition')
        ? `${CONTEXT}/${str(v, 'itemCondition')}`
        : undefined,
    }),
    aggregateRating:
      ratingValue !== undefined && ratingCount !== undefined
        ? compact({ '@type': 'AggregateRating', ratingValue, ratingCount })
        : undefined,
    review: str(v, 'reviewAuthor')
      ? compact({
          '@type': 'Review',
          name: str(v, 'reviewName'),
          reviewBody: str(v, 'reviewBody'),
          reviewRating: reviewRating !== undefined
            ? { '@type': 'Rating', ratingValue: reviewRating, bestRating: 5 }
            : undefined,
          author: { '@type': 'Person', name: str(v, 'reviewAuthor') },
        })
      : undefined,
  });
}

function organization(v: FormValues): SchemaObject {
  const sameAs = rows(v, 'sameAs')
    .map((r) => rowText(r, 'url'))
    .filter(Boolean);

  return compact({
    '@context': CONTEXT,
    '@type': 'Organization',
    name: str(v, 'name'),
    url: str(v, 'url'),
    logo: str(v, 'logo') ? { '@type': 'ImageObject', url: str(v, 'logo') } : undefined,
    description: str(v, 'description'),
    foundingDate: str(v, 'foundingDate'),
    sameAs,
    contactPoint: compact({
      '@type': 'ContactPoint',
      contactType: str(v, 'contactType'),
      email: str(v, 'email'),
      telephone: str(v, 'telephone'),
      areaServed: 'Worldwide',
    }),
    address: compact({
      '@type': 'PostalAddress',
      streetAddress: str(v, 'streetAddress'),
      postalCode: str(v, 'postalCode'),
      addressLocality: str(v, 'addressLocality'),
      addressRegion: str(v, 'addressRegion'),
      addressCountry: str(v, 'addressCountry'),
    }),
  });
}

function person(v: FormValues): SchemaObject {
  const sameAs = rows(v, 'sameAs')
    .map((r) => rowText(r, 'url'))
    .filter(Boolean);
  const knowsAbout = rows(v, 'knowsAbout')
    .map((r) => rowText(r, 'topic'))
    .filter(Boolean);

  return compact({
    '@context': CONTEXT,
    '@type': 'Person',
    name: str(v, 'name'),
    url: str(v, 'url'),
    jobTitle: str(v, 'jobTitle'),
    email: str(v, 'email'),
    worksFor: str(v, 'worksFor')
      ? compact({
          '@type': 'Organization',
          name: str(v, 'worksFor'),
          url: str(v, 'worksForUrl'),
        })
      : undefined,
    alumniOf: str(v, 'alumniOf')
      ? { '@type': 'EducationalOrganization', name: str(v, 'alumniOf') }
      : undefined,
    knowsAbout,
    sameAs,
  });
}

function localbusiness(v: FormValues): SchemaObject {
  const lat = num(v, 'latitude');
  const lng = num(v, 'longitude');
  const sameAs = rows(v, 'sameAs')
    .map((r) => rowText(r, 'url'))
    .filter(Boolean);
  const hours = str(v, 'openingHours')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  return compact({
    '@context': CONTEXT,
    '@type': 'LocalBusiness',
    name: str(v, 'name'),
    url: str(v, 'url'),
    image: str(v, 'image') ? [str(v, 'image')] : undefined,
    description: str(v, 'description'),
    telephone: str(v, 'telephone'),
    priceRange: str(v, 'priceRange'),
    address: compact({
      '@type': 'PostalAddress',
      streetAddress: str(v, 'streetAddress'),
      addressLocality: str(v, 'addressLocality'),
      addressRegion: str(v, 'addressRegion'),
      postalCode: str(v, 'postalCode'),
      addressCountry: str(v, 'addressCountry'),
    }),
    geo: lat !== undefined && lng !== undefined
      ? { '@type': 'GeoCoordinates', latitude: lat, longitude: lng }
      : undefined,
    openingHours: hours.length ? hours : undefined,
    sameAs,
  });
}

function breadcrumb(v: FormValues): SchemaObject {
  const crumbs = rows(v, 'crumbs')
    .map((r) => ({ name: rowText(r, 'name'), item: rowText(r, 'item') }))
    .filter((r) => r.name);

  return compact({
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) =>
      compact({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: c.item,
      }),
    ),
  });
}

function howto(v: FormValues): SchemaObject {
  const steps = rows(v, 'steps')
    .map((r) => ({ name: rowText(r, 'name'), text: rowText(r, 'text') }))
    .filter((r) => r.name || r.text);
  const tools = rows(v, 'tools')
    .map((r) => rowText(r, 'name'))
    .filter(Boolean);
  const supplies = rows(v, 'supplies')
    .map((r) => rowText(r, 'name'))
    .filter(Boolean);

  return compact({
    '@context': CONTEXT,
    '@type': 'HowTo',
    name: str(v, 'name'),
    url: str(v, 'url'),
    description: str(v, 'description'),
    image: str(v, 'image') ? [str(v, 'image')] : undefined,
    totalTime: str(v, 'totalTime'),
    step: steps.map((s, i) =>
      compact({ '@type': 'HowToStep', position: i + 1, name: s.name, text: s.text }),
    ),
    tool: tools.map((t) => ({ '@type': 'HowToTool', name: t })),
    supply: supplies.map((s) => ({ '@type': 'HowToSupply', name: s })),
  });
}

export const GENERATORS: Record<ToolId, (v: FormValues) => SchemaObject> = {
  article,
  faq,
  product,
  organization,
  person,
  localbusiness,
  breadcrumb,
  howto,
};
