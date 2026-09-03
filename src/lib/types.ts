/**
 * Shared types for AIGEOKit's pure-frontend JSON-LD toolchain.
 * Everything in lib/ runs in the browser — no API calls, no server logic.
 */

export type ToolId =
  | 'article'
  | 'faq'
  | 'product'
  | 'organization'
  | 'person'
  | 'localbusiness'
  | 'breadcrumb'
  | 'howto';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'url'
  | 'date'
  | 'number'
  | 'checkbox'
  | 'select'
  | 'repeat';

/** One row inside a repeatable field (e.g. a FAQ Q&A pair or a sameAs URL). */
export interface RepeatRowField {
  key: string;
  label?: string;
  type: 'text' | 'url' | 'textarea';
  placeholder?: string;
  /** Width hint for grid layout of multi-input rows. */
  span?: 'full' | 'half';
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  /** Group heading under which the field is rendered. */
  group: string;
  options?: { value: string; label: string }[];
  /** When set, the field renders as repeatable rows (mini-forms per row). */
  rows?: RepeatRowField[];
  default?: string | boolean;
}

export interface ToolDef {
  id: ToolId;
  name: string;
  tagline: string;
  description: string;
  /** SVG path data (24x24 stroke, lucide-style). */
  icon: string;
  fields: FieldDef[];
  example: FormValues;
}

/** One repeatable row: values keyed by RepeatRowField.key. */
export type RepeatValue = Record<string, string>;
export type FormValues = Record<string, string | boolean | RepeatValue[]>;

export type PlatformId = 'raw' | 'wordpress' | 'shopify';

export type SchemaObject = Record<string, unknown>;
