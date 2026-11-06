# Phase 11 Human UAT (pending human)

Not verified in a browser by the autonomous run. Please check (run with `SEARCH_EMBEDDINGS=off` and again with embeddings on):

- [ ] Open /agents/<slug> for a seeded agent: a "Related agents" section appears under the technical accordion with up to 4 cards, never the current agent.
- [ ] Cards look right at mobile and desktop widths; keyboard focus ring visible; Tab order sensible.
- [ ] Clicking a related card loads the other agent's page with fresh content (title, accordion, customization panel).
- [ ] An agent with no overlapping tags/category shows no section (no empty heading).
- [ ] Related suggestions look sensible on the real catalog (weights in D-027 are untuned on real data).
