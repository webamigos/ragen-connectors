/**
 * The upstream API client.
 *
 * Two rules this file exists to demonstrate:
 *
 * - **Native `fetch`, with a timeout on every request.** An MCP tool call is
 *   inside a user's chat turn; an upstream that never answers holds that turn
 *   open until something else gives up. `AbortSignal.timeout` is the floor.
 * - **Throw here, envelope in the tool.** This layer raises ordinary errors and
 *   the tool layer shapes them. Mixing the two means a tool that sometimes
 *   throws.
 *
 * The example calls Open-Meteo, which needs no API key. Replace it with your
 * own upstream — and if yours needs a per-customer credential, read
 * `../auth.ts` first.
 */

const TIMEOUT_MS = 30_000;

export interface Place {
  name: string;
  country: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
}

export interface CurrentWeather {
  temperatureC: number;
  windSpeedKph: number;
  observedAt: string;
}

export async function findPlace(
  name: string,
  credential: string | null,
): Promise<Place[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "5");

  const body = await getJson(url, credential);
  const results = (body as { results?: unknown[] }).results ?? [];

  // A record that does not decode is dropped rather than returned with NaN
  // coordinates. `Number(undefined)` is NaN and JSON.stringify writes it as
  // `null`, so an unchecked mapping hands the model a confident answer about
  // a place at no location — the worst shape a tool result can take.
  return results.flatMap((entry) => {
    const place = entry as Record<string, unknown>;
    const latitude = Number(place.latitude);
    const longitude = Number(place.longitude);
    if (
      typeof place.name !== "string" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return [];
    }
    return [
      {
        name: place.name,
        country: typeof place.country === "string" ? place.country : null,
        latitude,
        longitude,
        timezone: typeof place.timezone === "string" ? place.timezone : null,
      },
    ];
  });
}

export async function currentWeather(
  latitude: number,
  longitude: number,
  credential: string | null,
): Promise<CurrentWeather> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,wind_speed_10m");

  const body = await getJson(url, credential);
  const current = (body as { current?: Record<string, unknown> }).current;
  if (!current) {
    throw new Error("the upstream returned no current conditions");
  }

  const temperatureC = Number(current.temperature_2m);
  const windSpeedKph = Number(current.wind_speed_10m);
  if (!Number.isFinite(temperatureC) || !Number.isFinite(windSpeedKph)) {
    // Thrown, so the tool layer shapes it into the failure envelope. Reporting
    // `success: true` with NaN readings would be answered by the model as
    // fact.
    throw new Error("the upstream returned conditions that did not decode");
  }

  return {
    temperatureC,
    windSpeedKph,
    observedAt: String(current.time),
  };
}

async function getJson(url: URL, credential: string | null): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: credential ? { Authorization: `Bearer ${credential}` } : {},
  });
  if (!response.ok) {
    // The status is the actionable part — a 401 means the customer's key, a
    // 429 means back off, and neither is visible in a generic "request
    // failed".
    throw new Error(`upstream returned ${response.status} ${response.statusText}`);
  }
  return response.json();
}
