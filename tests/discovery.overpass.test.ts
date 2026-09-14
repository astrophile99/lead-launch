import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import {
  attemptTimeout,
  classifyOverpassResponse,
  overpassErrorText,
  runOverpassQuery,
} from "@/providers/business-data/overpass-client";
import {
  OpenStreetMapProvider,
  areaPlans,
  buildQuery,
  filtersFor,
  resultBudget,
} from "@/providers/business-data/openstreetmap";
import { getBusinessDataProvider, findBusinessDataProvider } from "@/providers/business-data";
import type { DiscoveryQuery } from "@/types";

/**
 * Overpass transport and query-shape tests.
 *
 * Every one of these runs against a mocked `fetch`. None of them touches a
 * real Overpass server: a test that depends on volunteer-run public
 * infrastructure is a test that fails for reasons the code cannot control, and
 * it would also mean the suite quietly loads that infrastructure every time
 * anyone runs it.
 *
 * Each test uses its own `.test` hostnames. That keeps the per-host throttle in
 * `rate-limit.ts` from making one test wait on the previous test's requests,
 * and it makes the endpoint list each test exercises explicit.
 */

/** The real HTML an overloaded FOSSGIS backend returns, trimmed. */
const DISPATCHER_HTML = `<?xml version="1.0" encoding="UTF-8"?>
<html><body>
<p>The data included in this document is from www.openstreetmap.org.</p>
<p><strong style="color:#FF0000">Error</strong>: runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request. </p>
</body></html>`;

const BAD_QUERY_HTML = `<html><body>
<p><strong style="color:#FF0000">Error</strong>: line 2: parse error: Unknown type "aria" </p>
</body></html>`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * A `Response` body can only be read once, so a mock that resolves to a single
 * instance breaks on the second attempt - and a retry test whose second
 * attempt fails for the wrong reason is worse than no test. These build a new
 * response per call.
 */
/** Asserts the promise rejected with an AppError and hands it back, narrowed. */
async function captureError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected the operation to fail, but it succeeded");
}

function always(make: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => make());
}

function osmNode(id: number, tags: Record<string, string>) {
  return { type: "node", id, lat: 19.07, lon: 72.87, tags };
}

/**
 * The resolved administrative area, which the query asks for explicitly.
 * Its presence is what separates "this place holds none of these" from "this
 * server could not find this place".
 */
function osmArea(id = 3_600_000_001) {
  return { type: "area", id };
}

const ENV_KEYS = [
  "OVERPASS_API_URL",
  "OVERPASS_API_URLS",
  "OVERPASS_MAX_ATTEMPTS",
  "OVERPASS_DEADLINE_MS",
  "OVERPASS_TIMEOUT_MS",
  "APP_MODE",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // Realistic, because the budget is load-bearing: backoff between attempts is
  // real time, and an artificially tiny deadline made the client skip the very
  // retries these tests exist to check.
  process.env.OVERPASS_DEADLINE_MS = "30000";
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------ classification */

describe("Overpass failure classification", () => {
  it("treats 429 as retryable and honours Retry-After", () => {
    const c = classifyOverpassResponse({
      status: 429,
      contentType: "text/html",
      body: "",
      retryAfter: "7",
    });
    expect(c.outcome).toBe("retryable");
    expect(c.retryAfterMs).toBe(7000);
  });

  it("treats 503 and 504 as retryable, and reads the dispatcher's own words", () => {
    for (const status of [502, 503, 504]) {
      const c = classifyOverpassResponse({
        status,
        contentType: "text/html",
        body: DISPATCHER_HTML,
      });
      expect(c.outcome).toBe("retryable");
      expect(c.reason).toContain("too busy");
    }
  });

  it("treats 400 as fatal, because retrying our own bad query cannot fix it", () => {
    const c = classifyOverpassResponse({
      status: 400,
      contentType: "text/html",
      body: BAD_QUERY_HTML,
    });
    expect(c.outcome).toBe("fatal");
    expect(c.reason).toContain("parse error");
  });

  it("does not accept a 200 that is not JSON", () => {
    const c = classifyOverpassResponse({
      status: 200,
      contentType: "text/html",
      body: DISPATCHER_HTML,
    });
    expect(c.outcome).toBe("retryable");
  });

  it("accepts a 200 that is JSON", () => {
    const c = classifyOverpassResponse({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
    expect(c.outcome).toBe("ok");
  });

  it("extracts the error line from an Overpass HTML page", () => {
    expect(overpassErrorText(DISPATCHER_HTML)).toContain("Dispatcher_Client");
    expect(overpassErrorText("<html><body>nothing</body></html>")).toBeNull();
  });
});

/* -------------------------------------------------------- retry and failover */

describe("Overpass retry and failover", () => {
  it("retries the primary after a 504 and succeeds on the second attempt", async () => {
    process.env.OVERPASS_API_URLS = "https://a1.test/api/interpreter";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(htmlResponse(DISPATCHER_HTML, 504))
      .mockResolvedValueOnce(jsonResponse({ elements: [osmNode(1, { name: "X" })] }));

    const out = await runOverpassQuery("[out:json];out;");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.elements).toHaveLength(1);
    expect(out.attempts).toHaveLength(2);
    expect(out.attempts[0]).toMatchObject({ status: 504, outcome: "retryable" });
    expect(out.attempts[1]).toMatchObject({ status: 200, outcome: "ok" });
  });

  it("falls over to the next endpoint when the primary stays down", async () => {
    process.env.OVERPASS_API_URLS =
      "https://b1.test/api/interpreter,https://b2.test/api/interpreter";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(htmlResponse(DISPATCHER_HTML, 504))
      .mockResolvedValueOnce(htmlResponse(DISPATCHER_HTML, 504))
      .mockResolvedValueOnce(jsonResponse({ elements: [osmNode(2, { name: "Y" })] }));

    const out = await runOverpassQuery("[out:json];out;");

    expect(out.host).toBe("b2.test");
    expect(out.elements).toHaveLength(1);
    // Primary twice (a 504 is a real answer, and a retry re-rolls the
    // round-robin), then the fallback.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new URL(fetchMock.mock.calls[0][0] as URL).hostname).toBe("b1.test");
    expect(new URL(fetchMock.mock.calls[2][0] as URL).hostname).toBe("b2.test");
  });

  it("recovers from a network-level failure on the primary", async () => {
    process.env.OVERPASS_API_URLS =
      "https://c1.test/api/interpreter,https://c2.test/api/interpreter";
    const dnsFail = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ENOTFOUND" },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(dnsFail)
      .mockResolvedValueOnce(jsonResponse({ elements: [osmNode(3, { name: "Z" })] }));

    const out = await runOverpassQuery("[out:json];out;");
    expect(out.host).toBe("c2.test");
    expect(out.attempts[0].reason).toContain("ENOTFOUND");
    // A host that never answered is not asked twice.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an invalid query, on any endpoint", async () => {
    process.env.OVERPASS_API_URLS =
      "https://d1.test/api/interpreter,https://d2.test/api/interpreter";
    const fetchMock = always(() => htmlResponse(BAD_QUERY_HTML, 400));

    await expect(runOverpassQuery("[out:json];bad;")).rejects.toMatchObject({
      kind: "provider-error",
      retryable: false,
    });
    // Exactly one: a malformed query is our bug, and three more servers
    // agreeing about it would tell us nothing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never exceeds the configured attempt budget", async () => {
    process.env.OVERPASS_API_URLS = [
      "https://e1.test/api/interpreter",
      "https://e2.test/api/interpreter",
      "https://e3.test/api/interpreter",
      "https://e4.test/api/interpreter",
      "https://e5.test/api/interpreter",
    ].join(",");
    process.env.OVERPASS_MAX_ATTEMPTS = "3";
    const fetchMock = always(() => htmlResponse(DISPATCHER_HTML, 503));

    await expect(runOverpassQuery("[out:json];out;")).rejects.toBeInstanceOf(AppError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports rate limiting as rate limiting, not as an outage", async () => {
    process.env.OVERPASS_API_URLS = "https://f1.test/api/interpreter";
    process.env.OVERPASS_MAX_ATTEMPTS = "2";
    always(() => new Response("slow down", { status: 429, headers: { "content-type": "text/plain" } }));

    const err = await captureError(runOverpassQuery("[out:json];out;"));
    expect(err.kind).toBe("rate-limited");
    expect(err.message).toMatch(/slow down/i);
    expect(err.retryable).toBe(true);
  });

  it("names every endpoint it tried when all of them fail", async () => {
    process.env.OVERPASS_API_URLS =
      "https://g1.test/api/interpreter,https://g2.test/api/interpreter";
    process.env.OVERPASS_MAX_ATTEMPTS = "3";
    always(() => htmlResponse(DISPATCHER_HTML, 504));

    const err = await captureError(runOverpassQuery("[out:json];out;"));
    expect(err.kind).toBe("unreachable");
    expect(err.message).toContain("2 of 2 endpoints");
    expect(err.detail).toContain("g1.test");
    expect(err.detail).toContain("g2.test");
  });

  it("treats a server-side query timeout as a failure, not as an empty result", async () => {
    process.env.OVERPASS_API_URLS = "https://h1.test/api/interpreter";
    process.env.OVERPASS_MAX_ATTEMPTS = "1";
    always(() => jsonResponse({ elements: [], remark: "runtime error: Query timed out in 'query' at line 3" }));

    // 200 with zero elements and a remark is Overpass giving up. Reporting
    // that as "no businesses found" would be a wrong answer, not a failure.
    await expect(runOverpassQuery("[out:json];out;")).rejects.toBeInstanceOf(AppError);
  });

  it("still makes one request when the budget is smaller than an attempt", async () => {
    // A deadline shorter than the per-attempt floor must shorten the attempt,
    // not cancel it. Skipping outright produced "0 attempts across 0
    // endpoints" - a failure that never asked anyone anything.
    process.env.OVERPASS_API_URLS = "https://p1.test/api/interpreter";
    process.env.OVERPASS_DEADLINE_MS = "800";
    const fetchMock = always(() => jsonResponse({ elements: [osmNode(1, { name: "Quick" })] }));

    const out = await runOverpassQuery("[out:json];out;");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.elements).toHaveLength(1);
  });

  it("shares the budget so a dead primary cannot starve the fallbacks", () => {
    process.env.OVERPASS_TIMEOUT_MS = "25000";
    // 60s left, two endpoints to try, two attempts at this one: 15s.
    expect(attemptTimeout(60_000, 2, 2)).toBe(15_000);
    // Last endpoint, last try: it may use everything that is left.
    expect(attemptTimeout(20_000, 1, 1)).toBe(20_000);
    // Never longer than the configured per-attempt ceiling.
    expect(attemptTimeout(600_000, 1, 1)).toBe(25_000);
    // Never below the floor, so a long endpoint list cannot slice attempts
    // down to less time than a loaded server takes to answer.
    expect(attemptTimeout(45_000, 4, 2)).toBe(10_000);
    // Never zero, however little is left.
    expect(attemptTimeout(300, 4, 2)).toBeGreaterThanOrEqual(300);
  });

  it("does not re-queue at a host that never answered", async () => {
    // Overpass holds requests past its two-slot limit rather than refusing
    // them, so an over-limit client sees a timeout, not a 429. Retrying that
    // same host takes another slot and lengthens the queue for everyone.
    process.env.OVERPASS_API_URLS =
      "https://q1.test/api/interpreter,https://q2.test/api/interpreter";
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(jsonResponse({ elements: [osmNode(1, { name: "Next" })] }));

    const out = await runOverpassQuery("[out:json];out;");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[1][0] as URL).hostname).toBe("q2.test");
    expect(out.host).toBe("q2.test");
  });

  it("refuses an endpoint pointed at a private address", async () => {
    process.env.OVERPASS_API_URLS = "http://169.254.169.254/api/interpreter";
    process.env.OVERPASS_MAX_ATTEMPTS = "2";
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(runOverpassQuery("[out:json];out;")).rejects.toBeInstanceOf(AppError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------- query shaping */

describe("Overpass query construction", () => {
  it("constrains the area to an administrative boundary and matches it exactly", () => {
    const q = buildQuery({ name: "Mumbai", mode: "exact" }, ['["amenity"="dentist"]'], 2);
    expect(q).toContain('area["name"="Mumbai"]["boundary"="administrative"]');
    // The unconstrained case-insensitive regex is what made this expensive
    // enough to time out server-side.
    expect(q).not.toContain('~"^Mumbai$"');
    expect(q).toContain('nwr["amenity"="dentist"](area.searchArea)');
    // Emitting the area is what makes "place not found" distinguishable.
    expect(q).toContain(".searchArea out ids;");
    expect(q).toMatch(/^\[out:json]\[timeout:25];/);
  });

  it("only reaches for the tolerant regex on the loose rung", () => {
    const q = buildQuery({ name: "mumbai", mode: "loose" }, ['["amenity"="dentist"]'], 2);
    expect(q).toContain('area["name"~"^mumbai$",i]["boundary"="administrative"]');
  });

  it("escalates from the narrowest name to a tolerant city match", () => {
    expect(areaPlans({ city: "Mumbai", area: "Bandra" })).toEqual([
      { name: "Bandra", mode: "exact" },
      { name: "Mumbai", mode: "exact" },
      { name: "Mumbai", mode: "loose" },
    ]);
    expect(areaPlans({ city: "Mumbai", area: null })).toEqual([
      { name: "Mumbai", mode: "exact" },
      { name: "Mumbai", mode: "loose" },
    ]);
    expect(areaPlans({ city: "", area: null })).toEqual([]);
  });

  it("cannot be made to inject a quote or a regex out of a place name", () => {
    const q = buildQuery({ name: 'Mum"bai', mode: "exact" }, ['["amenity"="cafe"]'], 2);
    expect(q).toContain('area["name"="Mumbai"]');

    const loose = buildQuery({ name: "a.*b", mode: "loose" }, ['["amenity"="cafe"]'], 2);
    expect(loose).toContain("a\\.\\*b");
  });

  it("asks for a workable pool without letting a large target balloon", () => {
    // `out` truncates a result the server already computed, so a floor is
    // nearly free and stops the website filter from emptying a small campaign.
    expect(resultBudget(2)).toBe(25);
    expect(resultBudget(50)).toBe(150);
    expect(resultBudget(200)).toBe(200);
  });

  it("maps known categories to tags and says so when it cannot", () => {
    expect(filtersFor("Dental").exact).toBe(true);
    expect(filtersFor("Dental").filters.join()).toContain("dentist");
    expect(filtersFor("Artisanal candle whittling").exact).toBe(false);
  });
});

/* ------------------------------------------------------------- provider layer */

describe("OpenStreetMap provider", () => {
  const query: DiscoveryQuery = {
    category: "Dental",
    country: "India",
    city: "Mumbai",
    area: null,
    limit: 2,
    websiteFilter: "any",
  };

  it("returns normalised records from a real-shaped response", async () => {
    process.env.OVERPASS_API_URLS = "https://i1.test/api/interpreter";
    always(() => jsonResponse({
        elements: [
          osmNode(1, {
            name: "Smile Dental",
            "contact:website": "smiledental.example",
            phone: "+91 22 1234 5678",
            "addr:street": "Linking Road",
            "addr:city": "Mumbai",
            opening_hours: "Mo-Sa 10:00-19:00",
          }),
          osmNode(2, { name: "City Dental" }),
        ],
      }));

    const res = await new OpenStreetMapProvider().search(query);

    expect(res.isMock).toBe(false);
    expect(res.providerId).toBe("openstreetmap");
    expect(res.records).toHaveLength(2);
    expect(res.records[0].name).toBe("Smile Dental");
    expect(res.records[0].website).toBe("https://smiledental.example/");
    expect(res.records[0].hours).toEqual({ raw: "Mo-Sa 10:00-19:00" });
    // OSM holds no ratings at all; zero would be a fabricated fact.
    expect(res.records[0].rating).toBeNull();
    expect(res.records[0].reviewCount).toBeNull();
    expect(res.attribution).toContain("OpenStreetMap");
  });

  it("distinguishes a successful empty result from a failure", async () => {
    process.env.OVERPASS_API_URLS = "https://j1.test/api/interpreter";
    // The area resolved; it simply holds no dentists.
    always(() => jsonResponse({ elements: [osmArea()] }));

    const res = await new OpenStreetMapProvider().search(query);

    expect(res.records).toEqual([]);
    expect(res.notes?.join(" ")).toContain("empty result, not a failed one");
    expect(res.notes?.join(" ")).toContain("knows Mumbai");
  });

  it("does not report an unresolvable place as an empty result", async () => {
    process.env.OVERPASS_API_URLS = "https://j2.test/api/interpreter";
    // Zero areas and zero features: nothing was searched. Calling this "no
    // businesses found" would be a wrong answer rather than a thin one, and
    // it is exactly what a server with an unbuilt area index returns.
    always(() => jsonResponse({ elements: [] }));

    const res = await new OpenStreetMapProvider().search(query);

    expect(res.records).toEqual([]);
    const notes = res.notes?.join(" ") ?? "";
    expect(notes).toContain("No OpenStreetMap administrative boundary matched");
    expect(notes).not.toContain("empty result, not a failed one");
  });

  it("stops laddering once the place resolved but held nothing", async () => {
    process.env.OVERPASS_API_URLS = "https://j3.test/api/interpreter";
    const fetchMock = always(() => jsonResponse({ elements: [osmArea()] }));

    await new OpenStreetMapProvider().search(query);
    // Asking a second, looser question would only re-answer the first.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws rather than returning zero records when every endpoint fails", async () => {
    process.env.OVERPASS_API_URLS = "https://k1.test/api/interpreter";
    process.env.OVERPASS_MAX_ATTEMPTS = "2";
    always(() => htmlResponse(DISPATCHER_HTML, 504));

    await expect(new OpenStreetMapProvider().search(query)).rejects.toBeInstanceOf(AppError);
  });

  it("stops at the first rung that finds anything", async () => {
    process.env.OVERPASS_API_URLS = "https://l1.test/api/interpreter";
    const fetchMock = always(() => jsonResponse({ elements: [osmNode(1, { name: "Smile Dental" })] }));

    await new OpenStreetMapProvider().search({ ...query, area: "Bandra" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("escalates to the next rung only when a rung comes back empty", async () => {
    process.env.OVERPASS_API_URLS = "https://m1.test/api/interpreter";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ elements: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ elements: [osmArea(), osmNode(9, { name: "Found Later" })] }),
      );

    const res = await new OpenStreetMapProvider().search(query);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.records[0].name).toBe("Found Later");
  });

  it("skips unnamed features and honours the website filter, and says so", async () => {
    process.env.OVERPASS_API_URLS = "https://n1.test/api/interpreter";
    always(() => jsonResponse({
        elements: [
          osmNode(1, { amenity: "dentist" }), // no name
          osmNode(2, { name: "Has Site", website: "https://has-site.example" }),
          osmNode(3, { name: "No Site" }),
        ],
      }));

    const res = await new OpenStreetMapProvider().search({ ...query, websiteFilter: "none" });

    expect(res.records.map((r) => r.name)).toEqual(["No Site"]);
    const notes = res.notes?.join(" ") ?? "";
    expect(notes).toContain("no name tag");
    expect(notes).toContain("website filter");
  });

  it("carries the ODbL credit on the provider, for pages that show stored data", () => {
    expect(findBusinessDataProvider("openstreetmap")?.attribution).toContain("ODbL");
    // An unknown id must not inherit somebody else's credit line.
    expect(findBusinessDataProvider("not-a-provider")).toBeUndefined();
  });
});

/* -------------------------------------------------- provider selection & mode */

describe("provider selection", () => {
  it("honours an explicit choice over the configured default", () => {
    expect(getBusinessDataProvider("openstreetmap").id).toBe("openstreetmap");
    expect(getBusinessDataProvider("mock").isMock).toBe(true);
  });

  it("defaults to the free provider in live mode and never to mock", async () => {
    // APP_MODE is resolved once, when the config module loads - correct for a
    // server that boots with its environment already set. So this reloads the
    // module instead of making production code re-read env on every access.
    process.env.APP_MODE = "live";
    vi.resetModules();
    const registry = await import("@/providers/business-data");
    const chosen = registry.getBusinessDataProvider(null);
    expect(chosen.isMock).toBe(false);
    expect(chosen.id).toBe("openstreetmap");
  });

  it("keeps working for callers that pass no provider id at all", () => {
    // Seeds and internal callers predate the providerId field; they must still
    // resolve to something usable rather than throwing.
    expect(getBusinessDataProvider(undefined).id).toBeTruthy();
  });

  it("never substitutes mock data for a real provider that failed", async () => {
    process.env.APP_MODE = "live";
    process.env.OVERPASS_API_URLS = "https://o1.test/api/interpreter";
    process.env.OVERPASS_MAX_ATTEMPTS = "2";
    always(() => htmlResponse(DISPATCHER_HTML, 504));

    const provider = getBusinessDataProvider("openstreetmap");

    // The failure propagates. There is no path from "the free provider is
    // down" to "here are some plausible businesses".
    await captureError(
      provider.search({
        category: "Dental",
        country: "India",
        city: "Mumbai",
        area: null,
        limit: 2,
        websiteFilter: "any",
      }),
    );
  });
});
