# GridGuide submission video script

**Required in the video:** team name · project name · project concept details · project execution details · your process (decisions you made and why)

**Target length:** 2:55 (hard cap 3:00) · **Narration:** about 430 words at a brisk, natural pace (~150 words per minute) · **Format:** screen recording with voiceover

Team **TCC**: Avaneesh Kad, Dylan Levy, Cavan Moriarty. The title card is `title.html` (open `/title.html`) or the ready-made image `public/title-card.png` (1920×1080).

| Required item | Where it is in the script | Time |
| --- | --- | --- |
| Team name | Intro | 0:00 |
| Project name | Intro, title card, close | 0:00 |
| Project concept details | Concept | 0:12–0:32 |
| Project execution details | Execution (map, isolation, issues, customer page) | 0:32–2:08 |
| Process and decisions | Our process | 2:08–2:45 |

**Before recording**
- Run `bun run dev` (web app and API server both up). Open two tabs: `/map.html` and `/client.html`.
- Map: dark basemap with the default layers on (primary conductors, transformers, devices, ARCOS, emergency services).
- Client tab: clear the saved premise (`localStorage` key `gridguide.premise`) so the address prompt shows.
- Have **7249 Willow Valley** ready (open damage reports nearby).
- Record at 1080p, browser zoom 110%. Hide bookmarks and notifications.
- Put the title card (`public/title-card.png`) on screen for the first 3 seconds.

---

## 0:00–0:12 · Intro (team name + project name)

**On screen:** Title card (GridGuide · Team TCC · Avaneesh Kad, Dylan Levy, Cavan Moriarty), then cut to the map overview with all layers on.

**Narration:**
"Hi, we're **TCC**, and this is **GridGuide**: a tool that helps crews decide what to fix first after a storm, and tells customers what to expect."

---

## 0:12–0:32 · Project concept

**On screen:** Slow zoom over the dense part of the network. Briefly show both pages side by side (map and client chat).

**Narration:**
"After a storm, crews need three answers fast: what's damaged, who loses power if we open a switch, and what to fix first. Customers just want to know when their lights come back. Our idea is one dataset serving two audiences, built from the utility's own shapefiles and upstream equipment data, so both get answers grounded in the real network."

---

## 0:32–2:08 · Project execution

### 0:32–1:00 · Network map (28s)

**On screen:**
1. Toggle layers in the **Layers** tab. Point out primary lines colored by phase count.
2. Open a **Filters** dropdown (Reclosers → untick *Electronic*).
3. Show the **Equipment order** card; click the top ordering so its transformers highlight.
4. Zoom in and click a premise: numbered fuses and reclosers light up along the path to the breaker.

**Narration:**
"We merged two shapefile sets into one interactive map: conductors, poles, transformers, fuses, reclosers, hospitals and fire stations. Every layer filters on its own attributes. Click any premise and you see exactly what feeds it, step by step, back to the substation. Premises are anonymous: no names, no addresses."

### 1:00–1:22 · Where to open the circuit (22s)

**On screen:**
1. Click an **ARCOS damage** report. The red *open here* marker appears, a dashed line runs to it, affected transformers highlight.
2. Inspect panel: Isolation plan card, then the **person-hours** card. Hold 2s.

**Narration:**
"Click a damage report and GridGuide picks the best device to open: the nearest fuse, recloser or switch upstream, so the fewest customers lose power while linemen work. It also estimates repair person-hours from the labor tables and the 4.5 indirect-labor multiplier."

### 1:22–1:38 · Prioritizing the work (16s)

**On screen:** **Issues** tab → select all → **Prioritize** → point at a row with a nearby hospital → click a row (map zooms, list stays) → **CSV**.

**Narration:**
"Pick the issues and it ranks them by customers affected, life-support customers, and nearby hospitals, fire stations and ambulance services. Click one to jump to it, or export the list."

### 1:38–2:08 · The customer experience (30s)

**On screen:**
1. **Client** page: type "7249 willow", pick the match. The map flies in to the house.
2. Red outage pins appear and the map zooms out to fit house and outages. Hold 3s on the risk band.
3. Click **When will power return?** (hours range).
4. Type: *"How long will my food stay safe?"* and let the answer stream (speed up the wait).

**Narration:**
"Customers type their address and the satellite map flies to their home. Nearby outages appear in the same frame, with a color-coded risk band and a confidence indicator. They get a restoration range in hours, not a promise, and a language model answers other outage questions using their own situation."

---

## 2:08–2:45 · Our process (decisions and why)

**On screen:** Quick cuts: the Equipment order card, the Isolation plan card, the address lookup, the risk band, then the repo or a simple slide with four bullets (below). Keep each cut about 6–8 seconds.

**Narration (adapt to your real story):**
"A few decisions shaped the project. First, we used the utility's matched upstream paths to get the direction of power flow instead of guessing it from geometry. Our early guess was wrong about half the time, and the real data fixed it. Second, we kept customers anonymous on the map and moved address lookup to the server, so the address list never reaches a browser. Third, we show ranges and estimates, never promises, because we can't claim crew timing we don't have. And we narrowed scope on purpose: no customer outage self-reporting, so the tool stays grounded in utility data. We tested each feature in a real browser as we built, which caught several bugs early."

**Slide bullets (optional):**
- Used real upstream data, not inferred direction
- Anonymous map, server-side address lookup
- Ranges and estimates, not promises
- Scoped out self-reporting on purpose

---

## 2:45–2:55 · Close

**On screen:** Back to the full map, then the title card again (project name, team name).

**Narration:**
"One dataset, two audiences: faster, safer decisions for crews, and clear answers for customers. We're **TCC**, and this was **GridGuide**. Thanks for watching."

---

## Honesty notes (use in the voiceover or as on-screen captions if asked)

- Restoration times and person-hours are **estimates** from standard repair hours, not utility commitments.
- The damage reports come from the supplied storm dataset, so many addresses show no open outage. The client page's debug option can include already-repaired reports for demos.
- Isolation plans do not model back-feeding from normally-open ties.
- The address lookup has no sign-in yet and must be protected before real customers use it.

## Shot list (for editing)

| Time | Shot | Notes |
| --- | --- | --- |
| 0:00 | Title card, then map overview | `public/title-card.png` |
| 0:12 | Slow zoom, both pages | Concept |
| 0:32 | Layers + filters | Cursor highlight on checkboxes |
| 0:45 | Equipment order + premise trace | Pause 2s on numbered path |
| 1:00 | ARCOS click, isolation marker | Zoom to the red *open here* icon |
| 1:12 | Person-hours card | Hold 2s |
| 1:22 | Issues, Prioritize, ranked list | Highlight the hospital line |
| 1:38 | Client page, address entry | Let the zoom animation play fully |
| 1:52 | Outage pins + risk band | Hold on the band 3s |
| 1:58 | Restoration range + LLM answer | Speed up the streaming wait |
| 2:08 | Process cuts or slide | 4 cuts, ~8s each |
| 2:45 | Closing title card | Fade out |
