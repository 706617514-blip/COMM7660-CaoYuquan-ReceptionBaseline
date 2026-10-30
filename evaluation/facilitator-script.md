# Facilitator script

Read this immediately before each session. Its job is to keep you from explaining the
interface, which is the most common way a usability session produces useless data.

---

## Before the participant joins

- [ ] Tool open in a **fresh** browser tab, at default state (75%, 10 titles, no floor)
- [ ] Deployment URL works — not `localhost`, not a file path
- [ ] Observation sheet open, participant code assigned (P1, P2, …)
- [ ] Consent section read and confirmed
- [ ] You have decided **not** to demonstrate anything

---

## Opening (say this, roughly)

> Thanks for this. I'm testing the tool, not you. There are no wrong answers — if
> something is confusing, that's the thing I need to know, and it's the most useful thing
> you can tell me.
>
> I'd like you to think out loud as you go: just say what you're looking at and what
> you're expecting. I probably won't answer questions about how it works, not to be
> difficult, but because I want to see what it does on its own.
>
> You can stop any time.

Then: **stay quiet.** Resist the urge to fill silences.

---

## Task 1 — get a percentile (about 4 minutes)

> Open this link. (Send the URL; let them type or click it themselves.)
>
> Have a look at the page, then tell me: if you were getting ready to launch a game,
> what positive review rate would you expect for it? Put that in and tell me what you
> see.

**Watch for:** do they understand the input is a rate out of 100? Do they read the
disclosure box or skip it? Do they find the percentile without prompting?

**Do not:** tell them where to type. If they are stuck for more than ~30 seconds, note
"needed direction" and then help minimally, and record that help — it is a finding.

---

## Task 2 — use the discovery list (about 3 minutes)

> Scroll down. There's a list of games. Open one — whichever interests you — and tell me
> what you learn from it.

**Watch for:** do they click a title at all? Do they understand *why* these particular
games are listed? Do they try to compare the game to their own project?

**Do not:** explain that the list is ordered by distance in review rate. If they ask,
say "what would you expect it to be ordered by?" and record the answer — that question
is one of the most valuable outputs of the whole pilot.

---

## Task 3 — the two view controls (about 2 minutes)

> There are two dropdowns. Change them and tell me what happens.

**Watch for:** do they notice the percentile does *not* change? Do they read the amber
notice when they raise the review floor? Does the notice make sense to them, or does it
read as a warning that something is broken?

---

## Question 4 — comprehension (about 1 minute) — **scored measure**

Ask exactly this, and record the answer verbatim before judging it:

> If you changed this to a different genre — say from action to puzzle — would the
> percentile change?

**Correct:** no, the tool does not use genre (and does not offer it as an input).
**Incorrect:** yes, or "it should".

Record: correct / incorrect / unclear, plus what they actually said. Do not coach.

---

## Questions 5–6 — open (about 2 minutes)

> Without this tool, how would you have answered the question about what rate to expect?

> What's missing, or what would make this useless to you?

Note the answers nearly verbatim. These usually produce the revision.

---

## Closing

> That's everything. Anything you want to add? I'll use your notes as P___.

Then, after they leave, **write up the observation sheet immediately**, while you still
remember what happened. Do not tidy the notes into conclusions — record events.

---

## Things that invalidate a session

Mark the session as excluded and say so in the report if any of these happened. An
excluded session is honest; a session where you explained the answer is not.

- The participant had already seen the tool.
- You explained what a control does before they tried it.
- You told them what the "right" answer was, or reacted to a wrong one.
- You filled in parts of the sheet from memory a day later rather than at the time.

---

## After all sessions

Run the analysis in `evaluation/pilot-plan.md`, then write the revision into
`docs/release-notes.md` under release 2 — **naming the specific observation** that
motivated each change.
