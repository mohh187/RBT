# HANDOFF — 2026-07-23 (deep audit fixes + iOS crash + games track)

Read this first, then `HANDOFF.md` (sajalsamak contract map) and memory `MEMORY.md`.
Live venue for testing: **صاج السمك** — `rbt360sa.com/m/sajalsamak` — tenant `5Eg401SLtIhqjaMAdrIg` — theme `editorial` — enterprise. Firebase project **menu-88996**.

Everything below is **committed AND deployed** to production unless marked otherwise.

---

## 1. What shipped this session (all live)

**iOS menu crash + item-open glitches (the owner's top complaint) — FIXED & DEPLOYED:**
- Root cause, confirmed in a real 390px mobile browser: the editorial menu paints **56 full-screen dish sections at once** + **2 `<model-viewer>` WebGL contexts** (the 3D wall lantern + wooden plank) + a bg video → exceeds iOS WKWebView memory → "A problem repeatedly occurred". The 3D pieces showed `loaded:false` on mobile — pure cost, never visible.
- Fixes: `content-visibility:auto` + `contain-intrinsic-size` on `.edt-sec` (index.css); **no `<model-viewer>` at all on mobile** (`isNarrow()` = max-width:820 in EditorialLayout.jsx — glow-only placeholder shown; 3D stays desktop/tablet) and the ~450KB model-viewer runtime isn't even imported on phones; bg video paused while the item stage is open; `translateZ(0)` repaint kick on stage open to kill the iOS "table not straight until you scroll" compositing lag; horizontal pin (`usePinnedX` in scrollLock.js) so the oversized dish/table can't drag sideways. Measured JS heap 50MB→33MB, 0 WebGL contexts on mobile.

**Deep multi-agent audit (139 agents, 78 verified findings) — ~60 fixed & DEPLOYED across the session.** Full detail in memory `audit-2026-07-23-deep-multiagent.md` (rounds 1–3). Highlights: CRITICAL tenant-takeover rule (users create), cashier-discount auto-cancel, offer over-discount, loyalty reversal (pointsAwarded), atomic ticket/reservation check-in, paid-event oversell guard, **store-hours ordering gate** (new `src/lib/ordering.js` + `tenant.ordersPaused` toggle in Settings menu-mode section, enforced client+server+rules, default-off), KDS resilience + midnight rollover, inventory (materials low-stock, produceMaterial sufficiency), cash-drawer tips, geminiProxy rate-limit + model allowlist, drag-reorder rollback, tier-progress bar, PrizeWheel idle-rAF battery fix, and many more.

**Deploy note:** `firebase deploy` twice hit a **transient** Google Cloud `iam.serviceAccounts.ActAs` / "failed to get project" error mid-session — retrying succeeded. Account `moh.idris.18@gmail.com` has access to menu-88996. If it recurs, just retry.

---

## 2. Games track — the CURRENT task (in progress)

Owner's plan (their words): **improve/fix each game to fully professional quality, UI and everything.** Order requested:
1. **Wist (الوِست)** ← START HERE. Reference quality bar: the iOS app **"Whist Cards" (Sudanese Whist)** `apps.apple.com/us/app/whist-cards/id1581872524`.
2. then **Ludo**, then **Jackaroo**.
3. then **add a NEW game "حريق" (Haree'a / Fire)** — a popular Gulf card game (not yet built).

**Legal guardrail (important):** implement the *game rules + UX conventions* faithfully, but **design our own visuals** — do NOT copy the reference app's proprietary artwork/branding/exact pixel layout. Game rules aren't copyrightable; their assets are.

### Reference app "Whist Cards" — features to match (from its store page)
Sudanese Whist, 4 players in partnerships. Solo vs **AI with difficulty levels**; casual + rated online lobbies; **in-app tutorial** (bidding/trump/trick-taking, AR+EN); leaderboards + weekly champions; achievements; themes/card-sets/avatars store; voice + text chat + emojis in rooms; match auto-save, spectating, QR invite, locked rooms.

### Our Wist today (`src/components/games/Wist.jsx`, 996 lines) — already strong
- Pure total `reduce(state, move, room)` rulebook (illegal/out-of-turn = no-op); seeded PRNG deal (never Math.random inside reduce); runs inside the lead's Firestore transaction so a tampered client can't force an illegal card.
- Implements **Wist 41** family (Tarneeb-41 skeleton): 4 seats, partners opposite (0+2 vs 1+3), auction 7–13, kaboot=13 (±26), trump named by winner, defenders always score their tricks, first to 41. The file header deliberately picks ONE coherent ruleset — **do not blend variants** (it warns why).
- Three modes: remote room, local hot-seat (pass-the-phone with a privacy curtain), solo vs 3 bots. Bots in `src/lib/gameBots.js` (`wistBotMove`, ~line 567) — they only ever submit moves re-validated through `reduce`, read only their own seat's hand.
- SVG suits/cards (no emoji/glyphs — hard rule), Latin digits only, RTL. CSS in `src/styles/cardgames.css` (831 lines, shared by all card games: `.cg-*`, Wist-specific `.wst-*`).

### Concrete improvement plan for Wist (not yet started — do these next)
1. **Bot difficulty levels** (reference highlights this). `wistBotMove` in gameBots.js has bidding estimate + trick logic but no difficulty tier. Add easy/normal/hard (e.g. hard: track played cards / count trumps / signal partner; easy: looser bids, random-ish discards). Thread a difficulty prop from the hub → Wist → `botMoveFor`.
2. **Contract progress tracker** — show the bidding side "needs X, has Y" live during play (clarity the reference praises). Data is in `st.highBid.n`, `st.tricksWon`.
3. **Card sounds + play animation** — use `src/lib/notify.js` (beep) or add a light card-flick sound; animate a played card from the hand to its trick slot (`.wst-played at-*`). Games feel pro with feedback.
4. **Turn timeout** in remote play — `turnOf` sets `deadlineAt:null`; a staller freezes the room. Consider a soft auto-play/auto-pass after N s (host-driven, like other games if any).
5. **In-app tutorial** — we have `RULES_AR/RULES_EN` text; consider a short 3–4 step interactive first-run overlay. Lower priority than 1–3.
6. **UI polish** — bigger felt table, clearer turn glow, trick-win highlight, partner/opponent color coding, responsive on small phones.
Verify each change by building (`npx vite build`) and, ideally, driving the game in a browser (solo-bot mode auto-deals, so it's reachable without a room).

### Then Ludo (`Ludo.jsx` 1127) and Jackaroo (`Jackaroo.jsx` 1203)
Same architecture (pure reduce + gameBots + cardgames/boardgames CSS). Audit them for real bugs first, then polish UI + AI. Jackaroo (جكارو) is the marble/pegs+cards game; Ludo is the classic. Both are the most complex → most bug-prone.

### Then build "حريق" (new)
Popular Gulf trick-taking/shedding card game. Create `src/components/games/Haree.jsx` following the game contract (see `src/lib/games.js` header): component renders ONLY the play area; the hub (`GamesCenter.jsx`) owns title/score/close; report via `onScore`, persist via `onProgress`/`resumeState`; support solo bots via `gameBots.js`. Register it in `src/lib/games.js` (lazy `load`, id, name AR/EN, category, art). Reuse `cardgames.css`. Confirm the exact "حريق" ruleset with the owner before coding (it varies).

---

## 3. Games architecture cheat-sheet
- Registry: `src/lib/games.js` — each game `{ id, name, category, load: () => import(...) }`, lazy-loaded. 23 games today; categories: cafe/restaurant/seafood/sweets/lounge/perfume.
- Hub shell: `src/components/GamesCenter.jsx` (1289) — promo→browse→gate(name/phone)→play; owns chrome; `useScrollLock(open)` already locks the menu behind it (the audit's "no scroll lock" finding was stale). Rewards come only from `gameRewards.js` (never invents a reward the venue didn't configure).
- Multiplayer rooms: `src/lib/gameRoom.js` (watchRoom/applyMove/heartbeat), `RoomLobby.jsx`, `src/routes/JoinRoom.jsx`.
- Bots/solo: `src/lib/gameBots.js` (per-game move fns + `botLabel`, `BOT_DELAY_MS`, `takeSoloIntent`).
- Admin: `src/routes/admin/GamesHub.jsx`, `GuestPlay.jsx` (which games a venue enables).
- HARD RULES everywhere: NO emojis (Icon.jsx/SVG only), NO Arabic-Indic digits (`fmt` uses `ar-SA-u-nu-latn`), NO visible scrollbars.

---

## 4. Deferred audit items (NOT done — risky/large, do deliberately, never rushed on the live venue)
From `audit-2026-07-23-deep-multiagent.md`:
- `firestore.rules` — move `platformNote`/`customPrice` off the world-readable tenant doc (needs data migration + repoint console reads/writes); driver order-field guard (role-based order rules); customers key-allowlist (blocked: diner `upsertCustomerOnOrder` writes loyalty fields — allowlist would break it).
- Unsalted 4-digit PIN (`src/lib/pin.js`) — needs a callable verify + move `pinHash` off the peer-readable staff doc + migration.
- Caps-mirror drift (new delegated-cap staffer blocked until a manager reloads) — needs a staff-create Cloud Function to seed caps.
- A few low perf/cosmetic: Settings draft-colour cleanup-on-unmount, scrollAffordance MutationObserver debounce, MenuView hero re-render, `key={i}` reorderable lists.

**Big GAPS = multi-week projects, several gated on external merchant/partner accounts:** ZATCA Phase-2 e-invoicing, per-venue payment routing/settlement ledger, franchise/multi-branch, delivery-aggregator ingestion, split-check, prepaid wallet/gift cards, payroll/WPS/GOSI. Report artifact + the 60 suggestions are catalogued in the audit memory.

---

## 5. How to deploy (owner's account already logged in)
```
npx vite build                                  # always build first, green required
npx firebase deploy --only hosting              # client (safe, easily rolled back)
npx firebase deploy --only firestore:rules      # after rules edits (dry-run first)
npx firebase deploy --only functions            # after functions/ edits (slow; retry on transient ActAs error)
```
Commit style: Arabic subject, `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Branch is `main`.
