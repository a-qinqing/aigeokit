---
title: 'What Is llms.txt? The AI Site File, Explained'
description: 'llms.txt is a markdown file at your site root that tells AI assistants what your site contains. The v2 format, a real example, and what it cannot do.'
publishedDate: 2026-11-12
author: 'Lifang'
cluster: 'llms-txt'
relatedTool: '/tools/llm-txt-builder/'
faq:
  - q: 'Is llms.txt an official standard?'
    a: 'Not formally. Jeremy Howard published it as an open proposal in September 2024 and revised it to v2 in August 2026. Plenty of platforms implement it, but no standards body ratified it and no AI provider guarantees it will be read.'
  - q: 'Does llms.txt improve my Google rankings?'
    a: 'No. Google Search does not use it for ranking or indexing. It exists to help AI assistants understand a site when they fetch it. Treat it as an AI-readability file, not an SEO factor.'
  - q: 'Where should llms.txt be placed?'
    a: 'At /llms.txt for the whole site. It can also sit at any subpath, where it covers only what is beneath that path: /docs/llms.txt describes /docs/ and nothing else. When two files both apply, an agent should use the more specific one.'
  - q: 'What is the difference between llms.txt and llms-full.txt?'
    a: 'llms.txt is a short index of links, small enough to fit in a context window. llms-full.txt dumps your documentation into a single file for agents that would rather read everything at once. The spec only covers llms.txt; llms-full.txt is a community habit.'
  - q: 'Will adding llms.txt get my site cited by ChatGPT?'
    a: 'Not by itself. Something still has to make the model choose your page over the alternatives, which comes down to crawl access, a clearly described entity, and content worth quoting. The file removes a step for agents that look for it. It does not create demand.'
---

Paste a URL into ChatGPT and ask what the company does. The assistant fetches the page, discards the navigation, the cookie notice and the script tags, then reads what is left. Most of the time it manages. On a documentation site with forty sidebar links it often doesn't, and every token spent on the wrapper is a token not spent on the answer.

llms.txt is an attempt to skip that work. It is a markdown file at `/llms.txt` that says what a site is and which pages are worth reading. That's the whole idea.

Jeremy Howard published the proposal in September 2024 and revised it to v2 in August 2026. It isn't a standard in any formal sense. There is no working group and no RFC. What it does have is adoption: Mintlify, GitBook, Yoast, AIOSEO and Wix generate the file for sites they host, Chrome's Lighthouse now checks for one, and OpenAI, Anthropic and Google each publish a file for their own API documentation.

Which makes it worth understanding, and worth being skeptical about. Both.

## What goes in the file

The spec is shorter than people expect. Sections appear in a fixed order, and only one of them is mandatory.

| Order | Element | Required | What it holds |
|---|---|---|---|
| 1 | Byte-order mark | No | An optional UTF-8 BOM |
| 2 | H1 | **Yes** | The site or project name |
| 3 | Blockquote | Recommended | A short summary that stands on its own |
| 4 | Prose | No | Context, instructions, caveats. No headings |
| 5 | H2 sections | No | Lists of links: `[name](url)`, optionally followed by `: notes` |

Two details are easy to miss. The H1 is the only element the spec requires, which means a file with nothing but a title technically validates and is also useless. And the file does not have to live at the root: `/docs/llms.txt` covers only what sits under `/docs/`. Large sites are better served by one map per section than one map for everything.

There is also a convention worth following. An H2 named `Optional` holds the links an agent can skip when context is tight. Changelogs, archives, legal pages.

## An example

```markdown
# Acme Analytics

> Self-hosted web analytics with a privacy-first data model.
> MIT licensed, single binary, docs written in markdown.

Acme runs in the EU and US regions. Pricing is per seat, billed monthly.

## Documentation

- [Quick start](https://docs.acme.dev/quickstart.md): Install, configure and send a first event in ten minutes
- [Event API](https://docs.acme.dev/api/events.md): Endpoints, payload fields, error codes
- [Self-hosting](https://docs.acme.dev/self-host.md): Docker, backups, upgrades, reverse proxies

## Pricing and policies

- [Pricing](https://acme.dev/pricing.md): Seat tiers, limits, what gets billed
- [Security](https://acme.dev/security.md): Data location, retention, subprocessors

## Optional

- [Changelog](https://acme.dev/changelog.md): Release notes, useful mainly when debugging a specific version
```

The links point at `.md` versions of the pages where those exist. An agent that follows them gets clean text instead of another round of HTML to strip. Each line also says what the reader gets, because `[Event API](...)` alone tells a model very little about whether it needs that page.

Notice how little is here. Six links, one summary, no archive. That is the point: the file is an index, and detail lives behind the links where it is fetched only if needed.

Different businesses need different files, though. There are worked examples for a SaaS product, a shop, a local service business and a personal site in [llms.txt examples](/blog/llms-txt-examples/).

## How it differs from robots.txt and sitemap.xml

All three sit at the root and all three are written for machines, so they get mixed up constantly. They answer different questions.

| | **llms.txt** | **robots.txt** | **sitemap.xml** |
|---|---|---|---|
| **Answers** | What is here, and where should I look? | What am I allowed to fetch? | What URLs exist? |
| **Written for** | AI agents, at the moment they need context | Every crawler, search and AI alike | Search engines |
| **Format** | Markdown | Plain-text directives | XML |
| **Curated** | Yes, by a human | No, rules only | No, usually exhaustive |
| **Affects Google rankings** | No | Indirectly, through crawl access | No, though it speeds discovery |

The practical consequence is that these files depend on each other. A well-written llms.txt does nothing if robots.txt tells `GPTBot` and `OAI-SearchBot` to stay out, because the file can't be fetched either. If you have never looked at your crawler rules, do that before writing anything. The [AI Robots.txt Checker](/tools/ai-robots-txt-checker/) reports how nine AI crawlers are treated and scores the result out of 100.

## llms-full.txt, briefly

`llms-full.txt` isn't in the spec. It's a habit that grew alongside it: instead of an index, you publish the full text of your documentation in one file, for agents that would rather make a single large request than follow twenty links.

Sometimes that's the right trade. Often it isn't. A full dump can run past the context window, and everything beyond the window is wasted. Publishing both is the usual compromise, with `llms.txt` as the entry point and the full file for anyone who explicitly asks for it.

## The half of v2 nobody implements

The 2026 revision added something beyond the file itself: serve a markdown version of each page, and say so in the HTML.

The convention is to publish the same content at the same URL with `.md` appended, so `/docs/api.html` also exists as `/docs/api.html.md`, and `/docs/` as `/docs/index.md`. Then two link relations point at them:

```html
<link rel="alternate" type="text/markdown" href="/docs/api.html.md">
<link rel="describedby" href="/llms.txt">
```

`alternate` tells an agent that a cleaner copy of this page exists. `describedby` points back at the file that describes the page, which is how an agent that lands on a deep URL discovers your llms.txt at all. Both can also be sent as an HTTP `Link:` header, which is easier when you cannot edit the pages themselves.

This is the part with the least adoption so far, and the most upside for a site that can do it. A static site generator makes it close to free: most of them already have the content in markdown before it becomes HTML.

## Does it actually work?

This is where most writing about llms.txt gets slippery, so it's worth separating what's documented from what's assumed.

Documented: the ecosystem around the file is real. Documentation platforms generate it, Lighthouse audits for it, and the AI labs publish it for their own developer docs. Public directories index thousands of files.

Assumed: that a given model will fetch yours. No provider has committed to reading `llms.txt` on every request, and there is no public, reproducible study showing that adding the file increases citations for a normal site. The proposal itself frames it as something used on demand, at inference time, when an agent needs information about a topic. Not a crawler directive. Not training data.

We publish a file for this site. We also can't show you a chart of it working. If a vendor tells you an llms.txt will get you cited by ChatGPT, ask what the measurement is. There isn't one yet.

What the file does is remove a step for the agents already looking. It won't make anyone want to cite a page they had no reason to cite.

## Writing one that's worth reading

Start with the blockquote, and write it as if it will be the only thing read. Name the category, who it's for, and how it works. "We help teams do more" is not a summary; it's a slogan, and a model can't do anything with it.

Then decide what earns a link. The temptation is to list every page. Resist it. An agent needs your docs, your pricing, your policies, and the two or three pages that answer the questions buyers ask. It does not need your tag archive.

Group links by intent, keep the descriptions short and specific, and put anything skippable under `## Optional`.

The failure I see most often isn't a formatting error. It's a file that was accurate when it was written. Three tools listed, six tools now published. For an agent, that's worse than finding no file at all, because it describes the site incorrectly with confidence. If the file can't be kept current, it shouldn't be published.

## Check it before you ship

Four things break most files: a missing H1, a blockquote that isn't directly under the H1, dead links, and a server that serves the file as a download instead of text. Coverage is the fourth check, and the only one a validator can't do for you: are the pages an agent would actually need listed?

The [llms.txt Generator & Validator](/tools/llm-txt-builder/) handles the first three against a live URL or pasted text, and will import your sitemap if you'd rather start from a list than a blank page. It runs in the browser; nothing you paste is uploaded.

## Where this leaves you

If your site is already easy for an agent to read, a llms.txt buys you very little. If it's a documentation site, a product site with a lot of pages, or anything where an assistant keeps getting the basics wrong, the file is cheap enough to be worth an afternoon.

Just don't let anyone sell it to you as a ranking fix. It isn't one.

---

*Written against the v2 proposal, August 2026. If something here has gone stale, [tell us](/contact/) and it gets fixed.*
