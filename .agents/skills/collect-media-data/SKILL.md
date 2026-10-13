---
name: collect-media-data
description: Retrieve permitted Steam title-level metadata and review aggregates through documented public endpoints. Use when the PM has approved a source, a field list, a date window, and a sampling rule. Screens candidates from the search index before spending a metadata call. Stops at any rate limit rather than working around it.
version: 0.3.0
adapted_from: original
---

# collect-media-data

## Purpose

Produce permitted raw records with provenance, so that every later analytical quantity can be
traced to a specific retrieval at a specific time.

The unit of collection is the **title**. Review aggregates are retrieved per title; individual
review records are not the analytical unit and are never fetched.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `cutoff` | yes | Data cutoff date. The release window is the 24 months before it. |
| `tags` | yes | Genre tags to walk. These are the sampling strata. |
| `per_quarter` | yes | Quota of titles per (tag, release quarter) cell |
| `min_reviews` | yes | Eligibility floor on `total_reviews`, declared before collection |
| `request_delay` | yes | Minimum spacing between requests. Never lowered to reach a target faster. |

## Outputs

| Path | Contents |
|---|---|
| `data/raw/steam_titles_<stamp>.csv` | One row per title, the analysis input |
| `data/raw/collection_audit_<stamp>.json` | Frame sizes, depth/date map per tag, rejection counts, cells filled |
| `data/raw/checkpoint.json` | Resume state. Intermediate; never a deliverable. |
| `records/skill-log.md` | One appended row |

## Endpoints used, and what each is for

| Endpoint | Role |
|---|---|
| `search/results` | Sampling **only**. Enumerates candidates and reports appid and release date per row. Not a source of any analytical quantity. |
| `appreviews?num_per_page=0` | The summary block: `total_positive`, `total_negative`, `review_score_desc` |
| `appdetails` | Metadata for accepted titles: `genres`, `categories`, `is_free`, price, description |

## Steps

1. Confirm the PM has approved the source, the field list, and the sampling rule. Do not proceed
   on assumption.
2. Seed a depth/date map per tag by probing coarse page depths and reading the release date of the
   middle row on each page. One request per probe.
3. **Screen, then spend.** Read candidates for a target quarter straight from the search response:
   each result row carries the appid and release date, so one request screens a whole page. An
   earlier version of this skill queried `appdetails` once per candidate to learn the release date,
   which cost roughly fifty requests to screen fifty candidates and discarded most of them. Do not
   reintroduce that.
4. Locate the page for each (tag, quarter) cell by interpolating a depth from the observed map and
   correcting until the page brackets the target date. Record every page visited as a new
   calibration point, so the map is measured rather than assumed.
5. For candidates already known to be in the window and in the right quarter, query `appreviews`
   for the aggregate counts. Query `appdetails` only for titles that pass the review floor.
6. Persist each accepted title immediately and checkpoint after every one, so an interrupted run
   never discards completed work.
7. Strip reviewer identifiers before any file becomes committable. No review text is retrieved.

## Checks

- [ ] `total_positive + total_negative` reconciles with the reported total for every accepted title
- [ ] One row per distinct application identifier — no duplicate titles
- [ ] Every accepted title lies inside the declared release window
- [ ] Every accepted title meets the declared review floor
- [ ] Rejection counts by reason are recorded, so the screened-versus-accepted ratio is auditable
- [ ] No request was retried under a modified identity, header, or proxy
- [ ] Each genre stratum produced titles; shortfalls are reported, not hidden
- [ ] Cells that did not reach quota are recorded as shortfalls rather than quietly topped up
- [ ] No reviewer username, Steam ID, or avatar hash remains in any committable file

## Stopping conditions

Stop and report to the PM if any of the following occurs:

- A response indicates rate limiting or a bot challenge. Exit immediately; do not slow down and
  retry, and do not rotate identity.
- A field in the requested list is absent from the documented response.
- The title count falls materially short of the stratification target.
- Achieving the target would require a route not named in the approved source list.

Do not substitute an alternative route to reach the target.
