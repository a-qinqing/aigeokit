import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Blog / guide content.
 *
 * `relatedTool` is required on purpose: every article must point at the tool it
 * supports, so we never publish an orphan page that earns traffic but converts
 * nothing.
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('Lifang'),
    /** Content cluster — keeps the pillar/support structure visible in the repo. */
    cluster: z.enum(['llms-txt', 'ai-crawlers', 'ai-visibility']),
    /** Route of the tool this article supports, e.g. /tools/llm-txt-builder/ */
    relatedTool: z.string(),
    /** Optional FAQ — rendered on the page and emitted as FAQPage JSON-LD. */
    faq: z
      .array(z.object({ q: z.string(), a: z.string() }))
      .optional()
      .default([]),
  }),
});

export const collections = { blog };
