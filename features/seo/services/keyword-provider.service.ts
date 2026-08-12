/**
 * Thin DataForSEO client wrapper — the one place a keyword-data provider
 * swap would be made (see the architecture doc's §3 recommendation). Uses
 * HTTP Basic Auth (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD) against the
 * synchronous "live" endpoints, which suit this app's on-demand use case
 * (no task-queue polling needed for these two calls).
 *
 * The exact response field paths below (especially for the Labs endpoint,
 * whose metrics nest under keyword_data.keyword_info) are transcribed from
 * DataForSEO's published docs but have not yet been exercised against a
 * live account in this codebase — verify against a real response once
 * DATAFORSEO_LOGIN/PASSWORD are set, before relying on this in Phase 10.5b.
 */

const DATAFORSEO_BASE_URL = "https://api.dataforseo.com";
const DEFAULT_LOCATION_CODE = 2840; // United States
const DEFAULT_LANGUAGE_CODE = "en";

export class DataForSeoConfigError extends Error {}
export class DataForSeoRequestError extends Error {}

function getAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new DataForSeoConfigError(
      "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set to call the keyword data provider."
    );
  }
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

type DataForSeoTaskResponse<TResult> = {
  status_code: number;
  status_message: string;
  tasks?: Array<{
    status_code: number;
    status_message: string;
    result: TResult[] | null;
  }>;
};

async function postLiveTask<TResult>(
  path: string,
  body: Record<string, unknown>
): Promise<TResult[]> {
  const res = await fetch(`${DATAFORSEO_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify([body]),
  });

  if (!res.ok) {
    throw new DataForSeoRequestError(`DataForSEO request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as DataForSeoTaskResponse<TResult>;
  const task = json.tasks?.[0];
  if (!task || task.status_code >= 40000) {
    throw new DataForSeoRequestError(task?.status_message ?? json.status_message ?? "Unknown DataForSEO error");
  }

  return task.result ?? [];
}

export type KeywordMetrics = {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
};

type SearchVolumeResult = {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  competition: number | null;
};

/** Google Ads Search Volume (Live) — up to 1,000 keywords per call. */
export async function getSearchVolume(
  keywords: string[],
  opts: { locationCode?: number; languageCode?: string } = {}
): Promise<KeywordMetrics[]> {
  const results = await postLiveTask<SearchVolumeResult>("/v3/keywords_data/google_ads/search_volume/live", {
    keywords,
    location_code: opts.locationCode ?? DEFAULT_LOCATION_CODE,
    language_code: opts.languageCode ?? DEFAULT_LANGUAGE_CODE,
  });

  return results.map((r) => ({
    keyword: r.keyword,
    searchVolume: r.search_volume,
    cpc: r.cpc,
    competition: r.competition,
  }));
}

type KeywordIdeaResult = {
  keyword_data?: {
    keyword?: string;
    keyword_info?: {
      search_volume?: number | null;
      cpc?: number | null;
      competition?: number | null;
    };
  };
};

/** DataForSEO Labs Keyword Ideas (Live) — suggestions related to seed keywords. */
export async function getKeywordIdeas(
  seedKeywords: string[],
  opts: { locationCode?: number; languageCode?: string; limit?: number } = {}
): Promise<KeywordMetrics[]> {
  const results = await postLiveTask<KeywordIdeaResult>("/v3/dataforseo_labs/google/keyword_ideas/live", {
    keywords: seedKeywords,
    location_code: opts.locationCode ?? DEFAULT_LOCATION_CODE,
    language_code: opts.languageCode ?? DEFAULT_LANGUAGE_CODE,
    limit: opts.limit ?? 100,
  });

  return results
    .filter((r) => r.keyword_data?.keyword)
    .map((r) => ({
      keyword: r.keyword_data!.keyword!,
      searchVolume: r.keyword_data?.keyword_info?.search_volume ?? null,
      cpc: r.keyword_data?.keyword_info?.cpc ?? null,
      competition: r.keyword_data?.keyword_info?.competition ?? null,
    }));
}
