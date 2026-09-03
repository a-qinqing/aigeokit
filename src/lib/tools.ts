import type { ToolDef, ToolId } from './types';

/**
 * Tool matrix — every generator AIGEOKit ships.
 * Each tool declares its form fields and a realistic example payload.
 * The UI and the checklist are driven entirely by these definitions.
 */

const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'pt-BR', label: 'Portuguese (BR)' },
  { value: 'nl', label: 'Dutch' },
  { value: 'it', label: 'Italian' },
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'JPY', 'AUD', 'CAD', 'CHF', 'INR'].map(
  (c) => ({ value: c, label: c }),
);

const AVAILABILITY = ['InStock', 'OutOfStock', 'PreOrder', 'BackOrder', 'Discontinued'].map(
  (a) => ({ value: a, label: a }),
);

const CONTACT_TYPES = [
  'customer service',
  'sales',
  'technical support',
  'billing support',
  'lifeline',
].map((c) => ({ value: c, label: c }));

export const TOOLS: Record<ToolId, ToolDef> = {
  article: {
    id: 'article',
    name: 'Article / Blog',
    tagline: 'BlogPosting, NewsArticle & more',
    description:
      'Entity-rich article schema with author, publisher, logo and citations — the foundation of GEO-friendly content.',
    icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
    fields: [
      {
        key: 'type',
        label: 'Schema type',
        type: 'select',
        group: 'main',
        options: ['Article', 'BlogPosting', 'NewsArticle', 'TechnicalArticle'].map((t) => ({
          value: t,
          label: t,
        })),
        default: 'Article',
      },
      { key: 'headline', label: 'Headline', type: 'text', group: 'main', placeholder: 'How we cut page speed by 82%' },
      { key: 'url', label: 'Page URL (canonical)', type: 'url', group: 'main', placeholder: 'https://example.com/blog/speed' },
      { key: 'description', label: 'Description / summary', type: 'textarea', group: 'main', placeholder: 'One or two sentences AI assistants can quote verbatim.' },
      { key: 'image', label: 'Hero image URL', type: 'url', group: 'main', placeholder: 'https://example.com/img/hero-1200x630.jpg' },
      { key: 'articleSection', label: 'Section / category', type: 'text', group: 'main', placeholder: 'Performance' },
      { key: 'inLanguage', label: 'Language', type: 'select', group: 'main', options: LANGS, default: 'en' },
      { key: 'datePublished', label: 'Published date', type: 'date', group: 'main' },
      { key: 'dateModified', label: 'Modified date', type: 'date', group: 'main' },
      { key: 'wordCount', label: 'Word count', type: 'number', group: 'main', placeholder: '1450' },
      { key: 'isAccessibleForFree', label: 'Accessible for free', type: 'checkbox', group: 'main', default: true },
      { key: 'authorName', label: 'Author name', type: 'text', group: 'author', placeholder: 'Jane Doe' },
      { key: 'authorUrl', label: 'Author URL (bio)', type: 'url', group: 'author', placeholder: 'https://example.com/authors/jane-doe' },
      { key: 'authorJobTitle', label: 'Author job title', type: 'text', group: 'author', placeholder: 'Senior SEO Lead' },
      { key: 'publisherName', label: 'Publisher / site name', type: 'text', group: 'publisher', placeholder: 'Acme Publishing' },
      { key: 'publisherUrl', label: 'Publisher URL', type: 'url', group: 'publisher', placeholder: 'https://example.com' },
      { key: 'publisherLogo', label: 'Publisher logo URL', type: 'url', group: 'publisher', placeholder: 'https://example.com/logo.png' },
      {
        key: 'orgSameAs',
        label: 'Publisher social profiles (sameAs)',
        type: 'repeat',
        group: 'publisher',
        rows: [{ key: 'url', type: 'url', placeholder: 'https://linkedin.com/company/acme' }],
      },
      {
        key: 'citation',
        label: 'Citations / sources',
        type: 'repeat',
        group: 'citation',
        help: 'Source URL or plain reference — the #1 GEO signal for AI assistants.',
        rows: [{ key: 'text', type: 'text', placeholder: 'https://research.example.com/study-2026 or "Smith et al., 2025"' }],
      },
    ],
    example: {
      type: 'BlogPosting',
      headline: 'How we cut Core Web Vitals LCP by 82% with static schemas',
      url: 'https://example.com/blog/static-schema-lcp',
      description:
        'A step-by-step account of moving JSON-LD generation to static, edge-served markup and the impact on Largest Contentful Paint.',
      image: 'https://example.com/img/lcp-1200x630.jpg',
      articleSection: 'Performance',
      inLanguage: 'en',
      datePublished: '2026-05-12',
      dateModified: '2026-06-01',
      wordCount: '1480',
      isAccessibleForFree: true,
      authorName: 'Jane Doe',
      authorUrl: 'https://example.com/authors/jane-doe',
      authorJobTitle: 'Senior SEO Lead',
      publisherName: 'Acme Publishing',
      publisherUrl: 'https://example.com',
      publisherLogo: 'https://example.com/logo.png',
      orgSameAs: [
        { url: 'https://linkedin.com/company/acme' },
        { url: 'https://x.com/acme' },
        { url: 'https://github.com/acme' },
      ],
      citation: [
        { text: 'https://web.dev/articles/vitals' },
        { text: 'Schema.org JSON-LD structured data guide' },
      ],
    },
  },

  faq: {
    id: 'faq',
    name: 'FAQ',
    tagline: 'Direct answers for AI assistants',
    description:
      'Question & answer schema optimized for extraction — the fastest way to appear in AI-generated answers.',
    icon: 'M21.11 11.54a8.5 8.5 0 0 1-8.9 8.9 8.54 8.54 0 0 1-3.9-.94L3 21l1.5-5.31a8.54 8.54 0 0 1-.94-3.9 8.5 8.5 0 0 1 8.9-8.9 8.5 8.5 0 0 1 8.55 8.65z M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01',
    fields: [
      { key: 'headline', label: 'FAQ page headline', type: 'text', group: 'main', placeholder: 'Frequently asked questions about GEO' },
      { key: 'url', label: 'Page URL (canonical)', type: 'url', group: 'main', placeholder: 'https://example.com/faq' },
      {
        key: 'faq',
        label: 'Questions & answers',
        type: 'repeat',
        group: 'faq',
        help: 'Answer in 1–3 sentences, ideally with a citable fact.',
        rows: [
          { key: 'question', label: 'Question', type: 'text', placeholder: 'What is generative engine optimization?', span: 'full' },
          { key: 'answer', label: 'Answer', type: 'textarea', placeholder: 'A concise, quotable answer…', span: 'full' },
        ],
      },
    ],
    example: {
      headline: 'GEO questions, answered',
      url: 'https://example.com/faq/geo',
      faq: [
        {
          question: 'What is generative engine optimization?',
          answer:
            'Generative engine optimization (GEO) is the practice of making content easier for AI assistants and LLMs to cite accurately, through structured data, citations, and entity clarity.',
        },
        {
          question: 'Does JSON-LD help with AI search visibility?',
          answer:
            'Yes. Structured data helps LLMs resolve entities, verify claims, and attribute content to the correct author and publisher, which improves citation frequency in AI answers.',
        },
        {
          question: 'Is AIGEOKit free to use?',
          answer:
            'AIGEOKit is fully free and runs 100% in your browser — no account, no API calls, no data leaves your device.',
        },
      ],
    },
  },

  product: {
    id: 'product',
    name: 'Product',
    tagline: 'Rich results + AI shopping answers',
    description:
      'Product, Offer and review markup with pricing, availability and rating data for search and AI shopping assistants.',
    icon: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01',
    fields: [
      { key: 'name', label: 'Product name', type: 'text', group: 'main', placeholder: 'Aurora Wireless Headphones' },
      { key: 'url', label: 'Product page URL', type: 'url', group: 'main', placeholder: 'https://example.com/p/aurora-x' },
      { key: 'description', label: 'Description', type: 'textarea', group: 'main', placeholder: 'What it is, who it is for, key specs.' },
      { key: 'image', label: 'Product image URL', type: 'url', group: 'main', placeholder: 'https://example.com/img/aurora-x.jpg' },
      { key: 'brand', label: 'Brand', type: 'text', group: 'main', placeholder: 'Acme Audio' },
      { key: 'sku', label: 'SKU', type: 'text', group: 'main', placeholder: 'AUR-X-BLK' },
      { key: 'mpn', label: 'MPN', type: 'text', group: 'main', placeholder: 'AURX2026' },
      { key: 'price', label: 'Price', type: 'number', group: 'offers', placeholder: '129.99' },
      { key: 'priceCurrency', label: 'Currency', type: 'select', group: 'offers', options: CURRENCIES, default: 'USD' },
      { key: 'availability', label: 'Availability', type: 'select', group: 'offers', options: AVAILABILITY, default: 'InStock' },
      {
        key: 'itemCondition',
        label: 'Condition',
        type: 'select',
        group: 'offers',
        options: ['NewCondition', 'UsedCondition', 'RefurbishedCondition'].map((c) => ({ value: c, label: c })),
        default: 'NewCondition',
      },
      { key: 'offersUrl', label: 'Buy button URL', type: 'url', group: 'offers', placeholder: 'https://example.com/cart/add?sku=AUR-X-BLK' },
      { key: 'ratingValue', label: 'Aggregate rating (0–5)', type: 'number', group: 'rating', placeholder: '4.6' },
      { key: 'ratingCount', label: 'Rating count', type: 'number', group: 'rating', placeholder: '214' },
      { key: 'reviewName', label: 'Review headline', type: 'text', group: 'rating', placeholder: 'Best battery life in its class' },
      { key: 'reviewBody', label: 'Review body', type: 'textarea', group: 'rating', placeholder: 'A short, specific review…' },
      { key: 'reviewAuthor', label: 'Review author', type: 'text', group: 'rating', placeholder: 'Chris P.' },
      { key: 'reviewRatingValue', label: 'Review rating (0–5)', type: 'number', group: 'rating', placeholder: '5' },
    ],
    example: {
      name: 'Aurora Wireless Headphones',
      url: 'https://example.com/p/aurora-x',
      description:
        '40-hour battery, hybrid ANC and studio-grade drivers in a 250g frame. Built for remote work and travel.',
      image: 'https://example.com/img/aurora-x.jpg',
      brand: 'Acme Audio',
      sku: 'AUR-X-BLK',
      mpn: 'AURX2026',
      price: '129.99',
      priceCurrency: 'USD',
      availability: 'InStock',
      itemCondition: 'NewCondition',
      offersUrl: 'https://example.com/cart/add?sku=AUR-X-BLK',
      ratingValue: '4.6',
      ratingCount: '214',
      reviewName: 'Best battery life in its class',
      reviewBody:
        'Three weeks of daily commutes and I have charged them twice. The ANC is dramatically better than the previous generation.',
      reviewAuthor: 'Chris P.',
      reviewRatingValue: '5',
    },
  },

  organization: {
    id: 'organization',
    name: 'Organization',
    tagline: 'The entity AI engines know you by',
    description:
      'Company-level markup with sameAs cross-links — the single strongest entity signal for LLM attribution.',
    icon: 'M3 21h18 M5 21V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14 M9 21v-4h6v4 M9 8h.01 M12 8h.01 M15 8h.01 M9 12h.01 M12 12h.01 M15 12h.01',
    fields: [
      { key: 'name', label: 'Organization name', type: 'text', group: 'main', placeholder: 'Acme Publishing' },
      { key: 'url', label: 'Website URL', type: 'url', group: 'main', placeholder: 'https://example.com' },
      { key: 'logo', label: 'Logo URL', type: 'url', group: 'main', placeholder: 'https://example.com/logo.png' },
      { key: 'description', label: 'Description', type: 'textarea', group: 'main', placeholder: 'What the organization does, in one or two sentences.' },
      { key: 'foundingDate', label: 'Founded (year)', type: 'date', group: 'main' },
      { key: 'contactType', label: 'Primary contact type', type: 'select', group: 'main', options: CONTACT_TYPES, default: 'customer service' },
      { key: 'email', label: 'Contact email', type: 'text', group: 'main', placeholder: 'hello@example.com' },
      { key: 'telephone', label: 'Contact phone', type: 'text', group: 'main', placeholder: '+1-555-0100' },
      { key: 'streetAddress', label: 'Street address', type: 'text', group: 'address', placeholder: '100 Market St' },
      { key: 'postalCode', label: 'Postal code', type: 'text', group: 'address', placeholder: '94103' },
      { key: 'addressLocality', label: 'City', type: 'text', group: 'address', placeholder: 'San Francisco' },
      { key: 'addressRegion', label: 'Region / state', type: 'text', group: 'address', placeholder: 'CA' },
      { key: 'addressCountry', label: 'Country code', type: 'text', group: 'address', placeholder: 'US' },
      {
        key: 'sameAs',
        label: 'Social profiles (sameAs)',
        type: 'repeat',
        group: 'links',
        help: 'Add 2+ consistent profiles — LinkedIn, X, GitHub, YouTube. The #1 GEO check.',
        rows: [{ key: 'url', type: 'url', placeholder: 'https://linkedin.com/company/acme' }],
      },
    ],
    example: {
      name: 'Acme Publishing',
      url: 'https://example.com',
      logo: 'https://example.com/logo.png',
      description: 'Acme Publishing creates developer tools and technical content for the SEO community.',
      foundingDate: '2015-03-01',
      contactType: 'customer service',
      email: 'hello@example.com',
      telephone: '+1-555-0100',
      streetAddress: '100 Market St',
      postalCode: '94103',
      addressLocality: 'San Francisco',
      addressRegion: 'CA',
      addressCountry: 'US',
      sameAs: [
        { url: 'https://linkedin.com/company/acme' },
        { url: 'https://x.com/acme' },
        { url: 'https://github.com/acme' },
        { url: 'https://youtube.com/@acme' },
      ],
    },
  },

  person: {
    id: 'person',
    name: 'Person / Author',
    tagline: 'Author E-E-A-T, machine-readable',
    description:
      'Author entities with expertise signals (knowsAbout, sameAs) that LLMs use to judge credibility.',
    icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', group: 'main', placeholder: 'Jane Doe' },
      { key: 'url', label: 'Author page URL', type: 'url', group: 'main', placeholder: 'https://example.com/authors/jane-doe' },
      { key: 'jobTitle', label: 'Job title', type: 'text', group: 'main', placeholder: 'Senior SEO Lead' },
      { key: 'email', label: 'Email', type: 'text', group: 'main', placeholder: 'jane@example.com' },
      { key: 'worksFor', label: 'Organization (works for)', type: 'text', group: 'main', placeholder: 'Acme Publishing' },
      { key: 'worksForUrl', label: 'Organization URL', type: 'url', group: 'main', placeholder: 'https://example.com' },
      { key: 'alumniOf', label: 'Alma mater', type: 'text', group: 'main', placeholder: 'Stanford University' },
      {
        key: 'knowsAbout',
        label: 'Expertise topics (knowsAbout)',
        type: 'repeat',
        group: 'main',
        rows: [{ key: 'topic', type: 'text', placeholder: 'Technical SEO' }],
      },
      {
        key: 'sameAs',
        label: 'Social profiles (sameAs)',
        type: 'repeat',
        group: 'links',
        rows: [{ key: 'url', type: 'url', placeholder: 'https://linkedin.com/in/janedoe' }],
      },
    ],
    example: {
      name: 'Jane Doe',
      url: 'https://example.com/authors/jane-doe',
      jobTitle: 'Senior SEO Lead',
      email: 'jane@example.com',
      worksFor: 'Acme Publishing',
      worksForUrl: 'https://example.com',
      alumniOf: 'Stanford University',
      knowsAbout: [
        { topic: 'Technical SEO' },
        { topic: 'Generative engine optimization' },
        { topic: 'Core Web Vitals' },
      ],
      sameAs: [
        { url: 'https://linkedin.com/in/janedoe' },
        { url: 'https://x.com/janedoe' },
        { url: 'https://github.com/janedoe' },
      ],
    },
  },

  localbusiness: {
    id: 'localbusiness',
    name: 'Local Business',
    tagline: 'Maps + local AI answers',
    description:
      'LocalBusiness markup with full address, geo coordinates and hours for Google Business and local AI queries.',
    icon: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    fields: [
      { key: 'name', label: 'Business name', type: 'text', group: 'main', placeholder: 'Acme Coffee Roasters' },
      { key: 'url', label: 'Website URL', type: 'url', group: 'main', placeholder: 'https://example.com' },
      { key: 'image', label: 'Storefront image URL', type: 'url', group: 'main', placeholder: 'https://example.com/img/store.jpg' },
      { key: 'description', label: 'Description', type: 'textarea', group: 'main', placeholder: 'One or two sentences about the business.' },
      { key: 'telephone', label: 'Phone', type: 'text', group: 'main', placeholder: '+1-555-0100' },
      { key: 'priceRange', label: 'Price range', type: 'text', group: 'main', placeholder: '$5–$25' },
      { key: 'streetAddress', label: 'Street address', type: 'text', group: 'address', placeholder: '48 Roastery Ln' },
      { key: 'addressLocality', label: 'City', type: 'text', group: 'address', placeholder: 'Portland' },
      { key: 'addressRegion', label: 'Region / state', type: 'text', group: 'address', placeholder: 'OR' },
      { key: 'postalCode', label: 'Postal code', type: 'text', group: 'address', placeholder: '97205' },
      { key: 'addressCountry', label: 'Country code', type: 'text', group: 'address', placeholder: 'US' },
      { key: 'latitude', label: 'Latitude', type: 'number', group: 'geo', placeholder: '45.5231' },
      { key: 'longitude', label: 'Longitude', type: 'number', group: 'geo', placeholder: '-122.6765' },
      { key: 'openingHours', label: 'Opening hours', type: 'text', group: 'geo', placeholder: 'Mo-Fr 07:00-17:00, Sa-Su 08:00-15:00' },
      {
        key: 'sameAs',
        label: 'Social profiles (sameAs)',
        type: 'repeat',
        group: 'links',
        rows: [{ key: 'url', type: 'url', placeholder: 'https://instagram.com/acmecoffee' }],
      },
    ],
    example: {
      name: 'Acme Coffee Roasters',
      url: 'https://example.com',
      image: 'https://example.com/img/store.jpg',
      description: 'Specialty coffee roaster and café serving small-batch single-origin beans since 2015.',
      telephone: '+1-555-0100',
      priceRange: '$5–$25',
      streetAddress: '48 Roastery Ln',
      addressLocality: 'Portland',
      addressRegion: 'OR',
      postalCode: '97205',
      addressCountry: 'US',
      latitude: '45.5231',
      longitude: '-122.6765',
      openingHours: 'Mo-Fr 07:00-17:00, Sa-Su 08:00-15:00',
      sameAs: [
        { url: 'https://instagram.com/acmecoffee' },
        { url: 'https://facebook.com/acmecoffee' },
      ],
    },
  },

  breadcrumb: {
    id: 'breadcrumb',
    name: 'Breadcrumbs',
    tagline: 'Context for crawlers & LLMs',
    description:
      'BreadcrumbList markup that gives search engines and AI crawlers a clear picture of your site hierarchy.',
    icon: 'M3 6h.01 M3 12h.01 M3 18h.01 M7 6h14 M7 12h14 M7 18h14',
    fields: [
      { key: 'url', label: 'Current page URL', type: 'url', group: 'main', placeholder: 'https://example.com/blog/static-schema-lcp' },
      {
        key: 'crumbs',
        label: 'Trail (first = home)',
        type: 'repeat',
        group: 'main',
        help: 'Positions are generated automatically.',
        rows: [
          { key: 'name', label: 'Name', type: 'text', placeholder: 'Home', span: 'half' },
          { key: 'item', label: 'URL', type: 'url', placeholder: 'https://example.com', span: 'half' },
        ],
      },
    ],
    example: {
      url: 'https://example.com/blog/static-schema-lcp',
      crumbs: [
        { name: 'Home', item: 'https://example.com' },
        { name: 'Blog', item: 'https://example.com/blog' },
        { name: 'Performance', item: 'https://example.com/blog/performance' },
      ],
    },
  },

  howto: {
    id: 'howto',
    name: 'How-To',
    tagline: 'Step-by-step content, AI-friendly',
    description:
      'HowTo markup with ordered steps, tools and supplies — ideal for tutorials that AI assistants love to summarize.',
    icon: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
    fields: [
      { key: 'name', label: 'How-To title', type: 'text', group: 'main', placeholder: 'How to brew the perfect pour-over' },
      { key: 'url', label: 'Page URL (canonical)', type: 'url', group: 'main', placeholder: 'https://example.com/guides/pour-over' },
      { key: 'description', label: 'Description', type: 'textarea', group: 'main', placeholder: 'What the reader will accomplish, and how long it takes.' },
      { key: 'image', label: 'Image URL', type: 'url', group: 'main', placeholder: 'https://example.com/img/pour-over.jpg' },
      { key: 'totalTime', label: 'Total time (ISO 8601)', type: 'text', group: 'main', placeholder: 'PT15M' },
      {
        key: 'steps',
        label: 'Steps',
        type: 'repeat',
        group: 'steps',
        help: 'Ordered automatically. Use action-first verbs.',
        rows: [
          { key: 'name', label: 'Step name', type: 'text', placeholder: 'Heat the water', span: 'half' },
          { key: 'text', label: 'Step detail', type: 'textarea', placeholder: 'Bring water to 93°C…', span: 'half' },
        ],
      },
      {
        key: 'tools',
        label: 'Tools',
        type: 'repeat',
        group: 'steps',
        rows: [{ key: 'name', type: 'text', placeholder: 'Gooseneck kettle' }],
      },
      {
        key: 'supplies',
        label: 'Supplies',
        type: 'repeat',
        group: 'steps',
        rows: [{ key: 'name', type: 'text', placeholder: 'V60 dripper & filters' }],
      },
    ],
    example: {
      name: 'How to brew the perfect pour-over',
      url: 'https://example.com/guides/pour-over',
      description: 'Brew a clean, balanced cup at home in under 15 minutes with a V60 and a gooseneck kettle.',
      image: 'https://example.com/img/pour-over.jpg',
      totalTime: 'PT15M',
      steps: [
        { name: 'Heat the water', text: 'Bring 350g of filtered water to 93°C (199°F).' },
        { name: 'Rinse the filter', text: 'Place the V60 on your server, add the paper filter and rinse it with hot water.' },
        { name: 'Bloom the coffee', text: 'Add 22g of freshly ground coffee, pour 50g of water and wait 30 seconds.' },
        { name: 'Pour in spirals', text: 'Pour the remaining water in slow spirals, keeping the bed level for 2:30 total.' },
      ],
      tools: [{ name: 'Gooseneck kettle' }],
      supplies: [{ name: 'V60 dripper & paper filters' }],
    },
  },
};

export const TOOL_ORDER: ToolId[] = [
  'article',
  'faq',
  'product',
  'organization',
  'person',
  'localbusiness',
  'breadcrumb',
  'howto',
];
