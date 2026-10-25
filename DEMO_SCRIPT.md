# GridGuide submission video script

**Team TCC:** Avaneesh Kad, Dylan Levy, Cavan Moriarty  
**Target:** 2:55; hard cap 3:00. The original section starts are preserved.  
**Narration:** approximately 375 words, leaving room for visual pauses.  
**Format:** working-prototype screen recording with voiceover. Read only the narration paragraphs aloud.

The model-exploration story incorporates the team's confirmed experiments with XGBoost and an RNN with LSTM, followed by a physics-informed approach. The narration calls the final approach **physics-informed risk**: the current app implementation documents direct physical-load calculations. It does not claim a trained neural network, a measured improvement in accuracy, or a specific reason the earlier models fell short without further confirmation.

## Before recording

- Start the app and API with `bun run dev`. Open `/map.html` and `/client.html`.
- Use the dark map with primary conductors, transformers, devices, ARCOS damage, and emergency services visible.
- Clear the saved client premise (`gridguide.premise` in local storage) so address selection appears.
- Check **7249 Willow Valley** for an open report affecting the home. Choose a related report for the crew demo if possible; otherwise describe the two views as using the same dataset without claiming they show the same incident.
- Use actual open reports where available. If repaired reports are included through debug mode, label that replay explicitly.
- Record at 1080p, browser zoom 110%, with bookmarks and notifications hidden.
- Use `public/title-card.png` for the opening title.
- Rehearse against the section boundaries. Speed up loading waits in the edit; leave the useful results readable.

## 0:00–0:12 · Team, project, and purpose

**On screen:** Title card: **GridGuide · Team TCC · Avaneesh Kad · Dylan Levy · Cavan Moriarty**, then the map. Keep all three full names visible for the first three seconds.

**Narration:**

Hi, we're TCC: Avaneesh, Dylan, and Cavan. This is GridGuide, helping utility crews prioritize storm repairs and helping customers understand what those repairs mean for their homes.

## 0:12–0:32 · Problem and concept

**On screen:** A damage pin, then a simple diagram: **Utility data → Network relationships → Crew decisions + Customer explanations**. Briefly show both interfaces.

**Narration:**

We began with a question: could weather help predict power outages? But useful storm response also means knowing which equipment feeds a home, who needs help first, and what customers should expect. GridGuide connects those questions through one network dataset serving crews and customers.

## 0:32–1:00 · Question, challenge, and working network trace

**On screen:** Briefly reveal the network layers, then click a home and hold on its numbered upstream equipment path. Add a simple visual explanation: **Nearby equipment → Check circuit → Trace upstream connections**. Skip the filter and equipment-order tour to give the result time to register.

**Narration:**

The map asks another question: does nearby mean electrically connected? We merged two utility datasets and traced supplied upstream equipment paths. Click this home: its transformer and protective devices appear toward the substation. A nearby line can belong to another circuit, so damage reports are matched within their recorded circuit. That keeps location from being mistaken for connection.

## 1:00–1:22 · Isolation and repair planning

**On screen:** Click the chosen damage report. Hold on the isolation marker, affected transformers, and customer count; then show the person-hours card. Caption: **Model-based isolation proposal · Utility review required**. A small annotation can show **Remove + install hours × 4.5 = estimated person-hours**.

**Narration:**

Now click a damage report. GridGuide identifies an upstream device to open and highlights the customers affected within the network model. The goal is to limit unnecessary disconnections. It also estimates repair person-hours from supplied labor tables, connecting electrical network analysis to the practical work of planning a repair.

## 1:22–1:38 · Community priorities

**On screen:** Issues → select reports → Prioritize. Hold on one issue's score breakdown, including customers, life-support flags, and nearby emergency services. Skip the CSV export. Caption: **Nearby facilities are a priority signal; their outage status is not verified**.

**Narration:**

Which repair comes first? We rank issues using affected customers, life-support flags, and nearby emergency services. That combines engineering with community needs. The score breakdown helps crews understand why an issue ranks highly.

## 1:38–2:08 · Customer experience

**On screen:** Enter **7249 Willow Valley** and let the map settle. Show related reports, the restoration range, and the risk band with its confidence label. Ask **Why is my risk at this level?** and show the explanation. Trim the streaming wait. Caption: **Historical data · Risk indicator, not a forecast · Restoration estimate, not a commitment**. If the crew-progress timeline is visible, label it **Simulated crew status**.

**Narration:**

The same network information supports the customer page. Enter an address to see related damage reports and an estimated restoration range based on repair hours and assumed crew sizes. The risk band includes a confidence indicator, and a conversational assistant uses the selected home's context to explain the information. Customers can see the reasoning and uncertainty behind an estimate, helping them plan around an outage.

## 2:08–2:45 · Model exploration, decisions, and feasibility

**On screen:** Show **Weather-based prediction: XGBoost → RNN / LSTM → Physics-informed risk**. Label the first two **Explored** and the last **Current risk approach**; do not invent accuracy charts. Then show **Historical weather + Equipment loading + Tree canopy → Risk explanation** alongside the actual risk explanation. Finish with **Server-side address index · Estimated restoration ranges · Utility validation before deployment**. A prototype-limit caption should say **Back-feed through normally-open ties is not modeled**.

**Narration:**

We explored XGBoost and an RNN with LSTM to predict outages from weather, then shifted toward physics-informed risk. The current prototype combines physical load calculations, historical weather, and tree canopy to explain equipment exposure. That connects environmental science, structural engineering, and GIS, with assumptions we can inspect.

We also kept the full address index on the server and showed restoration ranges because actual crew timing is unavailable. This is a working prototype; deployment would need authenticated access, live dispatch data, and utility validation.

## 2:45–2:55 · Value and close

**On screen:** Both interfaces, then the title card. End on **GridGuide · Team TCC**.

**Narration:**

GridGuide connects network engineering with community priorities and clearer customer communication. We're TCC. Thank you.

## Rubric coverage

| Criterion | Evidence in the revised video |
| --- | --- |
| Innovation | Model alternatives: XGBoost, RNN/LSTM, and physics-informed risk. Connects damage locations to network dependencies and uses one dataset for crew and customer decisions. |
| Curiosity | Asks whether weather can predict outages and whether geographic proximity means electrical connection, then shows the approaches used to investigate those questions. |
| Communication | Demonstrates functional network tracing, isolation, prioritization, and customer explanation. A concept diagram explains the shared-data design; the model diagram makes development visible. |
| Breadth and complexity | Connects GIS, electrical and structural engineering, environmental data, labor planning, community priorities, privacy, and customer communication. |
| Impact | Identifies two users, their decisions, the potential value, and concrete steps from a working prototype toward deployment. |
| Navigating challenges | Shows a progression through prediction approaches and explains implemented responses to network ambiguity and unavailable crew timing. A confirmed test result would make the model pivot much stronger. |

## Evidence that would strengthen the top rubric levels

Use these as replacements for existing narration, not additions that push the video over three minutes.

1. **Why the models changed.** The team has confirmed trying XGBoost and LSTM, then moving to physics-informed risk. To demonstrate learning from failure fully, name the actual limitation observed and show how the final method addressed it. Do not guess that the cause was poor accuracy, too little data, class imbalance, or overfitting.
2. **Analysis of an accepted solution.** If the team researched an existing outage map, forecasting method, or utility workflow, name one concrete strength, one limitation, and the alternative explored. Comparing model names alone does not prove analysis of existing solutions.
3. **Evidence of improvement.** Show a genuine evaluation result, failed-case example, or before-and-after explanation if available. Do not add invented performance gains, customer feedback, or time savings.

**Terminology check:** A physics-informed neural network is a neural network trained with physics-based constraints or losses. The present app's wind-risk code describes a direct structural calculation rather than a trained network. If a separate trained network was built, distinguish that experiment from the calculation actually shown in the demo. Until that is confirmed, the narration uses the accurate broader phrase **physics-informed risk**.

**Optional confirmed test-and-pivot sentence structure:**

> XGBoost and LSTM [actual observed limitation]. We changed to [actual implemented method], which [specific demonstrated improvement]. Here is [the result visible in the prototype or evaluation].

Do not read bracketed placeholders aloud. The main narration is usable without this optional upgrade.

## Recording accuracy notes

- Isolation is a model-based proposal for utility review. It does not account for back-feed through normally-open ties or establish field switching safety.
- Repair person-hours use supplied compatible-unit tables and assumptions. Restoration ranges also assume crew sizes; neither is a utility commitment.
- Risk is a heuristic indicator using historical weather and other inputs, not a validated outage probability or live weather forecast. Its confidence label describes data limitations, not demonstrated statistical accuracy.
- Emergency-service proximity is a ranking signal, not proof that a facility is on the affected circuit or without power.
- Crew progress is simulated. Outage-update sign-ups store contact details but do not yet send notifications; omit those features unless clearly labeled.
- The full address index stays on the server, but the selected address appears in the customer interface. Authentication and access controls remain deployment work.
- Present faster restoration, reduced planning effort, and better customer understanding as intended benefits unless the team has measured them.
- The earlier draft's “wrong about half the time” and browser-testing claims are omitted because they have not been confirmed. Do not restore numerical failure claims without a defensible test.

