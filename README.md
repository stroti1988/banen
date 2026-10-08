# Banen

When and where you can swim laps (banenzwemmen) between Noordwijk, Katwijk, Leiden and Wassenaar. Lap swimming only: no recreational swimming, lessons or aqua classes.

**App:** https://stroti1988.github.io/banen/

To install on iPhone, open the link in Safari and choose Share → Add to Home Screen.

## Pools

| Pool | Town | Times come from |
|---|---|---|
| BinnenZee | Noordwijk | Sportfondsen schedule feed, checked daily |
| Aquamar | Katwijk | Aquamar's dated schedule feed (4 weeks ahead, includes holidays), checked daily |
| Poelmeer | Oegstgeest | Built-in only. Optisport blocks automated requests |
| De Zijl | Leiden | Timetable table on sportinleiden.nl, checked daily |
| De Vliet | Leiden | Timetable table on sportinleiden.nl, checked daily |
| Het Wedde | Voorschoten | Sportfondsen schedule feed, checked daily |
| Sterrenbad | Wassenaar | Sportfondsen schedule feed, checked daily |

Closed for now: De Does in Leiderdorp (renovation until about February 2027) and the outdoor pool at De Vliet (reopens in May).

## How the times stay current

- `index.html` contains hand-checked times with lane notes, last checked on 8 October 2026 (`CHECKED`, `POOLS`, `HOLIDAYS`).
- `.github/workflows/refresh-times.yml` runs `scripts/fetch-times.mjs` every morning at 04:15 UTC and commits the result as `times.json`.
- The app compares each pool's live weekly timetable with the version saved on 8 October (`BASELINE` in `index.html`):
  - **Unchanged:** the app shows the hand-checked times and lane notes, marked as confirmed.
  - **Changed:** the app switches to the pool's own times and shows a notice.
  - **Aquamar:** each date in its dated feed is checked separately, so holidays and one-off changes appear for that date only.
- If `times.json` is more than 4 days old, or a pool's check fails, the app falls back to the built-in times and says so.

To run the check by hand: `node scripts/fetch-times.mjs`, or start **Refresh swim times** from the Actions tab.

## After re-checking times by hand

1. Edit `POOLS` (and `HOLIDAYS` if needed) in `index.html` and set `CHECKED` to the new date.
2. Run `node scripts/fetch-times.mjs` and replace the `BASELINE` strings with the new weekly fingerprints, so the app knows the new timetables are the reviewed ones.
3. Commit and push. GitHub Pages updates within a minute.

## Files

- `index.html`: the whole app (HTML, CSS and JS in one file)
- `scripts/fetch-times.mjs`: daily fetcher (Node 20, no dependencies)
- `times.json`: latest automatic check, written by the workflow
- `manifest.webmanifest`, `icon-*.png`: home-screen app name and icon
