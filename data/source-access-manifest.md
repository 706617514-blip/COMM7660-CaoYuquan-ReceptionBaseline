# Source and access manifest

## Primary source

| Field | Value |
|---|---|
| Provider | Valve Corporation — Steam |
| Endpoint (reviews) | `https://store.steampowered.com/appreviews/<appid>?json=1` |
| Endpoint (metadata) | `https://store.steampowered.com/api/appdetails?appids=<appid>` |
| Endpoint (index navigation) | `https://store.steampowered.com/search/results/?sort_by=Released_DESC&start=<n>&tags=<tagid>` |
| Documentation | https://partner.steamgames.com/doc/store/getreviews |
| Authentication required | No |
| API key required | No |
| Access conditions | Public documented endpoints. Pagination via the `cursor` parameter returned in each response. |
| Retrieval timestamp | _(recorded at collection)_ |
| Retrieved records | _(recorded at collection)_ |
| Available per title | Recorded from `query_summary.total_reviews`, so retrieved-versus-available is auditable |

### Role of the search endpoint

The store search endpoint is used only for **sampling and index navigation**. Each result row
carries the appid, the release date, the title, the provider's tag ids, and a review-summary
tooltip of the form:

    "Very Positive<br>90% of the 186 user reviews for this game are positive."

The release date and the review count from that tooltip are used to **screen** candidates: they let
the release window and the review floor be applied without spending a request on every candidate.
The review count is a screen, not a measurement. For every accepted title the authoritative counts
are re-retrieved from `appreviews`, and those are the values that enter the dataset, so the screen
can only ever affect which titles are considered — never what any recorded quantity equals.

The endpoint is not a source of any analytical quantity. The positive review rate, the review
counts, the genre and category lists, the price, and the store description all come from
`appdetails` and `appreviews`.

Rows are read from the JSON field `results_html` that the endpoint returns when called with
`infinite=1`. This is the endpoint's own response body, not a page fetched for scraping: no HTML
document is downloaded, no `robots.txt` rule is bypassed, and the request rate is held to one
request per 1.2 seconds with no concurrency. On a rate-limit response the collector exits and
reports rather than retrying.


### Fields retrieved per title

From `appdetails`:
`name`, `type`, `release_date`, `genres`, `categories`, `developers`, `publishers`,
`price_overview`, `is_free`, `metacritic`, `recommendations.total`, `short_description`

From the `appreviews` summary block, the aggregate counts that form the analytical unit:

`query_summary.total_positive`, `query_summary.total_negative`, `query_summary.total_reviews`,
`query_summary.review_score`, `query_summary.review_score_desc`

### Review-level fields

Individual review records are **not** the analytical unit and are retrieved only where a declared
check requires them. Where retrieved, the fields are:

`recommendationid`, `language`, `timestamp_created`, `voted_up`, `votes_up`,
`weighted_vote_score`, `steam_purchase`, `received_for_free`, `written_during_early_access`,
`author.playtime_at_review`, `app_release_date`

The per-review helpfulness field `weighted_vote_score` was evaluated as a candidate outcome and
rejected during the pilot. It is retained in this list for transparency about what was examined.
See `docs/assignment-compliance-notes.md` for the reason.

### Data privacy

Reviewer identifiers, including `author.steamid`, `author.personaname`, `author.profile_url`, and
`author.avatar`, are stripped at collection. They are never written to a committable file.

## Deliberately excluded sources

| Source | Reason for exclusion |
|---|---|
| SteamDB | Its own FAQ directs class projects to alternatives, and the assignment brief names it as a source not to scrape. |
| IMDb | Terms permit only data present in the contributor datasets and prohibit scraping the site. Not pursued for this project. |
| Netflix Top 10 | No bulk export route is published; the downloads path returns the same page as the main listing. Collecting it would require page scraping. |

Recording these exclusions documents that source permission was assessed rather than assumed.

## Personal data handling

- Reviewer usernames, Steam identifiers, avatar hashes, and profile URLs are removed before any
  file is committed to the public record.
- Raw review text is retained only where an analysis genuinely requires it, and is excluded from
  the committed dataset otherwise.
- No account credentials, session cookies, or tokens are stored in this repository.

## Attribution

Review and metadata records retrieved through the Steam Web API, operated by Valve Corporation.
Retrieved in accordance with the endpoint documentation at the URL above.
