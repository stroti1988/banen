// Collects lap-swim (banenzwemmen) times from each pool's own site and writes times.json.
// Runs daily in GitHub Actions; the app falls back to its built-in times for any pool that fails.
// Node 20+, no dependencies.
import { writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (banen lap-swim timetable; https://stroti1988.github.io/banen/)";
const DAY_NL = { maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6, zondag: 7 };
const DAY_EN = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
const pad = n => String(n).padStart(2, "0");
const hhmm = (h, m) => `${pad(h)}:${pad(m)}`;
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function get(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { "user-agent": UA, ...opts.headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

// Sportfondsen: weekly template via their public GraphQL API.
async function sportfondsen(hostname) {
  const query = `query($h:String!){ timeSlots(hostname:$h){ timeslots{ day startTimeFormat endTimeFormat alternateStartTimeFormat alternateEndTimeFormat activitySchedule{ activity{ title } } } } }`;
  const res = await get("https://prd-api.sportfondsen-website.lukkien.com/graphql/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { h: hostname } }),
  });
  const json = await res.json();
  const slots = json?.data?.timeSlots?.timeslots;
  if (!Array.isArray(slots)) throw new Error("No timeslots in response");
  const days = {};
  for (const t of slots) {
    const title = t.activitySchedule?.activity?.title ?? "";
    // "Banenzwemmen" and "Banenzwemmen - Sportief"; not group sessions like "WoB Banenzwemmen".
    if (!/^banenzwemmen/i.test(title)) continue;
    const d = DAY_EN[t.day];
    if (!d) continue;
    const alt = t.alternateStartTimeFormat && t.alternateEndTimeFormat ? [t.alternateStartTimeFormat, t.alternateEndTimeFormat] : null;
    (days[d] ||= []).push([t.startTimeFormat, t.endTimeFormat, title, alt]);
  }
  if (!Object.keys(days).length) throw new Error("No lap-swim slots found");
  return { kind: "weekly", days };
}

// Sport in Leiden: weekly table on the location page, under a "banenzwemmen" heading.
async function sportInLeiden(url) {
  const html = await (await get(url)).text();
  const strip = s => s.replace(/<[^>]+>/g, " ").replace(/&#8211;|&ndash;|–/g, "-").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const before = strip(html.slice(Math.max(0, m.index - 600), m.index)).toLowerCase();
    if (!before.includes("banenzwemmen")) continue;
    const days = {};
    for (const row of m[0].matchAll(/<tr[\s\S]*?<\/tr>/g)) {
      const cells = [...row[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => strip(c[1]));
      const d = DAY_NL[cells[0]?.toLowerCase()];
      if (!d) continue;
      for (const cell of cells.slice(1)) {
        for (const t of cell.matchAll(/(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})/g)) {
          (days[d] ||= []).push([hhmm(+t[1], +t[2]), hhmm(+t[3], +t[4]), "Banenzwemmen"]);
        }
      }
    }
    if (Object.keys(days).length) return { kind: "weekly", days };
  }
  throw new Error("Lap-swim table not found on page");
}

// Aquamar (Zwem Apps): dated events, including holiday schedules.
async function aquamar() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 28);
  const url = `https://zwembadaquamar.nl/wp-admin/admin-ajax.php?action=getlessons&start=${isoDate(from)}T00:00:00&end=${isoDate(to)}T00:00:00&sectionId=8e47a30c-e916-426b-b31f-60711cf7ec39`;
  const events = await (await get(url)).json();
  if (!Array.isArray(events) || !events.length) throw new Error("Empty schedule feed");
  const dates = {};
  for (const e of events) {
    if (e.category !== "Banen zwemmen") continue;
    const date = e.start.slice(0, 10);
    const where = e.extendedProps?.location?.Name ?? "";
    (dates[date] ||= []).push([e.start.slice(11, 16), e.end.slice(11, 16), e.title, where]);
  }
  const last = new Date(to); last.setDate(last.getDate() - 1);
  return { kind: "dated", from: isoDate(from), to: isoDate(last), dates };
}

// Optisport sits behind a bot challenge; this usually fails and the app keeps its built-in times.
async function optisport(locationId, activityId) {
  const token = await (await get("https://www.optisport.nl/api/optisport/token")).text();
  const res = await get("https://www.optisport.nl/api/optisport/v1/upcomingeventsschedule", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": token },
    body: JSON.stringify({ page: 0, locationId, activityId, amount: "medium" }),
  });
  const json = await res.json();
  const list = json.results ?? json.data ?? json.events ?? json;
  if (!Array.isArray(list) || !list.length) throw new Error("Unexpected Optisport response");
  const dates = {};
  let min = null, max = null;
  for (const e of list) {
    if (!e.start || !e.end) continue;
    const date = e.start.slice(0, 10);
    (dates[date] ||= []).push([e.start.slice(11, 16), e.end.slice(11, 16), e.title ?? "Banenzwemmen", e.internalLocation ?? ""]);
    if (!min || date < min) min = date;
    if (!max || date > max) max = date;
  }
  if (!min) throw new Error("No events with times");
  return { kind: "dated", from: min, to: max, dates };
}

const SOURCES = {
  binnenzee: () => sportfondsen("binnenzee.sportfondsen.nl"),
  aquamar,
  poelmeer: () => optisport(2328, 30),
  zijl: () => sportInLeiden("https://www.sportinleiden.nl/zwemmen/locaties/de-zijl/"),
  vliet: () => sportInLeiden("https://www.sportinleiden.nl/zwemmen/locaties/zwembad-de-vliet/"),
  wedde: () => sportfondsen("wedde.sportfondsen.nl"),
  sterrenbad: () => sportfondsen("sterrenbad.sportfondsen.nl"),
};

const out = { generated: new Date().toISOString(), pools: {} };
await Promise.all(Object.entries(SOURCES).map(async ([id, fn]) => {
  try {
    out.pools[id] = { ok: true, ...(await fn()) };
    console.log(`ok    ${id}`);
  } catch (err) {
    out.pools[id] = { ok: false, error: String(err.message ?? err) };
    console.log(`fail  ${id}: ${err.message ?? err}`);
  }
}));
await writeFile(new URL("../times.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
