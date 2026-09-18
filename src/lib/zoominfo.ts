/**
 * ZoomInfo MCP client.
 *
 * Deliberately does NOT hardcode tool names. ZoomInfo adds tools to the hosted
 * server and they appear at the start of the next session, so the names in any
 * doc go stale. We discover at startup and assert what we depend on.
 *
 * See docs/ZOOMINFO.md before changing anything in here, especially anything
 * that moves a call from the free set to the paid set.
 */

const MCP_ENDPOINT = "https://mcp.zoominfo.com/mcp";

/**
 * Tools that cost nothing. Safe to call in the daily loop.
 *
 * The verification-gate roles (hierarchyProxy, employmentTrend, jobPostings,
 * locationType, industryFilter) name the free data source behind each check
 * so assertRoles() proves it exists at startup. Verified against tools/list
 * 2026-09-17: there is NO free corporate-hierarchy tool (search_companies'
 * parent filters are deprecated and its output has no parent field;
 * enrich_companies has it but is paid). hierarchyProxy is a same-domain
 * search and can only record a likely parent, never kill.
 */
export const FREE_ROLES = [
  "searchCompanies",
  "searchSignals",
  "searchScoops",
  "lookup",
  "findSimilar",
  "recommendedContacts",
  "hierarchyProxy",
  "employmentTrend",
  "jobPostings",
  "locationType",
  "industryFilter",
] as const;

/** Tools that spend bulk data credits. Weekly job only, shortlist only. */
export const PAID_ROLES = ["enrichSignals", "enrichContacts", "enrichCompanies"] as const;

/** Tools that spend AI action credits. Click-triggered only, never in a job. */
export const AI_ROLES = ["accountResearch", "contactResearch"] as const;

export type Role =
  | (typeof FREE_ROLES)[number]
  | (typeof PAID_ROLES)[number]
  | (typeof AI_ROLES)[number];

/**
 * Map our role -> ZoomInfo's actual tool name.
 *
 * Verified against a live tools/list on 2026-09-17 (22 tools). The public docs
 * use hyphenated slugs and "find-recommended-contacts"; the server uses
 * underscores and "get_recommended_contacts". Trust the server. Free/paid
 * classification is from the docs, see docs/ZOOMINFO.md.
 *
 * searchSignals is intent search. Scoops are a separate free tool and get
 * their own role so the daily worker can run both and intersect.
 */
const ROLE_TO_TOOL: Partial<Record<Role, string>> = {
  searchCompanies: "search_companies",
  searchSignals: "search_intent",
  searchScoops: "search_scoops",
  lookup: "lookup",
  findSimilar: "find_similar_companies",
  recommendedContacts: "get_recommended_contacts",
  enrichSignals: "enrich_company_signals",
  enrichContacts: "enrich_contacts",
  enrichCompanies: "enrich_companies",
  accountResearch: "account_research",
  contactResearch: "contact_research",
  // verification gate data sources (all free, all subset filters on search)
  hierarchyProxy: "search_companies",
  employmentTrend: "search_companies",
  jobPostings: "search_scoops",
  locationType: "search_companies",
  industryFilter: "search_companies",
};

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export class EntitlementError extends Error {}
export class CreditError extends Error {}

/**
 * Discovered 2026-09-17 from
 * https://mcp.zoominfo.com/.well-known/oauth-authorization-server. The MCP
 * resource is https://mcp.zoominfo.com; its issuer is Okta.
 */
const DEFAULT_TOKEN_URL = "https://okta-login.zoominfo.com/oauth2/default/v1/token";
const DEFAULT_SCOPE = "api:data:mcp";

export interface ZoomInfoClientOptions {
  /** Client id of the "Client Credentials" MCP app in the Developer Portal. */
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  scope?: string;
  /**
   * A pre-issued bearer token (the portal's 24h "Generate token"). Local
   * testing only. When set, the client-credentials exchange is skipped.
   */
  bearerToken?: string;
  /** Refuse any paid call. Set true in the daily worker. */
  freeOnly?: boolean;
}

export class ZoomInfoClient {
  private token: string | null = null;
  private tokenExpiry = 0;
  private tools: Set<string> = new Set();
  private toolInfo: Map<string, ToolInfo> = new Map();

  constructor(private opts: ZoomInfoClientOptions) {}

  /**
   * OAuth 2.0 client-credentials grant against ZoomInfo's Okta issuer. The app
   * is created with "Client Credentials" in the Developer Portal; it acts as the
   * delegated user, so that user's entitlements, credit pool and cap apply.
   * Tokens are cached until a minute before expiry. Do not authenticate per request.
   */
  private async authenticate(): Promise<string> {
    if (this.opts.bearerToken) return this.opts.bearerToken;
    if (this.token && Date.now() < this.tokenExpiry - 60_000) return this.token;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: this.opts.scope ?? DEFAULT_SCOPE,
    });
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString(
      "base64"
    );
    const res = await fetch(this.opts.tokenUrl ?? DEFAULT_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        authorization: `Basic ${basic}`,
      },
      body,
    });

    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      // Token errors carry no PII; the description is the only clue we get.
      throw new Error(
        `ZoomInfo token request failed: ${res.status} ${json.error ?? ""} ${json.error_description ?? ""}`.trim()
      );
    }
    this.token = json.access_token;
    this.tokenExpiry = Date.now() + (json.expires_in ?? 3600) * 1000;
    return this.token;
  }

  /** Enumerate what this contract can actually reach. Call once at startup. */
  async discoverTools(): Promise<string[]> {
    const result = (await this.rpc("tools/list", {})) as { tools: ToolInfo[] };
    this.toolInfo = new Map(result.tools.map((t) => [t.name, t]));
    this.tools = new Set(this.toolInfo.keys());
    return [...this.tools];
  }

  /** Description and input schema as the server reports them. Diagnostics only. */
  describeTool(name: string): ToolInfo | undefined {
    return this.toolInfo.get(name);
  }

  /** The tool name a role maps to, or undefined if unmapped. For diagnostics. */
  toolFor(role: Role): string | undefined {
    return ROLE_TO_TOOL[role];
  }

  /** Fail loudly at startup rather than at 6am in a cron. */
  assertRoles(roles: Role[]): void {
    const missing = roles.filter((r) => {
      const tool = ROLE_TO_TOOL[r];
      return !tool || !this.tools.has(tool);
    });
    if (missing.length) {
      throw new EntitlementError(
        `Unmapped or unavailable roles: ${missing.join(", ")}. ` +
          `Check ROLE_TO_TOOL against tools/list output.`
      );
    }
  }

  /**
   * Call a tool and return the JSON the server embeds in its text content part.
   * ZoomInfo answers `{ content: [{ type: "text", text: "<json>" }], isError? }`;
   * some tools prefix the JSON with a one-line preamble. Errors are thrown with
   * the server's message, which is a validation string and carries no data.
   */
  async callJson<T>(role: Role, args: Record<string, unknown>): Promise<T> {
    const res = await this.call<{
      content?: { type: string; text?: string }[];
      isError?: boolean;
    }>(role, args);
    const text = res.content?.find((c) => c.type === "text")?.text ?? "";
    if (res.isError) {
      throw new Error(`ZoomInfo ${ROLE_TO_TOOL[role]} rejected the call: ${text.slice(0, 300)}`);
    }
    const brace = text.search(/[{[]/);
    if (brace < 0) throw new Error(`ZoomInfo ${ROLE_TO_TOOL[role]} returned no JSON body`);
    return JSON.parse(text.slice(brace)) as T;
  }

  async call<T>(role: Role, args: Record<string, unknown>): Promise<T> {
    if (this.opts.freeOnly && !FREE_ROLES.includes(role as never)) {
      throw new CreditError(
        `Refusing paid call '${role}' in free-only mode. The daily job must not spend credits.`
      );
    }
    const tool = ROLE_TO_TOOL[role];
    if (!tool) throw new EntitlementError(`Role '${role}' is not mapped to a tool name.`);
    return this.rpc("tools/call", { name: tool, arguments: args }) as Promise<T>;
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    let res = await this.post(method, params);

    // A cached token can be revoked before its expiry. Refresh once, then give up.
    if (res.status === 401 && !this.opts.bearerToken) {
      this.token = null;
      res = await this.post(method, params);
    }
    if (res.status === 401) {
      throw new Error(`ZoomInfo MCP ${method} unauthorized: check ZI_CLIENT_ID/ZI_CLIENT_SECRET`);
    }
    if (res.status === 403) {
      throw new EntitlementError(`Not entitled: ${method} ${JSON.stringify(params.name ?? "")}`);
    }
    if (!res.ok) {
      // Do not log the body. It contains PII by definition. See docs/SECURITY.md.
      throw new Error(`ZoomInfo MCP ${method} failed: ${res.status}`);
    }

    const json = (await this.parseBody(res)) as {
      result?: unknown;
      error?: { message: string };
    };
    if (json.error) throw new Error(`ZoomInfo MCP error: ${json.error.message}`);
    return json.result;
  }

  private async post(method: string, params: Record<string, unknown>): Promise<Response> {
    const token = await this.authenticate();
    return fetch(MCP_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
    });
  }

  /**
   * Streamable HTTP servers may answer a single request as JSON or as an SSE
   * stream carrying one JSON-RPC message. Handle both.
   */
  private async parseBody(res: Response): Promise<unknown> {
    const type = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (!type.includes("text/event-stream")) return JSON.parse(text);
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    if (!data.length) throw new Error("ZoomInfo MCP returned an empty event stream");
    return JSON.parse(data[data.length - 1]);
  }
}
