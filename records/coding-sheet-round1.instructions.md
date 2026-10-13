# Feature-coding sheet — round 1

Coder: PM (student). One row per title. Fill the `mp_human` column yourself.

**Question for each title.** Reading only the retrieved store description, is the title's
core loop social or competitive — that is, does it depend on other players (multiplayer,
co-op, PvP, MMO, shared/split screen)? Enter `1` for yes, `0` for no.

- Judge the *core loop*, not marketing mentions. "Share your score with friends" is not
  multiplayer; "team up with up to four players" is.
- If the description is genuinely ambiguous, enter `?` and say why in `coder_notes`. An
  ambiguous case is a finding, not a failure.
- Do not look up the game on the store, and do not open the analysis dataset: the whole
  point is that this pass is independent of the machine label and of the outcome.

The outcome columns are withheld on purpose. If you can see a title's rating while coding,
you are coding the rating, not the description.

Sheet: `coding-sheet-round1.csv`  
Titles: 32 of 159 (20% subsample, seed 20261009)  
Build the agreement report afterwards with:

    python analysis/make_coding_sheet.py --score coding-sheet-round1.csv
