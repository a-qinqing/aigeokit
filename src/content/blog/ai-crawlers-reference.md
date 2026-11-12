---
title: 'AI Crawler Reference: Who Crawls What (2026)'
description: 'Eleven user-agent tokens decide whether ChatGPT, Claude, Perplexity and Bing can read your site. What each one does, which to block, and the wildcard trap.'
publishedDate: 2026-11-12
cluster: 'ai-crawlers'
relatedTool: '/tools/ai-robots-txt-checker/'
faq:
  - q: 'Does blocking GPTBot remove my site from ChatGPT search?'
    a: 'No. GPTBot collects training data. ChatGPT search builds its index with a separate token, OAI-SearchBot. A site that blocks GPTBot and allows OAI-SearchBot has opted out of training while staying citable, which is a coherent position many publishers now take. Blocking both is the configuration that quietly removes you from ChatGPT answers.'
  - q: 'Why does a bot still get blocked when I never wrote a rule for it?'
    a: 'Because User-agent: * applies to every crawler that has no group of its own. One Disallow: / left over from a staging setup blocks all AI crawlers at once, and nothing in the file mentions them. The fix is a named group per crawler you care about.'
  - q: 'If I add a group for GPTBot, do my other rules still apply to it?'
    a: 'No, and this catches people out. Under RFC 9309 only the most specific matching group applies. Rules under User-agent: * are not merged into a named group. So adding a GPTBot group with Allow: / also gives GPTBot access to the /admin/ path you disallowed in the wildcard group. Copy your private paths into every group you create.'
  - q: 'Can robots.txt stop Perplexity-User or ChatGPT-User?'
    a: 'Not reliably. Perplexity documents Perplexity-User as generally ignoring robots.txt because a person requested the fetch, and OpenAI says robots.txt rules may not apply to ChatGPT-User for the same reason. A Disallow line under those tokens records your preference. Enforcement has to happen at your CDN or firewall, matched on user agent plus the vendor published IP ranges.'
  - q: 'How long until a robots.txt change takes effect?'
    a: 'Crawlers re-read the file on their next visit, and Perplexity and OpenAI both quote around 24 hours for changes to reach their systems. A cached copy at your CDN can extend that. Check the file you actually serve with curl rather than trusting your editor, then confirm in server logs that the crawler fetches a page and gets a 200.'
---

A reader sent me his robots.txt in October. The first thing in it was this:

```
User-agent: *
Disallow: /admin/
Disallow: /cart/
Disallow: /
```

He wrote those lines in 2022 to keep a staging folder out of Google. The last one blocks every crawler that has no group of its own, which in 2026 is most of the AI ones. He had spent six months wondering why ChatGPT never mentioned his shop, and the answer had been sitting in line 4 the whole time.

Nothing was broken. He just never learned that those two words, `User-agent: *`, are a decision about eleven different agents that do eleven different jobs.

## One vendor, several crawlers

The phrase "AI crawler" hides the actual problem. Vendors ship separate agents for separate purposes, and the purposes have opposite implications for you.

OpenAI runs three. GPTBot collects training data. OAI-SearchBot builds the index that ChatGPT search cites from. ChatGPT-User fetches a single page when a person asks it to. Anthropic runs the same three-way split: ClaudeBot, Claude-SearchBot, Claude-User. Perplexity runs two. Google handles it differently, through Googlebot for search and a separate opt-out token for AI training.

Here are the eleven tokens our checker monitors, with the job each one performs.

| Token | Vendor | Job | Obeys robots.txt |
| --- | --- | --- | --- |
| `OAI-SearchBot` | OpenAI | Builds the ChatGPT search index | Yes |
| `GPTBot` | OpenAI | Collects training data for OpenAI models | Yes |
| `ChatGPT-User` | OpenAI | Fetches one page when a user asks | OpenAI says rules may not apply |
| `PerplexityBot` | Perplexity | Indexes pages for Perplexity search results | Yes |
| `Perplexity-User` | Perplexity | Fetches a page for a user question | Perplexity says generally not |
| `ClaudeBot` | Anthropic | Collects training data for Claude | Yes |
| `Claude-SearchBot` | Anthropic | Indexes pages for Claude search results | Yes |
| `Claude-User` | Anthropic | Fetches a page for a user question | Yes |
| `Bingbot` | Microsoft | Bing search index, also feeds Copilot | Yes |
| `Google-Extended` | Google | Opt-out token for Gemini training and grounding | Yes |
| `CCBot` | Common Crawl | Builds the open corpus many models train on | Yes |

A few agents are worth knowing about and are not on that list. Meta-ExternalAgent does Meta's training collection. Bytespider belongs to ByteDance. Applebot-Extended is a token rather than a crawler, the same shape as Google-Extended. Amazonbot covers Amazon's search and AI products. None of them is going to cite you in an answer, so they matter for a training policy and not much else.

The table reads as a list of switches. It is really a list of three decisions: do you want to be indexed, do you want to be read live, and do you want to be trained on.

## The mistake that costs real clicks

Plenty of sites added `Disallow: /` under GPTBot back in 2023, when the argument was about training data. That was a defensible choice. What many of them did not notice is that the same block often got extended to the whole OpenAI range, or that a wildcard rule was already covering it.

Blocking GPTBot does not hide you from ChatGPT. It hides you from future model training. The index behind ChatGPT search is OAI-SearchBot, and a page that OAI-SearchBot cannot read cannot be cited, no matter how well it ranks on Google. Those are separate pipelines running on separate schedules.

So "block training, allow search" is not a contradiction. It is the position most publishers with commercial content end up at, and it is two rules:

```
User-agent: GPTBot
Disallow: /

User-agent: OAI-SearchBot
Allow: /
```

The same split exists at Anthropic and Perplexity. ClaudeBot is training. Claude-SearchBot and Claude-User are the ones that decide whether Claude can answer with your page. Block all three and you have opted out of Claude entirely, which is a choice, as long as it is a choice you made on purpose.

## Adding a group can quietly open a door

This one is worth reading twice, because it is counterintuitive and it is in the specification.

Under [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309), a crawler follows the most specific user-agent group that matches it. Groups are not merged. Take this file:

```
User-agent: *
Disallow: /admin/

User-agent: GPTBot
Allow: /
```

GPTBot reads `/admin/`. The wildcard group is not consulted at all once a named group matches, so the `Disallow: /admin/` line has no effect on GPTBot. The file looks like it protects the admin path from everyone. It protects it from everyone except the one crawler you explicitly named.

This is the single most common defect I see in robots.txt files that were edited by hand. The fix is dull: repeat your private paths inside every group you create.

```
User-agent: OAI-SearchBot
Allow: /
Disallow: /admin/
Disallow: /cart/
```

## Two tokens where robots.txt is a note, not a control

`Perplexity-User` and `ChatGPT-User` are fetchers, not crawlers. They visit a page because a person asked about it, in that moment. Perplexity states plainly that Perplexity-User generally ignores robots.txt for that reason. OpenAI says its rules may not apply to ChatGPT-User.

Write the Disallow line anyway if it reflects what you want. Just do not count it as enforcement. If a page must stay out of those fetches under any circumstances, the control point is your CDN or firewall, matched on the user agent together with the vendor's published address list. Both Perplexity and OpenAI publish JSON endpoints for their ranges, and those lists change, so anything hardcoded will rot.

Which raises a smaller point. A user-agent string proves nothing. Anyone can send `GPTBot` in a header. If you are going to enforce at the edge, match the address against the published list, or you are filtering honest traffic and letting the rest through.

## A file that does what most sites want

Here is the configuration I would ship for a content site that wants citations and does not want to feed training sets. Every group repeats the private paths, per the rule above.

```
# Search and citation: open
User-agent: OAI-SearchBot
User-agent: PerplexityBot
User-agent: Claude-SearchBot
User-agent: Bingbot
Allow: /
Disallow: /admin/
Disallow: /cart/

# Training: opt out
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: CCBot
Disallow: /

# Everything else, including new crawlers nobody has named yet
User-agent: *
Disallow: /admin/
Disallow: /cart/
```

Stacked `User-agent` lines before a rule block form one group, so the four search tokens share the same rules. The wildcard group at the bottom is the part people skip. It is what a crawler launched next month will read, and leaving it out means that crawler gets a 200 on everything, including your admin path.

One caveat on the training block: Google-Extended governs Gemini training and grounding, and blocking it does not touch your Google rankings. Bingbot is different. It is the ordinary Bing index, so blocking it removes you from Bing search and from the Copilot answers built on top of it.

## Check the file you actually serve

Two things go wrong after you edit robots.txt. The CDN serves a cached copy, or the crawler has not come back yet. Vendors quote around 24 hours, which is a floor rather than a promise.

So verify in two steps. First, confirm the bytes the internet sees:

```
curl -s https://yourdomain.com/robots.txt
```

If your rules are not in that output, you are done debugging the file. Clear the cache.

Second, wait for the crawler and read your access logs for a 200 from the token you care about. A rule in a text file is intent. A 200 in a log is the only evidence that access exists. If you see 403s from the right user agent and the right address, the block is upstream of your application, in Cloudflare, your WAF, or a security plugin, and no amount of editing robots.txt will move it.

## Crawl access is the gate, not the win

It is worth being honest about what this buys you. Allowing OAI-SearchBot makes your pages eligible for citation. It does not make them cited. The answer engine still has to pick your page out of an index of billions, and it picks on the basis of what the page says and whether anything outside your site vouches for it.

If you are starting from zero, the order that works is access first, then structure, then content that answers a specific question better than the page currently ranking for it. Our [llms.txt guide](/blog/what-is-llms-txt/) covers the structure layer, and the [checker](/tools/ai-robots-txt-checker/) tells you which of the eleven tokens your current file actually allows. Run it before you edit anything. The number it returns is a fair summary of how much of AI search can currently see you.
