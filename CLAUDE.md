# Voxel Focus World — handoff

A focus timer for building a cozy voxel village. Focus sessions earn **coins**, coins buy **blueprints** in the shop, and each blueprint is built over one or more sessions on a small **construction island**. When it's finished you fly home and **place it** in your permanent **forever world**. Giving up only crumbles the current session's blocks on the construction island; earlier sessions' progress and the forever world are never touched. Zach's long-term side project; idea and roadmap are in his "Claude Projects Ideas" doc (https://claude.ai/artifact/2qxSE5MtdzCFhSBTtft5kQ). **The look must stay original**, not a copy of any existing game.

## Run
- Dev server: `voxel-focus-world` entry in `C:\CLAUDE PROJECTS\.claude\launch.json` (and in this folder's `.claude/launch.json`), port **5195**. Or `npm run dev`.
- `npm run build` gives a static `dist/` (about 1.03 MB / 271 kB gzip, mostly three + tone).
- Stack: Vite 8, three 0.187, tone 15. No audio files: every sound is synthesised in `src/audio.js`. The only images are the app icons.

## Repo + hosting (2026-11-04)
- Git repo, **private** on GitHub: https://github.com/Zachary-Malcolm/voxel-focus-world (branch `main`). Zach wants it private for now. Commit messages end with the `Co-Authored-By: Claude …` line.
- `.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages, but Pages is **not enabled** and the workflow is **disabled** (the first run built fine and failed at `configure-pages`). A Pages site is always public on the web, and Pages on a private repo needs a paid plan. When Zach says to go public: make the repo public, enable Pages (`build_type=workflow`), `gh workflow enable "Deploy to GitHub Pages"`, re-run it. The site would be https://zachary-malcolm.github.io/voxel-focus-world/ (`base: './'` already works under a sub-path). Confirm with Zach before any of that.

## Installable + offline (PWA, 2026-11-04)
- `public/manifest.webmanifest` (name, short name "Focus World", standalone, sky-blue theme `#5fb8ff`) + `public/icons/` (192/512 "any", 192/512 maskable, apple-touch 180, favicon 32 png + svg). `index.html` links them; the brand mark in the top bar is `icons/favicon.svg`.
- Service worker without extra packages: `src/sw-template.js` is filled in by the `vfw-offline` plugin in `vite.config.js` at build time (list of every built file + everything in `public/`, cache name `vfw-<hash of list + template>`) and written to `dist/sw.js`. Install precaches all of it; navigation = network first (3.5 s timeout) then the cached page; other files = cache first. Activate deletes older `vfw-*` caches, `skipWaiting` + `clients.claim` so a new build takes over on the next load. **Cache lookups need `ignoreVary: true`**: without it the module script / CSS requests (they carry Origin) missed the cache and offline loads came up unstyled.
- Registered only in production builds (`!DEV` in main.js), so the dev server on 5195 is never cached. `base: './'` makes `dist/` work from any folder (GitHub Pages etc.).
- Install: main.js keeps the `beforeinstallprompt` event and shows "Use it as an app → Install" in the sun/moon popover; `appinstalled` hides it and toasts. Chrome/Edge also show their own install icon in the address bar. The Claude browser pane never fires the event, so test the button in a real browser.
- Test the build: `voxel-focus-world-build` launch entry = `vite preview` on port **5196** (own origin, so Zach's 5195 save is untouched). Load once, stop the server, reload: it must still render.
- Icon: `python tools/make_icon.py OUT_DIR` writes the SVG variants (rounded, maskable full-bleed with art at 0.78, favicon with thicker ring, apple full-bleed). Design: sky gradient, white focus ring with an orange 72% progress arc, a little isometric floating island with a cottage (glowing window, chimney), a tree and a flower bush. PNGs were rendered by putting all variants on one HTML sheet and taking a single headless Chrome screenshot at 1024 px, then cropping/resizing with PIL (several separate headless runs only produced the first image).

## Decisions with Zach
- 2026-11-04 v1: Vite + Three.js (instanced meshes) + Tone.js; crisp bright daylight look; rounded-edge cubes with per-block colour jitter.
- 2026-11-04 v2 plan, in three phases:
  1. **(done)** construction island, camera flight between islands, placement in the forever world (spacing rule, rotate, tray), give-up only hits the construction island.
  2. **(done)** coins, shop, multi-session projects, 8 new blueprints, windmill sails, chimney smoke.
  3. **(done)** town square + fountain, roads routed from each door, animated island growth, stats sheet.
- 2026-11-04 v3 vision ("a cozy living civilisation that grows as you work"), split into phases:
  4. **(done)** kit of materials + textures + shapes, all 11 buildings rebuilt with levels and details, time of day, weather cycle, night glow, generative music + ambience.
  5. **(done)** Living world: procedural terrain as the island grows (hills, lakes, rivers, rocks, wild trees, flowers), villagers walking the roads, animals (sheep, cats, dogs, birds), water wheel on a river. Keep it slow and not distracting.
  6. **(done)** Builder tools: reorganise mode (move / rotate / store / demolish placed buildings, re-route roads), per-block colour + material editor (saved as per-building overrides), world templates (implemented as one-tap layouts of your own buildings).
  7. **(done)** Many more cozy fantasy buildings: 10 new blueprints (mushroom house, greenhouse, blacksmith, stable, granary, treehouse, tavern, chapel, library, wizard tower) plus 5 decor pieces bought instantly (fence, lamp post, bench, flower bed, farm plot). Inn = the tavern; the watermill already exists as the river's water wheel; bridges are laid automatically where roads cross water.

## Economy (`src/catalog.js`)
- 1 coin per focused minute + 5 per finished session (`coinsFor`); a full 25-min session = 30. Giving up pays nothing. New saves start with 50; older saves were back-paid from their past focus (`upgrade()` in save.js).
- Blueprints are bought once and can be built forever. Free: Tree, Cottage (`house`), Watchtower (`tower`). Shop: Wishing Well 30 (1 session), Market Stall 45 (1), Mushroom House 60 (1), Greenhouse 75 (1), Bakery 90 (2), Blacksmith 100 (2), Stable 110 (2), Granary 110 (2), Windmill 120 (2), Treehouse 130 (2), Clock Tower 150 (3), Tavern 160 (3), Chapel 170 (3), Lighthouse 180 (3), Library 200 (3), Wizard Tower 260 (4), Castle 400 (6), Cathedral 600 (8).
- Each catalog entry has a `role`: `home` (cottage, mushroom house, treehouse: villagers live there), `work` (gets a villager job + hat), `nature` (tree: no road). `ROLE(kind)` in catalog.js; life.js and layouts.js use it, so a new kind only needs its catalog line.
- **Decor** (`DECOR` in catalog.js): Fence 6, Lamp Post 8, Bench 10, Flower Bed 12, Farm Plot 20. Shop tab "Decor": buying one costs coins, puts it in the tray and starts placing it at once (no session, buy as many as you like). Decor footprints set `fp.decor`: base = only the cells it stands on (no 3x3 minimum), gap 0 to buildings / square / other decor (still not on them, not on roads), no road of its own, flattens no hills, not counted as a building or by the villagers. In layouts, decor follows the building it stood beside (same offset in that building's frame, nearest free cell); lone decor stays put.
- One project at a time (`save.project = {kind, variant, done, sessionsDone}`). Each session lays `ceil(total/sessions)` blocks (the last session lays the rest). The picker is locked until the project is finished. Giving up in a project's first session drops the project so you can choose again.
- The debug 10 s chip only exists in dev (`import.meta.env.DEV`), and so does `vfw.addCoins(n)`. Debug sessions pay 5 coins and count as a full session of build progress.

## Flow (`src/main.js` state machine)
`home` → pick blueprint in the shop (or keep building the current project) + Start → camera flies to the site → `running` (blocks drop in at a steady rate over the session, a ghost scaffold shows the rest) → `finishing` (last blocks land; waits if the tab is hidden) → `celebrating` (hop wave with rising thocks over this session's blocks). If the project isn't finished, fly home. Otherwise the item goes into `save.tray` → `placing` (fly home, ghost follows the mouse or tap; R rotates, Enter places, Esc = "Later") → `building` (cascade drop into the world) → `home`.
Give up (two taps) → `crumbling` on the site → fly home. A finished build is saved to the tray before it is placed, so closing the tab never loses it. Unplaced builds show as "Ready to place" buttons.

## Building kit (`src/kit.js`, phase 4)
- A block is `{ x, y, z, color, mat?, shape?, r?, s?, deco? }`. Positions may be fractional. `r` = quarter turns (same sense as `rotateXZ`; wedges/stairs slope towards +z at r=0), `s` = number or `[sx, sy, sz]` in the block's own axes. `deco: 1` = small ground-level detail that doesn't need land under it.
- `MATERIALS`: plaster, wood (planks), log (bark), stone (cobble), rock, brick, roof (shingles), thatch, glass, lantern, crystal, metal, gold, cloth, leaves, grass, moss, dirt, sand, water, snow. Each has a 32 px greyscale canvas texture (Nearest filter) that multiplies the block colour, so colours stay editable. Glass/lantern/crystal glow at night via `setNight(k)`.
- `SHAPES`: cube, slab, topslab, wedge, corner (hip-roof corner), stair, pillar, logx, post, beam, pane, fence, cone, spire, dome, blob, orb, rock, arch. Low-poly ones use flat shading.
- `MultiBatch`: draws any mix of shape x material as growable InstancedMeshes behind global handles (add/set/setColor/remove/clear). `IslandFX.pose()` stacks animation squash/spin on the block's own `r`/`s`; `IslandFX.restyle(b, changes)` swaps material/shape/colour of a standing block (the per-block editor in phase 6 should use it).
- `src/builds.js`: every blueprint, built with `Grid` helpers: `box`, `ring`, `rel` (place relative to a wall face), `window` (glass + shutters + flower box), `door` (recessed planks, handle, lantern, step), `gable` (wedge roof along x or z with end walls), `hip`, `railing`, `flag`. Saved buildings are rebuilt from kind + variant, so editing a builder restyles every copy; keep footprints about the same size. Footprint `rect` now counts big scaled shapes' reach.

## Sky, weather, music (phase 4)
- `src/sky.js`: `Sky` drives sun/moon light, hemisphere light, the CSS sky gradient (`--sky-top/mid/bottom`), fog, stars, a soft cloud layer overhead (tinted by the sky colour), rain streaks and snow (instanced, around the camera target). Time = real clock ("Live") or a chosen hour. Weather = Markov chain over clear, fair, sun showers, cloudy, drizzle, rain, sleet, snow, fog (each a mix of cloud / dark / rain / snow / fog), 3 to 9 min spells, about 40 s blends, snow weighted by month. Saved in `save.sky = { live, hour, weather: 'auto' or a key, cur, until }`.
- UI: sun/moon button top right, popover with time slider + Live, weather chips, music toggle (`save.music`).
- `src/audio.js`: generative music (pad through four warm chords, sparse FM music-box notes on a pentatonic random walk, soft bass; lower and sparser at night) + ambience (pink-noise rain, brown-noise wind with an LFO, the odd bird chirp on fine days). The first pointerdown anywhere unlocks audio. `vfw.audio()` shows engine state. **Nobody but Zach has heard it: tune by ear.**

## Terrain (`src/terrain.js`, phase 5)
- Pure function of `save.seed` + `save.river` (the river's start angle, chosen once by `home.chooseRiver()` to avoid what's built). Growing the island only reveals more of the same land.
- The middle (`CORE` = 8) stays a flat meadow. Hills 0..3 (fbm) beyond it, tapered at the rim, with wedge/corner tops. Lakes where a second fbm is low. The river starts at a spring pond (`RIVER_START` = 10), winds out along a cached centre-line polyline (river = within 0.95 of it) and pours off the rim as a waterfall with spray.
- Nature per cell (`feature()`): wild trees (one per 3x3 block, from the Tree blueprint), rocks (more on hills), flower clumps, grass tufts, bushes with berries, mushrooms near woods, reeds by water, lily pads on lakes.
- Home layers it (`computeCells` / `refreshTerrain`): cells around buildings (pad 1, no trees pad 2), the square and roads are kept flat and bare; roads over water become plank bridges with fences. Refresh is diff-based (~15 ms): removed nature crumbles, new nature drops in. `home.version` bumps on every refresh so the villagers re-sync. `c.blocked` marks cells with trees / rocks / bushes.
- Water wheel (`save.wheel = {x, z, flow, side}`): appears once the river is long enough (`chooseWheelSpot`, also retried after each growth). Mill hut 3x3 on the bank, wheel with dotted rim spinning with the flow. Building next to it is refused ("Too close to the water wheel"); can't build on water.

## Villagers + animals (`src/life.js`, phase 5)
- `Life` (created in main after the world loads, `life.update(dt, {day, rain, cloud})` each frame). Creatures are posed kit blocks in one MultiBatch inside the home group (`Body` = parts with pivots; ~400 instances, no measurable frame cost).
- Villagers: `min(22, 1 + 2*houses + other buildings)`, each with a home (cottage) and a job building (hat by job). They walk the road graph (paths + plaza, BFS) between door spots: work (busy arms), chat in the square, pop inside for a bit. Umbrellas when it rains, lanterns at dusk. At night they turn round and go home (hidden) and come out again in the morning, staggered.
- Animals: sheep (wool puffs; graze, amble on open grass, never on roads, water, rims, trees or cliffs > 1), cats (sit, curl up asleep), dogs (follow a villager, tail wags), ducks on water (if 5+ water cells), two bird flocks circling high (by day, not in heavy rain), butterflies on fine days, fireflies at night.
- `life.celebrate(x, z)` after placing a building: villagers within 14 tiles jump and cheer, some walk over; nearby animals hop.

## Edit mode (`src/editor.js`, `src/layouts.js`, phase 6)
- Hammer button (top right) toggles main's `state = 'editing'` (island stops turning, timer panel hidden, shop disabled). The `Editor` keeps a sub-mode: browse -> selected (building glows) -> Move / Paint / Store / Remove, or Layouts. Escape steps back one level.
- **Move**: the building lifts out (`fx.lift`), a pale ghost follows the pointer (R rotates, Enter / click places), Cancel drops it back. Moves may cover roads: afterwards `home.rerouteAll()` lays every road again (old road cells are cheaper so the network stays stable, freed cells grow nature back).
- **Store** packs it into the tray (keeps its paint); **Remove** needs a second tap, crumbles it, blueprint stays owned.
- **Paint**: camera flies close; tap a block ("One block" or "All like it" = same blueprint colour `tone` + material), then a swatch, the any-colour picker or a material chip. Saved as `record.paint = { blockIndex: { c: '#hex', m: material } }`, applied in `entryFor` with a light per-block jitter; Undo (also Ctrl+Z) and Reset. Indices follow builder order, so **changing a builder's block order scrambles saved paint** for that kind. Windmill sails repaint by rebuilding the spinner (`respin`).
- **Layouts** (sheet of 5 cards with schematic SVGs): Village green, High street (lays an avenue), Hamlets, Grand centre, Countryside. `home.planLayout(tpl)` greedily places buildings in the template's order on the best-scoring valid cell + door-facing rotation (< 60 ms on a radius-23 island), `applyMoves` lifts and re-drops each changed building in turn, then re-routes roads. The result shows Undo / Keep it (undo restores positions and the exact old roads). Not enough room -> toast, nothing changes.
- Picking: `fx.pickBlock(raycaster)` raycasts the instanced meshes (bounding spheres reset each pick), `MultiBatch.handleAt` + `fx.byHandle` map an instance back to its block; blocks carry `bid` (building id) and `idx`.

## Stats + growth (phase 3, finished in phase 4)
- `save.days` ("YYYY-MM-DD" local -> focused ms), `coinsEarned` (back-filled for old saves), `giveUps`. Stats sheet: tiles (focus, streak/best, coins earned, buildings), 7-day bar chart (single series, hover tooltips, today labelled), growth bar, village chips.
- Island radius earned by focus: `7 + 2 * floor(focusMs / 2.5 h)`; applied instantly on load, animated (`maybeGrow`) back home after a session. Placement can still grow it early if nothing fits. DEV: `vfw.addFocus(min)`.

## Code map (`src/`)
- `main.js`: state machine, HUD, input (mouse hover + click places; on touch a tap moves the ghost and the button places), timing. Time uses `Date.now()`, checked from rAF and a 250 ms interval. A running session resumes after a reload.
- `islandfx.js`: `IslandFX`, the per-island drawing and effects: solid blocks, ghost layer, dust, smoke wisps, spinners (a rotating group per windmill), and the drop (stretch while falling, squash + spring), hop, crumble and `many()` stagger helper. Thock pitch climbs while landings come less than 0.45 s apart (the combo). Sound is capped at one thock per 30 ms so big cascades stay readable.
- `home.js`: forever world. Base island, terrain layer, water wheel, buildings, placement. `GAP = 2` empty tiles between building rectangles (whole footprint incl. canopy/flag). The ground floor (min 3x3) must sit on land. `findSpot` searches from the centre outward. If nothing fits, `growIsland()` in main adds 2 to the radius.
- `site.js`: construction island (plank deck that grows to fit the project, corner posts with lanterns). `setProject(project, done, sessionEnd)` shows earlier sessions' blocks at once, plus a ghost where this session's blocks are coloured and later ones pale. `setTarget(n)` queues drops 0.075 s apart, so a hidden tab catches up as a cascade. Lone drops are quieter (velocity 0.55). `crumble(from)` / `celebrate(from)` only touch this session's blocks.
- `terrain.js`: noise, river course, natural features. `life.js`: villagers and animals. `editor.js`: edit mode UI. `layouts.js`: layout templates + card art.
- `builds.js`: the first 11 blueprints + the `Grid` helpers (see Building kit). `builds-fantasy.js` (phase 7): the 10 fantasy buildings and 5 decor pieces, plus `roundWall` (round towers from a ring + corner pillars) and `toadstool` helpers. `blueprints.js` merges both builder maps. Doors stay at x=0 on the front (roads start in front of x=0); long beams are laid as unit pieces because a scaled shape's longest side counts towards the spacing rect. Metadata on the returned array: `spin {pivot, axis}` (windmill sails), `smoke [[x,y,z]]` (chimneys).
- `thumbs.js`: renders blueprints with a throwaway WebGL renderer into data-URL images. main's `ensureThumbs(kinds)` renders lazily (panel kind at startup, a shop tab when it opens; all 21 buildings take ~75 ms).
- `catalog.js`: names, prices, sessions, coin formula.
- `rig.js`: camera stations + eased, arcing flight. `SITE_POS` (in main) puts the site far enough out that home is a backdrop.
- `footprint.js`: rotated blueprint blocks + `rect` (spacing) / `base` (needs land), cached.
- `blueprints.js`: `rotateXZ` + `blueprint(kind, variant)` (calls builds.js with a seeded rng).
- `home.js` also runs `activate()` on finished buildings: it moves sail blocks into a spinner and registers chimney smoke emitters.
- `island.js`, `voxels.js` (`VoxelBatch`: handle-based InstancedMesh, swap-remove), `audio.js`, `scene.js` (renderer, lights, clouds; the sun follows the camera target so shadows work on both islands).
- `save.js`: localStorage `vfw.save.v2`. Buildings `{id, kind, variant, x, z, rot}`, tray `{id, kind, variant}`, project `{kind, variant, done, sessionsDone}`, session `{startedAt, durationMs, startDone, quota}`, plus `coins` and `owned`. Migrates `vfw.save.v1` once: the old builds are re-spaced with the GAP rule (`needsLayout`).

## Debug
- "Debug 10s" chip = 10-second sessions.
- Console: `vfw.finishNow()`, `vfw.reset()` (wipes v1 + v2 saves), `vfw.save()`, `vfw.state`, `vfw.where`, `vfw.home`, `vfw.life`, `vfw.editor`, `vfw.sky()`, `vfw.audio()`, `vfw.look(x, z, dist, ang, tilt)` (close-up camera on an island cell; stops the island turning; `vfw.look()` resumes); DEV only: `vfw.addCoins(n)`, `vfw.addFocus(min)`.
- Big previews of blueprints: DEV `vfw.preview(kinds, { size, variant })` shows them in an overlay (click to close). Or `(await import('/src/thumbs.js')).makeThumbs([...kinds], 400, variant)` returns data URLs.
- Vite HMR sometimes keeps serving an older copy of an edited module (seen with home.js): if behaviour doesn't match the file, check `fn.toString()` in the page and touch the file again.

## Verified 2026-11-04 (browser preview, phase 1)
v1 save migrated and re-spaced (all pairs ≥ 2 tiles apart). Pick → flight → live drops → celebration → flight home → placement (valid green / invalid red + hint + disabled button, rotate, tray "Later") → cascade. Give-up crumbles only the site. Phone width fits with no horizontal scroll. No console errors. Zach placed buildings by hand during the test. **Sound is still unheard by anyone but Zach: tune by ear.**

## Verified 2026-11-04 (phase 2)
Shop with thumbnails, buying (coins deducted, auto-selected), windmill over 2 sessions (session 2 resumed from the saved 56 blocks) → placed → sails turning, chimney smoke, castle sessions 1–2 then give-up in session 3 rolled back only that session. No console errors. Zach's test save got 1500 dev coins from `vfw.addCoins` during testing.

## Verified 2026-11-04 (phase 4)
Stats sheet renders (tiles, week chart, growth, village). All 11 rebuilt blueprints checked as large previews and in Zach's world (no overlaps; some roof eaves touch). Rainy night (glowing windows and lanterns, rain, storm clouds), snowy dusk (pink-tinted clouds), popover controls, a debug castle session (drops and celebration with shapes, +5 coins, `days` updated), placement ghost with shapes. Music + ambience start (transport running) but were not listened to. Paving animation and the growth wave are still not watched end to end.

## Verified 2026-11-04 (phase 5)
Zach's radius-23 world: woods, hills, rocks, flowers, beaches, a winding river into a waterfall, mill hut + turning wheel (close-up checked). 12 villagers, 7 sheep, 2 dogs, 3 cats, 6 ducks spawn on valid cells; villagers walk roads and gather in the square; night sends them all home (lanterns while walking), fireflies show; `celebrate` makes 10 cheer. ~156 fps in the preview, no console errors, `npm run build` OK. **Not watched end to end yet:** a placement that clears wild trees, the wheel appearing after growth, a morning re-emergence in real time.

## Verified 2026-11-04 (phase 6)
On a backup of Zach's save (restored afterwards, his world is unchanged): select (glow), move + rotate a cottage across the island (road re-routed to its new door), paint its roof teal thatch with "All like it" (51 blocks, survives reload), store it (tray keeps the paint) and place it back from the tray with paint intact, remove a tree (two-tap confirm), repaint and undo windmill sails (spinner rebuilt, still turning), Village green and High street layouts applied, Undo restored positions and roads exactly, all 5 layouts plan on his island. Phone width (375): edit + paint panels fit, no horizontal scroll; the top bar now shrinks to fit six controls (brand mark hidden under 420 px) and the idle toast no longer peeks in. No new console errors, `npm run build` OK. Not tested by hand with real touch.

## Verified 2026-11-04 (phase 7)
All 10 new blueprints and 5 decor pieces checked as large previews (screenshots in `screenshots/phase7-*.jpg`). On a backup of Zach's save (restored afterwards, his world is unchanged): Decor tab, bought a lamp (coins 1106 → 1098) and placed it right beside a cottage (adjacent OK, on the cottage / on a road refused, no road laid, villager count unchanged); placed a tavern, wizard tower, mushroom house, library and greenhouse from the tray (roads laid, villagers 12 → 18 with tavern/wizard jobs); all 5 layouts plan in < 90 ms and move the lamp with its cottage; Village green applied + Undo restored exactly; a debug session laid the first of the wizard tower's 4 sessions on the construction island. Phone width: shop tabs fit, no horizontal scroll. `npm run build` OK (1.03 MB, 271 kB gzip). Not seen yet: the new buildings at night, the new villager hats up close, decor rotation by hand.

## Verified 2026-11-04 (PWA)
Production build on 5196: service worker activates, controls the page and precaches all 11 files; manifest serves 5 icons. Server stopped (a non-cached fetch fails, so really offline) and reload: full styled render, island + timer panel, `vfw.state === 'home'`, every asset served from the cache. Not tested: the Install button / real install (needs Chrome or Edge, not the pane), iOS home-screen add.

## Known limits / ideas
- The town square can't be moved yet; layouts keep it where it is.
- Paint is per building; there is no "paint every cottage" or saved palette yet.
- Sunrise/sunset are fixed at 06:00/18:00 (no seasons for light yet; snow odds do follow the month).
- No way to abandon a multi-session project after its first session.
- Coin rewards for streaks, and night-time lights in the lighthouse and windows, are still ideas.
- The camera framing only adapts to aspect at each flight/snap, not on window resize.
- Ask Zach before downloading anything beyond normal npm packages.
