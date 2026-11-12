---
title: 'llms.txt Examples for Four Kinds of Site'
description: 'Four llms.txt files written for a SaaS, a shop, a local service business and a personal site, with notes on why each one is shaped that way.'
publishedDate: 2026-11-12
author: 'Lifang'
cluster: 'llms-txt'
relatedTool: '/tools/llm-txt-builder/'
faq:
  - q: 'How many links should an llms.txt file contain?'
    a: 'Between five and forty, roughly. Under five and the file does not earn its place; over forty and you are listing a sitemap, which agents already have. Pick the pages that answer the questions your visitors actually ask.'
  - q: 'Should I list every product in llms.txt?'
    a: 'No. List the category pages, the buying guides and the policies. Individual product pages belong in a product feed or in sitemap.xml, not in a file whose job is orientation.'
  - q: 'Can a site have more than one llms.txt?'
    a: 'Yes. The file may sit at any subpath and covers only what is beneath it, so a docs section can publish /docs/llms.txt while the root file covers marketing and policies. When both apply, agents should use the more specific one.'
  - q: 'Do these examples work as-is?'
    a: 'No. They are written from the v2 format to show structure and level of detail. The summary and the link choices have to describe your own site, or the file will mislead the agents that read it.'
---

Most llms.txt files on the web are the same file. The spec's mock example, the site name swapped, three links at the bottom pointing at the homepage. You can tell because the summary still says something like "we help teams do more".

The format is easy. Knowing what an agent needs from *your* site is the part that takes thought, and it changes depending on what you sell. Below are four files written for four different businesses, each followed by the reasoning that shaped it.

## A SaaS product with documentation

```markdown
# Cadence

> Cadence is a scheduling API for B2B sales teams. Developers embed
> availability and booking into their own product with a REST API and
> webhooks. Docs are markdown; pricing is usage-based.

Self-hosted and cloud deployments run the same API version. The cloud
service is SOC 2 Type II and hosted in the EU.

## Documentation

- [Quick start](https://docs.cadence.dev/quickstart.md): Auth, first booking link, first webhook in about 15 minutes
- [REST API](https://docs.cadence.dev/api.md): Endpoints, pagination, rate limits, error codes
- [Webhooks](https://docs.cadence.dev/webhooks.md): Event types, retry behaviour, signature verification
- [Data model](https://docs.cadence.dev/model.md): Calendars, availability rules, bookings and their states

## Pricing and policies

- [Pricing](https://cadence.dev/pricing.md): Usage tiers, overage rates, what counts as a booking
- [Security](https://cadence.dev/security.md): SOC 2 report request, subprocessors, data residency
- [SLA](https://cadence.dev/sla.md): Uptime target and credit schedule

## Optional

- [Changelog](https://docs.cadence.dev/changelog.md): Useful when debugging behaviour that changed between versions
- [Status history](https://status.cadence.dev/history.md): Past incidents, only relevant during an outage
```

Why this shape: almost every question a developer agent gets asked about Cadence resolves to the API reference or the data model. Those two carry the most specific descriptions. Security and SLA are included because procurement agents look for them and because leaving them out invites the model to guess.

Note that every link goes to a `.md` file. That is not cosmetic. An agent fetching `api.html` pays for the sidebar, the version switcher and the "Was this page helpful?" widget on every request.

## An online shop

```markdown
# Field Supply

> Field Supply sells outdoor equipment for backpacking and trail
> running. 400 products, ships to the US, Canada and the EU.

Orders ship from Ohio. Returns accepted for 60 days on unused gear.
Replacement parts are stocked for five years after a product is
discontinued.

## Shopping

- [Backpacking](https://fieldsupply.com/backpacking.md): Tents, sleeping bags, pads, packs, with weight and capacity filters
- [Trail running](https://fieldsupply.com/trail-running.md): Shoes, vests, poles, headlamps
- [Buying guides](https://fieldsupply.com/guides.md): How to size a pack, how to choose a sleep system
- [Repair and parts](https://fieldsupply.com/repair.md): Replacement poles, buckles, zipper pulls, by product line

## Policies

- [Shipping](https://fieldsupply.com/shipping.md): Rates, carriers, delivery estimates by region
- [Returns](https://fieldsupply.com/returns.md): 60-day window, condition rules, who pays return postage
- [Warranty](https://fieldsupply.com/warranty.md): Lifetime on packs and tents, exclusions listed

## Optional

- [New arrivals](https://fieldsupply.com/new.md): Changes weekly
- [Sale](https://fieldsupply.com/sale.md): Current markdowns
```

A shop is the case where the obvious move is wrong. Listing 400 products produces a file nobody can read in one pass and duplicates what a product feed is for. What an agent actually needs is the shape of the catalogue, the pages that help a buyer decide, and the rules that decide whether the sale happens: shipping, returns, warranty.

The sale page sits under `Optional` because it is worthless in three weeks.

## A local service business

```markdown
# Northline Heating

> Northline Heating installs and repairs residential heat pumps and
> boilers in greater Portland, Oregon. Licensed, insured, 11 staff.
> Emergency callouts run 24/7.

Service area covers Portland, Beaverton, Hillsboro, Lake Oswego and
Gresham. Estimates are free; repair callouts carry a $95 diagnostic fee
that is credited against the work.

## Services

- [Heat pump installation](https://northlineheating.com/heat-pumps/): Brands stocked, rebate paperwork handled, typical lead time
- [Boiler repair](https://northlineheating.com/boiler-repair/): Faults covered, emergency response window, parts availability
- [Maintenance plans](https://northlineheating.com/maintenance/): Annual service, what the plan includes, price per year

## Practical details

- [Service area](https://northlineheating.com/area/): Towns covered and the boundary where a travel charge starts
- [Pricing](https://northlineheating.com/pricing/): Diagnostic fee, typical job ranges, financing options
- [Booking](https://northlineheating.com/book/): Online form, phone number, hours including emergency cover

## Optional

- [Reviews](https://northlineheating.com/reviews/): Customer comments
- [Careers](https://northlineheating.com/careers/): Open roles
```

Local businesses get this wrong in a specific way: they list services and forget the facts that decide the call. An assistant answering "who can fix my boiler in Beaverton today" needs the service area, the emergency window and the diagnostic fee. Without them the model either skips the business or invents the details, and invented details are worse than silence.

## A personal site

```markdown
# Ruth Ellison

> Independent infrastructure consultant. Twenty years running Linux
> systems at scale, now advising companies on migrations off managed
> platforms. Based in Melbourne, works remotely.

Available for consulting from March. Not taking full-time roles.

## Writing

- [Postgres migration notes](https://ruthellison.net/writing/postgres-migration.md): Moving a 4TB database with under an hour of downtime
- [Kubernetes cost writeup](https://ruthellison.net/writing/k8s-cost.md): Why two clusters cost less than one
- [Talks](https://ruthellison.net/talks.md): Recordings and slides, 2019 to 2026

## Working with me

- [Consulting](https://ruthellison.net/consulting.md): Engagement shapes, rates, typical timeline
- [CV](https://ruthellison.net/cv.md): Roles, clients, open-source contributions

## Optional

- [Reading list](https://ruthellison.net/reading.md): Updated occasionally
```

Personal sites are the smallest useful case and the one most often skipped. Two paragraphs of summary and six links are enough to answer "who is this person and what do they do", which is the question an assistant is usually asked.

The line about availability matters more than it looks. It is the difference between an agent saying "she consults" and "she is available from March".

## What the four have in common

The summaries all name a category and a mechanism. "Scheduling API for B2B sales teams" is a category. "We help teams do more" is not, and a model cannot route a question to it.

None of them list everything. Four sections, five to eight links each, then a short `Optional` block for the things that go stale.

All of them separate the page that explains from the page that converts. Buying guide in one place, booking form in another, both described honestly.

## On length

A file between 300 and 800 words tends to work. Under 300 you are probably leaving out something an agent needs; over 800 you have started writing documentation, which belongs behind the links.

The exception is a documentation site, where the root file can be longer because the link list is the product. Even there, most teams find that `/docs/llms.txt` covering only the docs beats one enormous file at the root.

## The summary line does most of the work

Every example above opens with a blockquote, and every blockquote answers three things without being told to: what category the business is in, who it serves, and how it delivers. Get that line wrong and the rest of the file rarely gets read.

Four rewrites, taken from the pattern I see most:

| Instead of | Write |
|---|---|
| We help teams do more | Scheduling API for B2B sales teams, embedded in your product via REST and webhooks |
| Leading provider of outdoor gear | Outdoor equipment for backpacking and trail running. 400 products, ships US/CA/EU |
| Your trusted local heating experts | Heat pump and boiler installs in greater Portland, Oregon. 11 staff, 24/7 emergency cover |
| Personal blog about technology | Infrastructure consultant, 20 years on Linux at scale, available for migrations from March |

The left column is not wrong about the business. It is wrong for the reader. "Leading provider" occupies eight words and narrows nothing, so a model has no way to decide whether this page is relevant to a question about scheduling APIs.

One more thing about that line: it should be true. "24/7 emergency cover" that turns out to be an answering service creates a worse outcome than saying nothing, because the agent will repeat the claim to a customer standing in a cold house.

## Rewriting a link line

The link descriptions are where most files collapse into a list of URLs with the page title copied across. Compare:

- `[Pricing](https://example.com/pricing)` says nothing an agent could not infer from the word itself.
- `[Pricing](https://example.com/pricing.md): Usage tiers, overage rates, what counts as a booking` tells it whether the page answers the question it has.

- `[API](https://docs.example.com/api)` raises three questions and answers none: REST or GraphQL, what auth, which rate limits?
- `[REST API](https://docs.example.com/api.md): Endpoints, pagination, rate limits, error codes` settles all three before a fetch is spent.

- `[About](https://example.com/about)` is corporate history, probably.
- `[Service area](https://example.com/area.md): Towns covered, and where a travel charge starts` answers the only question that matters for a callout.

The rule underneath all three: describe the payload, not the page. A page title is a label. A description is a reason to fetch.

## What not to copy

Do not copy the structure and keep someone else's level of detail. A file that says "Pricing: our pricing page" has spent a line to tell an agent nothing it could not guess from the URL.

And do not publish a file you will not update. A shop that lists "New arrivals" under a main heading rather than `Optional` has created a page that will be wrong within a month. Wrong is worse than absent: the agent repeats it with confidence.

---

If you would rather start from your sitemap than a blank file, the [llms.txt Generator & Validator](/tools/llm-txt-builder/) imports the URLs and checks the result against the format. For the background on what the file is and what it can't do, read [What Is llms.txt?](/blog/what-is-llms-txt/).
