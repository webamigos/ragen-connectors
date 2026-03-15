/**
 * Google Calendar API service layer.
 */

import { googleGet, googlePost } from "./google-api.js";

const BASE = "https://www.googleapis.com/calendar/v3";

export async function listCalendars(
  customerId: string,
): Promise<Record<string, unknown>[]> {
  const data = await googleGet(customerId, `${BASE}/users/me/calendarList`);
  return ((data.items ?? []) as Record<string, unknown>[]).map((cal) => ({
    id: cal.id,
    summary: cal.summary ?? "",
    description: cal.description ?? "",
    primary: cal.primary ?? false,
    access_role: cal.accessRole ?? "",
    time_zone: cal.timeZone ?? "",
  }));
}

export async function listEvents(
  customerId: string,
  calendarId = "primary",
  timeMin?: string,
  timeMax?: string,
  maxResults = 10,
  query?: string,
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
  };
  if (timeMin) {
    params.timeMin = timeMin;
  } else {
    params.timeMin = new Date().toISOString();
  }
  if (timeMax) {params.timeMax = timeMax;}
  if (query) {params.q = query;}

  const data = await googleGet(
    customerId,
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    params,
  );

  const events = ((data.items ?? []) as Record<string, unknown>[]).map(formatEvent);

  return {
    calendar_id: calendarId,
    event_count: events.length,
    events,
  };
}

export async function getEvent(
  customerId: string,
  calendarId: string,
  eventId: string,
): Promise<Record<string, unknown>> {
  const data = await googleGet(
    customerId,
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  return formatEvent(data);
}

export async function getFreeBusy(
  customerId: string,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
): Promise<Record<string, unknown>> {
  const data = await googlePost(customerId, `${BASE}/freeBusy`, {
    timeMin,
    timeMax,
    items: calendarIds.map((id) => ({ id })),
  });

  const calendars: Record<string, unknown> = {};
  const calendarsData = (data.calendars ?? {}) as Record<string, Record<string, unknown>>;
  for (const [calId, calData] of Object.entries(calendarsData)) {
    const busyPeriods = ((calData.busy ?? []) as Record<string, string>[]).map((b) => ({
      start: b.start,
      end: b.end,
    }));
    calendars[calId] = {
      busy: busyPeriods,
      busy_count: busyPeriods.length,
    };
  }

  return {
    time_range: { start: timeMin, end: timeMax },
    calendars,
  };
}

function formatEvent(event: Record<string, unknown>): Record<string, unknown> {
  const start = (event.start ?? {}) as Record<string, string>;
  const end = (event.end ?? {}) as Record<string, string>;

  const formatted: Record<string, unknown> = {
    id: event.id ?? "",
    summary: event.summary ?? "(No title)",
    status: event.status ?? "",
    start: start.dateTime ?? start.date ?? "",
    end: end.dateTime ?? end.date ?? "",
    start_time_zone: start.timeZone ?? "",
    end_time_zone: end.timeZone ?? "",
    location: event.location ?? "",
    description: event.description ?? "",
    html_link: event.htmlLink ?? "",
    created: event.created ?? "",
    updated: event.updated ?? "",
    creator: ((event.creator ?? {}) as Record<string, string>).email ?? "",
    organizer: ((event.organizer ?? {}) as Record<string, string>).email ?? "",
  };

  const attendees = event.attendees as Record<string, unknown>[] | undefined;
  if (attendees?.length) {
    formatted.attendees = attendees.map((a) => ({
      email: a.email ?? "",
      display_name: a.displayName ?? "",
      response_status: a.responseStatus ?? "",
      organizer: a.organizer ?? false,
      self: a.self ?? false,
    }));
  }

  return formatted;
}
