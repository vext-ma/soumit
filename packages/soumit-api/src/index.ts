/**
 * @vext-ma/soumit-api
 *
 * Official TypeScript & Node.js client for Soumit (https://soumit.ma).
 * Programmatic access to Moroccan public procurement tenders, award history,
 * AI analyses, Go/No-Go scorecards, and regulatory compliance under Décret n° 2-22-431.
 *
 * Zero dependencies — built on standard Fetch API and Web Crypto, fully compatible with:
 * Node.js 18+, Cloudflare Workers, Cloudflare Pages, Bun, Deno, and modern browsers.
 *
 * Architecture Principles:
 *  - Honesty Contract: A field the engine cannot verify is strictly `null`, documented
 *    in the resource's `unavailable` reason code dictionary. No default guesses or hallucinations.
 *  - Typed Exceptions: Errors match stable API codes and attach `request_id`.
 *  - Transparent Pagination: `autoPaginate()` yields an async generator across opaque cursors.
 *  - Edge-Ready Resiliency: Retries automatically on 429 and 5xx with jittered exponential backoff
 *    and respects `Retry-After` headers.
 *  - Safe Idempotency: Mutating calls automatically forward `Idempotency-Key`.
 */

export const DEFAULT_BASE_URL = "https://soumit.ma";
export const MAX_PAGE_SIZE = 100;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// --- Core Data Contracts ----------------------------------------------------

export interface ApiObject {
  [key: string]: unknown;
}

export interface ListEnvelope<T = ApiObject> {
  object: "list";
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface Tender extends ApiObject {
  object: "tender";
  id: string;
  reference?: string;
  title: string | null;
  status: string | null;
  procedure_type?: string | null;
  region: string | null;
  deadline: string | null;
  published_at: string | null;
  buyer: {
    id: string | null;
    name: string | null;
    category?: string | null;
    canonical_key?: string | null;
  };
  budget: {
    amount: number | null;
    currency: string | null;
    raw: string | null;
  };
  relevance?: {
    engaged: boolean;
    has_analysis: boolean;
    has_pursuit: boolean;
    watchlisted: boolean;
  };
  lots_count?: number;
  provisional_guarantee?: {
    amount: number | null;
    currency: string | null;
  } | null;
  unavailable: Record<string, string>;
}

export interface Award extends ApiObject {
  object: "award";
  id: string;
  tender_id: string | null;
  tender_reference?: string | null;
  buyer: {
    name: string | null;
    canonical_key: string | null;
  };
  awardee: {
    name: string | null;
    canonical_key: string | null;
    ice?: string | null;
  };
  awarded_amount: number | null;
  estimated_amount: number | null;
  discount_rate?: number | null;
  currency: string | null;
  amount_basis: "ttc" | "ht" | string | null;
  award_date: string | null;
  is_unsuccessful: boolean;
  unsuccessful_reason?: string | null;
  bidders_count?: number | null;
  unavailable: Record<string, string>;
}

export interface VerdictFactor {
  key: string;
  label: string;
  weight: number;
  status: "pass" | "fail" | "unknown";
  value: number | null;
  reason: string | null;
  blocking: boolean;
  provenance: {
    source: string;
    grounded: boolean;
  } | null;
}

export interface Verdict extends ApiObject {
  object: "verdict";
  tender_id: string;
  scorecard: {
    verdict: "GO" | "WATCH" | "NO_GO";
    verdict_basis: "hard_gate" | "calibrated_score" | "human_review_required" | null;
    total_score: number | null;
    score_available: boolean;
    score_withheld_reason: string | null;
    raw_score: number | null;
    grounded_weight_ratio: number | null;
    thresholds: {
      go: number;
      watch: number;
    };
    factors: VerdictFactor[];
    blocking_factors: VerdictFactor[];
  };
}

export interface Analysis extends ApiObject {
  object: "analysis";
  tender_id: string;
  status: string | null;
  quality: {
    tier: "decision_ready" | "review_required" | "degraded";
    score: number | null;
    degraded_mode: boolean;
    missing_fields: string[];
    warnings: string[];
    reasons: string[];
  } | null;
  summary?: string | null;
  technical_requirements?: Array<{
    title: string;
    description: string;
    mandatory: boolean;
  }>;
  financial_terms?: {
    estimated_amount_ht: number | null;
    provisional_guarantee_mad: number | null;
    execution_delay_months: number | null;
    penalty_rate_per_day: number | null;
  };
  unavailable: Record<string, string>;
}

export interface BarometerSnapshot extends ApiObject {
  object: "barometer_snapshot";
  edition_date: string;
  total_new_tenders: number;
  total_budget_mad: number;
  average_budget_mad: number;
  median_discount_pct: number | null;
  sectors: Array<{
    name: string;
    count: number;
    volume: number;
    share_pct: number;
  }>;
  regions: Array<{
    name: string;
    count: number;
    volume: number;
  }>;
  top_mega_tenders: Array<{
    id: string;
    title: string;
    buyer: string;
    budget: number;
    deadline: string;
    opportunity_score: number;
    url: string;
  }>;
  awards: Array<{
    reference: string;
    buyer: string;
    object: string;
    awardee: string;
    awarded_amount: number;
    discount_pct: number | null;
  }>;
  regulatory_insight: {
    title: string;
    takeaway: string;
    legal_ref: string;
  };
  unavailable: Record<string, string>;
}

export interface SoumitEvent extends ApiObject {
  object: "event";
  id: string;
  type:
    | "analysis.completed"
    | "verdict.changed"
    | "tender.deadline_approaching"
    | "award.published"
    | string;
  resource: {
    type: string;
    id: string;
  };
  occurred_at: string;
  recorded_at: string;
  data: Record<string, unknown>;
}

export interface RateLimitState {
  limit: number;
  remaining: number;
  reset: number;
}

// --- Typed Exceptions -------------------------------------------------------

export class SoumitError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly param?: string | null;
  readonly requestId?: string;
  readonly detail: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code?: string;
      status?: number;
      param?: string | null;
      requestId?: string;
      detail?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "SoumitError";
    this.code = options.code;
    this.status = options.status;
    this.param = options.param;
    this.requestId = options.requestId;
    this.detail = options.detail ?? {};
  }
}

export class InvalidRequestError extends SoumitError {}
export class AuthenticationError extends SoumitError {}
export class PermissionError extends SoumitError {}
export class NotFoundError extends SoumitError {}
export class ConflictError extends SoumitError {}
export class ServerError extends SoumitError {}

export class RateLimitError extends SoumitError {
  get retryAfter(): number | null {
    const value = this.detail.retry_after_seconds;
    return typeof value === "number" ? value : null;
  }
}

const ERROR_BY_STATUS: Record<number, typeof SoumitError> = {
  400: InvalidRequestError,
  401: AuthenticationError,
  403: PermissionError,
  404: NotFoundError,
  409: ConflictError,
  413: InvalidRequestError,
  415: InvalidRequestError,
  429: RateLimitError,
};

// --- Client Configuration ---------------------------------------------------

export interface SoumitOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

// --- Main SDK Class ---------------------------------------------------------

export class Soumit {
  readonly baseUrl: string;
  rateLimit: RateLimitState | null = null;

  readonly tenders: Tenders;
  readonly awards: ListResource<Award>;
  readonly barometer: Barometer;
  readonly boncommandes: ListResource<ApiObject>;
  readonly catalogue: Catalogue;
  readonly pursuits: Pursuits;
  readonly executive: Executive;
  readonly events: ListResource<SoumitEvent>;
  readonly webhooks: Webhooks;
  readonly apiKeys: ApiKeys;

  #apiKey: string;
  #maxRetries: number;
  #timeoutMs: number;
  #fetch: typeof fetch;

  constructor(options: SoumitOptions) {
    if (!options?.apiKey) {
      throw new Error("An API key is required. (e.g., Soumit({ apiKey: 'sk_live_...' }))");
    }

    this.#apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.#maxRetries = options.maxRetries ?? 3;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);

    this.tenders = new Tenders(this);
    this.awards = new ListResource<Award>(this, "/api/v1/awards");
    this.barometer = new Barometer(this);
    this.boncommandes = new ListResource<ApiObject>(this, "/api/v1/boncommandes");
    this.catalogue = new Catalogue(this);
    this.pursuits = new Pursuits(this);
    this.executive = new Executive(this);
    this.events = new ListResource<SoumitEvent>(this, "/api/v1/events");
    this.webhooks = new Webhooks(this);
    this.apiKeys = new ApiKeys(this);
  }

  async request<T = ApiObject>(
    method: string,
    path: string,
    options: {
      params?: QueryParams;
      body?: unknown;
      idempotencyKey?: string;
    } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      "User-Agent": "@vext-ma/soumit-api/1.1.0 (Morocco Procurement Engine)",
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] = options.idempotencyKey ?? crypto.randomUUID();
    }

    let response!: Response;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const timeout = AbortSignal.timeout(this.#timeoutMs);
      response = await this.#fetch(url.toString(), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: timeout,
      });

      this.#recordRateLimit(response);

      if (!RETRYABLE_STATUS.has(response.status) || attempt === this.#maxRetries) {
        break;
      }
      await sleep(backoffMs(response, attempt));
    }

    if (!response.ok) {
      await raiseForError(response);
    }

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  #recordRateLimit(response: Response): void {
    const limit = response.headers.get("RateLimit-Limit");
    const remaining = response.headers.get("RateLimit-Remaining");
    const reset = response.headers.get("RateLimit-Reset");
    if (limit && remaining && reset) {
      this.rateLimit = {
        limit: Number(limit),
        remaining: Number(remaining),
        reset: Number(reset),
      };
    }
  }

  /** Unauthenticated service discovery index. */
  index(): Promise<ApiObject> {
    return this.request("GET", "/api/v1");
  }

  /** Metered request usage by day, organization, and response code. */
  usage(params: QueryParams = {}): Promise<ApiObject> {
    return this.request("GET", "/api/v1/usage", { params });
  }
}

// --- Resource Classes -------------------------------------------------------

export class ListResource<T = ApiObject> {
  protected readonly client: Soumit;
  protected readonly path: string;

  constructor(client: Soumit, path: string) {
    this.client = client;
    this.path = path;
  }

  list(params: QueryParams = {}): Promise<ListEnvelope<T>> {
    return this.client.request<ListEnvelope<T>>("GET", this.path, { params });
  }

  async *autoPaginate(params: QueryParams = {}): AsyncGenerator<T, void, undefined> {
    let cursor: string | undefined;
    const query = { limit: MAX_PAGE_SIZE, ...params };

    for (;;) {
      const page = await this.list({ ...query, cursor });
      yield* page.data;
      if (!page.has_more) return;
      if (!page.next_cursor) {
        throw new SoumitError("The API reported more pages but returned no cursor.");
      }
      cursor = page.next_cursor;
    }
  }
}

export class Tenders extends ListResource<Tender> {
  constructor(client: Soumit) {
    super(client, "/api/v1/tenders");
  }

  retrieve(id: string): Promise<Tender> {
    return this.client.request<Tender>("GET", `${this.path}/${encodeURIComponent(id)}`);
  }

  analysis(id: string): Promise<Analysis> {
    return this.client.request<Analysis>("GET", `${this.path}/${encodeURIComponent(id)}/analysis`);
  }

  verdict(id: string): Promise<Verdict> {
    return this.client.request<Verdict>("GET", `${this.path}/${encodeURIComponent(id)}/verdict`);
  }

  documents(id: string, params: QueryParams = {}): Promise<ListEnvelope> {
    return this.client.request<ListEnvelope>(
      "GET",
      `${this.path}/${encodeURIComponent(id)}/documents`,
      { params },
    );
  }

  catalogueMatch(id: string, params: QueryParams = {}): Promise<ApiObject> {
    return this.client.request<ApiObject>(
      "GET",
      `${this.path}/${encodeURIComponent(id)}/catalogue-match`,
      { params },
    );
  }

  submissionPackage(id: string, params: QueryParams = {}): Promise<ApiObject> {
    return this.client.request<ApiObject>(
      "GET",
      `${this.path}/${encodeURIComponent(id)}/submission-package`,
      { params },
    );
  }
}

export class Barometer {
  private readonly client: Soumit;

  constructor(client: Soumit) {
    this.client = client;
  }

  current(params: QueryParams = {}): Promise<BarometerSnapshot> {
    return this.client.request<BarometerSnapshot>("GET", "/api/v1/barometer", { params });
  }

  quarterly(params: QueryParams = {}): Promise<ApiObject> {
    return this.client.request<ApiObject>("GET", "/api/v1/barometer/quarterly", { params });
  }
}

export class Catalogue extends ListResource {
  constructor(client: Soumit) {
    super(client, "/api/v1/catalogue");
  }

  retrieve(reference: string): Promise<ApiObject> {
    return this.client.request("GET", `${this.path}/${encodeURIComponent(reference)}`);
  }

  upsert(item: Record<string, unknown>, idempotencyKey?: string): Promise<ApiObject> {
    return this.client.request("POST", this.path, { body: item, idempotencyKey });
  }
}

export class Pursuits extends ListResource {
  constructor(client: Soumit) {
    super(client, "/api/v1/pursuits");
  }

  upsert(pursuit: Record<string, unknown>, idempotencyKey?: string): Promise<ApiObject> {
    return this.client.request("POST", this.path, { body: pursuit, idempotencyKey });
  }
}

export class Executive extends ListResource {
  constructor(client: Soumit) {
    super(client, "/api/v1/executive/briefings");
  }

  briefings(params: QueryParams = {}): Promise<ListEnvelope> {
    return this.list(params);
  }

  createBriefing(data: Record<string, unknown>, idempotencyKey?: string): Promise<ApiObject> {
    return this.client.request("POST", this.path, { body: data, idempotencyKey });
  }
}

export class Webhooks extends ListResource {
  constructor(client: Soumit) {
    super(client, "/api/v1/webhooks");
  }

  create(url: string, eventTypes: string[], extra: Record<string, unknown> = {}): Promise<ApiObject> {
    return this.client.request("POST", this.path, {
      body: { url, event_types: eventTypes, ...extra },
    });
  }

  retrieve(id: string): Promise<ApiObject> {
    return this.client.request("GET", `${this.path}/${encodeURIComponent(id)}`);
  }

  update(id: string, changes: Record<string, unknown>): Promise<ApiObject> {
    return this.client.request("PATCH", `${this.path}/${encodeURIComponent(id)}`, { body: changes });
  }

  delete(id: string): Promise<ApiObject> {
    return this.client.request("DELETE", `${this.path}/${encodeURIComponent(id)}`);
  }

  deliveries(params: QueryParams = {}): Promise<ListEnvelope> {
    return this.client.request<ListEnvelope>("GET", "/api/v1/webhook-deliveries", { params });
  }
}

export class ApiKeys extends ListResource {
  constructor(client: Soumit) {
    super(client, "/api/v1/api-keys");
  }

  create(data: Record<string, unknown> = {}): Promise<ApiObject> {
    return this.client.request("POST", this.path, { body: data });
  }

  revoke(id: string): Promise<ApiObject> {
    return this.client.request("DELETE", `${this.path}/${encodeURIComponent(id)}`);
  }
}

// --- Webhook Signature Verification -----------------------------------------

/**
 * Verify an `X-Soumit-Signature` header from inbound webhooks.
 *
 * Uses HMAC-SHA256 over `"{timestamp}.{rawBody}"` and performs constant-time
 * hex comparison to prevent timing side-channel attacks.
 *
 * @param secret The webhook endpoint secret provided when creating the webhook.
 * @param signatureHeader The raw `X-Soumit-Signature` header (e.g. `t=1730000000,v1=abc...`).
 * @param rawBody The unparsed webhook request payload as a string or Uint8Array.
 * @param toleranceSeconds Maximum permissible timestamp drift to prevent replay attacks (default: 300s).
 */
export async function verifyWebhookSignature(
  secret: string,
  signatureHeader: string,
  rawBody: string | Uint8Array,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!secret || !signatureHeader || rawBody === undefined || rawBody === null) {
    return false;
  }

  const parts: Record<string, string> = {};
  for (const piece of signatureHeader.split(",")) {
    const index = piece.indexOf("=");
    if (index > 0) {
      parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
    }
  }

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;

  const nowSeconds = Date.now() / 1000;
  if (Math.abs(nowSeconds - seconds) > toleranceSeconds) {
    return false;
  }

  const encoder = new TextEncoder();
  const bodyBytes = typeof rawBody === "string" ? encoder.encode(rawBody) : rawBody;
  const prefix = encoder.encode(`${timestamp}.`);
  const payload = new Uint8Array(prefix.length + bodyBytes.length);
  payload.set(prefix, 0);
  payload.set(bodyBytes, prefix.length);

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const mac = await crypto.subtle.sign("HMAC", key, payload);
  const expected = [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqualHex(expected, signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

// --- Utilities --------------------------------------------------------------

async function raiseForError(response: Response): Promise<never> {
  const requestId = response.headers.get("X-Request-Id") ?? undefined;
  let code: string | undefined;
  let message: string | undefined;
  let param: string | null = null;
  let detail: Record<string, unknown> = {};

  try {
    const body = (await response.json()) as { error?: Record<string, unknown> };
    const error = body.error ?? {};
    code = error.code as string | undefined;
    message = error.message as string | undefined;
    param = (error.param as string | null) ?? null;
    detail = (error.detail as Record<string, unknown>) ?? {};
  } catch {
    // Non-JSON response, retain fallback
  }

  const ErrorClass =
    ERROR_BY_STATUS[response.status] ?? (response.status >= 500 ? ServerError : SoumitError);

  throw new ErrorClass(message ?? `HTTP ${response.status}`, {
    code,
    status: response.status,
    param,
    requestId,
    detail,
  });
}

function backoffMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 300_000);
  }
  return Math.min(2 ** attempt * 1000, 60_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
