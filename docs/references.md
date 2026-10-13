# References

Formatted in APA 7. Machine-readable versions are in `references.bib`.

**Note on completeness.** Author lists, titles, journals, volumes and DOIs below were retrieved
from Crossref and are verified. Page ranges were **not** retrieved for every entry, so they are
omitted rather than estimated. A reference with a missing page range is incomplete but not wrong;
a guessed page range would be wrong.

## Cited

Byers, T., Gibbs, M., & Nansen, B. (2025). Evaluating time in play and temporal satisfaction:
Time-centric language in video game user reviews on Steam. In *Proceedings of the 37th Australian
Conference on Human-Computer Interaction*. Association for Computing Machinery.
https://doi.org/10.1145/3764687.3764693

Eberhard, L., Kasper, P., Koncar, P., & Gütl, C. (2018). Investigating helpfulness of video game
reviews on the Steam platform. In *2018 Fifth International Conference on Social Networks Analysis,
Management and Security (SNAMS)*. IEEE. https://doi.org/10.1109/SNAMS.2018.8554542

Guzsvinecz, T., & Szűcs, J. (2023). Length and sentiment analysis of reviews about top-level video
game genres on the Steam platform. *Computers in Human Behavior*, *149*, 107955.
https://doi.org/10.1016/j.chb.2023.107955

Ma, J., & Jenkel, H. B. (2025). Cultural insights in game reception. *International Journal of
Gaming and Computer-Mediated Simulations*, *17*(1). https://doi.org/10.4018/IJGCMS.391739

Mai, Y., & Hu, B. (2023). Optimizing free-to-play multiplayer games with premium subscription.
*Management Science*, *69*(6). https://doi.org/10.1287/mnsc.2022.4510

Valve Corporation. (n.d.). *Steamworks documentation: User reviews*. Retrieved 12 October 2026,
from https://partner.steamgames.com/doc/store/getreviews

## How each source is used

| Source | Use in this project |
|---|---|
| Guzsvinecz & Szűcs (2023) | Establishes that review length and sentiment differ systematically **by genre** on Steam, which is why genre enters the model as a control rather than being left in the error term |
| Eberhard et al. (2018) | Shows review helpfulness on Steam is a distinct quantity from recommendation polarity; supports treating the positive rate and review volume as separate variables rather than one proxy for the other |
| Mai & Hu (2023) | Models free-to-play as a monetisation design choice with equilibrium consequences, supporting the treatment of `is_free` as a structural business-model variable rather than a price point |
| Ma & Jenkel (2025) | Documents that game reception varies across audience communities, which is the reason the cross-language concept was deferred: the outcome is computed within each language's own voting pool |
| Byers et al. (2025) | Shows that what reviewers write about shifts with time in play, which motivates the age term and its squared form |
| Valve Corporation (n.d.) | The endpoint documentation governing what may be retrieved and how |
