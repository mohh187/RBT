# HANDOFF — 2026-07-23 (مساءً) — security batch + games batch shipped

Read this first, then memory `MEMORY.md`. Live venue: **صاج السمك** — `rbt360sa.com/m/sajalsamak` — tenant `5Eg401SLtIhqjaMAdrIg` — Firebase **menu-88996**.
Everything below is committed; batch 1 (`41b1f13`) is DEPLOYED (hosting+rules+functions); batch 2 (`8a2f3f6`, games) hosting deploy was running at handoff time — verify `npx firebase deploy --only hosting` finished, retry if the transient IAM ActAs error hit.

---

## 1. Batch 1 — bugs + the four deferred security items (DONE, deployed)

**«وجبة بلطي» table jump (owner report):** the only بلطي item with a real photo (1600×1600 webp, ~206KB) — late decode grew the stage hero after open and the painted table below slid down. Fixed in `EditorialLayout.jsx`: per-URL natural-ratio cache (`IMG_RATIO`, the list's measurements prime the stage) + `aspect-ratio` reservation on the stage img before decode + the iOS translateZ composite kick re-arms on late load (`loadTick`). NOT reproduced on-device — owner should confirm on the iPhone.

**«قصتنا وأخبارنا» intermittent white page:** two fixes in `main.jsx`: `vite:preloadError` → one throttled reload (stale hashed chunks after each deploy were the likely cause) + a root `RootErrorBoundary` (bilingual recovery card, reports via `reportBoundaryError` → platformErrors). Root cause is a class fix — applies to every lazy route.

**platformNote/customPrice off the public tenant doc:** new platform-only collection `platformVenueMeta/{tid}` (`note`, `customPrice`; rules: read isPlatformAdmin, write isPlatformSuper). Console reads/writes repointed (VenueDetail note editor, PlanEditor rows via `watchAllVenueMeta`, platformConfig.setCustomPrice, platformAiActions venue_details). **Self-healing migration** `migrateVenueMetaOnce` runs inside `watchAllTenants` — first console screen load as superAdmin moves legacy fields off tenant docs (deleteField) — verify it ran (console.info `[platform] moved private meta off N tenant doc(s)`). Bonus real bug fixed: `generateMonthlyInvoices` (functions/platformExtensions.js) **now bills customPrice** — it silently ignored it before.

**Driver field guard + customers allowlist (firestore.rules, deployed):** orders update — role `driver` restricted to `hasOnly(['delivery','updatedAt'])` (matches every DriverPortal write incl. COD + geo). customers — non-staff create/update now strict `hasOnly(['name','phone','source','registeredAt','updatedAt'])` + size bounds; verified the ONLY anonymous writer is `registerCustomer` (MenuView join / GamesCenter gate / JoinRoom); `upsertCustomerOnOrder` import in MenuView is dead code (never called by diners).

**PIN salting:** new `functions/staffSecurity.js`: `verifyStaffPin` (scrypt + per-record salt in client-unreadable `tenants/{tid}/staffPins/{uid}`, 5 fails → 60s lock, legacy sha256 fallback + lazy upgrade on first success), `setStaffPinSecure` (manager set/clear, writes `hasPin` flag on staff doc), `migrateStaffPins` (sweep legacy pinHash off peer-readable staff docs — AdminLayout fires it once per manager session). Client: `pin.js` rewritten to callables; PinLock verifies server-side; Settings PIN tab uses the callable; `hasPin` added to staff-doc self-write deny lists. NOTE: unlock now needs network; stale clients that predate this build lose the PIN list after migration until they reload (accepted — operational guard, not crypto).

**Caps-mirror drift:** `onStaffDocCreated` trigger seeds `staff/{uid}.caps` from role defaults + tenant.roleCaps the moment the doc is created (ROLE_CAPS duplicated in staffSecurity.js — KEEP IN SYNC with src/lib/permissions.js). healStaffCapsMirrors stays as the safety net for roleCaps edits.

## 2. Batch 2 — games (committed `8a2f3f6`)

**NEW GAME «الحريق» (Hareeg 14)** — `src/components/games/Haree.jsx`, registered in games.js (`haree`, 2–4 players, multiplayer). Own original implementation of the traditional rules (rules researched from public sources; no assets/text copied from any app): 2 decks + 4 jokers, deal 14 (opener 15, no draw), open ≥51, sets/runs with jokers (≥2 naturals), extend any table meld after opening, cover-discard forbidden (with all-covers escape so it is deadlock-free), burn at 31, last-standing wins; modes «حريق 14» (values) / «عدّ الورق» (count) picked by host in lobby; deterministic stock reshuffle from round seed; void round when the deck truly dries. Bot in gameBots.js (`hareeBotMove` — every candidate re-validated through reduce, cannot stall). CSS `.hr-*` appended to cardgames.css. **Not yet play-tested in a browser** — do a solo-bot run first thing next session.

**21 verified bugs found by 4 audit agents, 18 fixed** (one implementation agent, all one-line-spec'd):
- Plumbing: startGame reseats seats contiguously + honors firstSeat (Dominoes' first deal used to FREEZE most rooms — turn.seat=0 vs highest-double opener); allowOutOfTurn broadened (resign/draw/deal/next/skips); **rematch on ended rooms now restarts via startGame** (was silently dead for every game; gameRoom's ended-room rejection removed for host restart, winnerSeat/endedAt cleared); wist/jackaroo partnership wins credited by `seat % 2` in socialPlay.
- Ludo: invited-guest crash pre-start (unseeded `state:{}` → tokens guard), sixStreak leak on finish-on-six, roll now re-stamps turn.startedAt (mid-move force-skip window).
- Chess: vs-bot resign during bot's turn awarded the HUMAN the win (actor attribution), rematch rounds now report scores (reportedRef re-arm), flip-pin releases in hot-seat.
- Dominoes: settle paths return `turn:null` (round rollover no longer hangs on an absent seat), deterministic reseed in reduce (Math.random impurity), bot-save no longer resumes as hot-seat, `.bgm-ends` direction:ltr (RTL taps hit the wrong end), matchEnd rematch button host-only in MP.
- Jackaroo: seatless remote mount no longer shows seat 0's hand; forceSkip anti-stall added (mirrors Ludo — disconnect used to brick the room forever).

**Deliberately NOT done (audit findings left):** Jackaroo board runs clockwise while its header says counter-clockwise (visual-only internal inconsistency — flipping geometry on the live venue needs owner eyes, fix = mirror x in cellXY/laneXY/baseXY); the ~30 polish items (B-lists) below.

## 3. NEXT — the polish pass toward the reference apps (owner's explicit bar)

Owner wants the five games at commercial-app level «بالحرف وبنفس الطريقة والواجهات» — legal line already agreed in-session: same RULES + feature parity + UX conventions, OWN visuals (never copy their art/branding). Reference features per store pages: bot difficulty levels, timers, sounds, animations, tutorials, leaderboards, private rooms (rooms exist), chat/emotes (NO emojis — our icon set), spectate.
Top of the backlog (full ranked B-lists are in this session's four audit reports — re-derivable, or just implement):
1. **Sounds** — zero audio in ALL games today; one small WebAudio blip module (move/capture/deal/win + mute toggle), wire into each game's existing state-change effects.
2. **Turn timers visible** — registry `turnMs` (~45s) for ludo/jackaroo/dominoes/haree + countdown ring on the active seat + skip affordances (forceSkip patterns now exist in Ludo + Jackaroo).
3. **Bot difficulty levels** (easy/normal/hard) — thread `level` through solo intent → ctx; per-game heuristic tiers (chess 2-ply on hard; wist card-counting hard tier per original plan).
4. **Animations** — dice cycle, piece glide (chess overlay transform), marble path-following (jackaroo), domino snap, card flight (wist/haree).
5. Auto-move single-option (ludo), auto-draw loop (dominoes), captured-tray sort + end dialogs (chess), pip reveal + round history (dominoes), 7-split clarity + J/7 target rings (jackaroo), Wist improvement list from previous handoff (contract tracker, timeout, tutorial).

## 4. Also pending from before
- Wist polish list (bot tiers, contract tracker, sounds, timeout, tutorial) — previous handoff section still valid.
- Deferred audit leftovers: Settings draft-colour cleanup, scrollAffordance debounce, MenuView hero re-render, key={i} lists.
- Big multi-week gaps (ZATCA-2, payment routing, franchise, delivery aggregators, split-check, wallet, payroll) — memory `audit-2026-07-23-deep-multiagent`.

## 5. Deploy/verify checklist for next session
```
npx vite build                       # green required
npx firebase deploy --only hosting   # batch 2 if not confirmed deployed
```
- Play a solo Haree round vs bots end-to-end (deal → open 51 → extend → cover block → burn → match end).
- Open a 2-phone Dominoes room (the old freeze scenario) + a Chess room rematch + draw-accept.
- Confirm بلطي on the owner's iPhone; confirm قصتنا page after this deploy (old clients need one reload).
- Platform console once as superAdmin (runs both self-heals: venue-meta migration + PIN sweep on venue admin).
Commit style: Arabic subject; branch main.
