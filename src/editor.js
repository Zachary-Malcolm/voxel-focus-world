import * as THREE from 'three';
import { MATERIALS } from './kit.js';
import { LAYOUTS, LAYOUT_ART } from './layouts.js';

/*
 * Edit mode for the forever world (phase 6). Main's state is 'editing' the whole time; the editor
 * keeps its own sub-mode:
 *   browse    tap a building to select it, or open the layouts sheet
 *   selected  a building is chosen: Move / Paint / Store / Remove
 *   moving    the building is lifted out and follows the pointer as a ghost (R rotates)
 *   paint     camera close on the building; tap blocks, pick a colour or material
 *   busy      something is animating (layout, store, demolish)
 *   review    a layout was just applied: Keep or Undo
 * Paint is saved per building as record.paint = { blockIndex: { c: '#hex', m: material } }.
 */

const SWATCHES = [
  ['#fbf7ee', 'Chalk'], ['#efe3c8', 'Cream'], ['#e2c290', 'Honey'], ['#ffd34d', 'Sunflower'],
  ['#f2a33a', 'Amber'], ['#e8743b', 'Pumpkin'], ['#d9534a', 'Poppy'], ['#a8432f', 'Brick'],
  ['#e88fb4', 'Rose'], ['#b77fd6', 'Lilac'], ['#6a5acd', 'Violet'], ['#3e6fd6', 'Cobalt'],
  ['#6fb6d9', 'Sky'], ['#5fbfae', 'Teal'], ['#8cc56a', 'Sage'], ['#4f8a4a', 'Forest'],
  ['#a7794c', 'Oak'], ['#6b4a2f', 'Walnut'], ['#9aa2ad', 'Slate'], ['#3b3f48', 'Charcoal'],
];
const PAINT_MATS = ['plaster', 'wood', 'log', 'stone', 'rock', 'brick', 'roof', 'thatch', 'cloth', 'leaves', 'moss', 'snow', 'sand', 'metal', 'gold', 'glass', 'lantern', 'crystal'];
const WHITE = new THREE.Color(0xffffff);
const _c = new THREE.Color();
const $ = (id) => document.getElementById(id);

export class Editor {
  /**
   * ctx: { home, life, save, persist, rig, sfx, toast, NAME, ray(e) -> Raycaster, getState, setState, flyHome }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.mode = 'off';
    this.sel = null; // selected building id
    this.parts = []; // selected blocks while painting
    this.scope = 'match';
    this.undo = [];
    this.confirmAt = 0;
    this.review = null;
    this.moveFrom = null;
    this.t = 0;
    this.el = {
      panel: $('edit-panel'),
      title: $('edit-title'),
      hint: $('edit-hint'),
      actions: $('edit-actions'),
      close: $('edit-close'),
      paint: $('paint-tools'),
      swatches: $('swatches'),
      mats: $('mat-chips'),
      custom: $('paint-custom'),
      sheet: $('layouts'),
      grid: $('layout-grid'),
    };
    this.buildPaintTools();
    this.buildLayouts();
    this.el.close.addEventListener('click', () => this.back());
    $('layouts-close').addEventListener('click', () => this.closeLayouts());
    this.el.sheet.addEventListener('click', (e) => e.target === this.el.sheet && this.closeLayouts());
    for (const b of document.querySelectorAll('#paint-scope button'))
      b.addEventListener('click', () => {
        this.scope = b.dataset.scope;
        if (this.parts.length) this.selectParts(this.parts[0]);
        this.ctx.sfx.uiTick();
        this.render(true);
      });
    this.listen();
  }

  get active() {
    return this.mode !== 'off';
  }

  // ---------- entering / leaving ----------

  open() {
    const { getState, setState, rig } = this.ctx;
    if (getState() !== 'home' || rig.flying) return;
    setState('editing');
    this.mode = 'browse';
    this.ctx.sfx.uiTick();
    this.render(true);
  }

  close() {
    if (!['browse', 'selected', 'review'].includes(this.mode)) return;
    this.deselect();
    this.review = null;
    this.mode = 'off';
    this.ctx.setState('home');
    this.render(true);
  }

  /** Close button / Escape: step back one level. */
  back() {
    const m = this.mode;
    if (m === 'moving') this.cancelMove();
    else if (m === 'paint') this.endPaint();
    else if (m === 'selected') {
      this.deselect();
      this.mode = 'browse';
      this.render(true);
    } else if (m === 'review') this.keepLayout();
    else if (m === 'browse') this.close();
  }

  key(e) {
    if (!this.el.sheet.hidden) {
      if (e.key === 'Escape') this.closeLayouts();
      return;
    }
    if (e.key === 'Escape') this.back();
    else if (this.mode === 'moving' && (e.key === 'r' || e.key === 'R')) this.rotate();
    else if (this.mode === 'moving' && e.key === 'Enter') this.confirmMove();
    else if (this.mode === 'paint' && (e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) this.undoPaint();
  }

  // ---------- selection ----------

  entry() {
    return this.sel != null ? this.ctx.home.buildings.get(this.sel) : null;
  }

  select(id) {
    const { home, sfx } = this.ctx;
    const entry = home.buildings.get(id);
    if (!entry) return;
    this.sel = id;
    this.mode = 'selected';
    this.confirmAt = 0;
    home.showRect(entry.rect);
    // a little hop so you can see which one you picked
    const top = entry.blocks.filter((b) => b.handle != null).slice(-40);
    home.fx.many('hop', top, 0.006, { velocity: 0.35 });
    sfx.uiTick();
    this.render(true);
  }

  deselect() {
    this.setParts([]);
    this.sel = null;
    this.ctx.home.clearRect();
  }

  // ---------- move ----------

  startMove() {
    const { home, save } = this.ctx;
    const rec = save.buildings.find((b) => b.id === this.sel);
    if (!rec) return;
    this.moveFrom = { x: rec.x, z: rec.z, rot: rec.rot || 0 };
    home.clearRect();
    home.removeBuilding(rec.id, 'lift', null, { regrow: false });
    home.beginMove(rec);
    this.mode = 'moving';
    this.render(true);
  }

  rotate() {
    this.ctx.home.rotatePlacement();
    this.ctx.sfx.uiTick();
  }

  confirmMove() {
    const { home, save, persist, life } = this.ctx;
    const p = home.placing;
    if (this.mode !== 'moving' || !p || p.reason) return;
    const rec = save.buildings.find((b) => b.id === p.item.id);
    home.endPlacement();
    Object.assign(rec, { x: p.x, z: p.z, rot: p.rot });
    this.mode = 'busy';
    this.render(true);
    home.placeBuilding(
      rec,
      () => {
        save.paths = home.rerouteAll(true);
        persist(save);
        life.celebrate(rec.x, rec.z);
        this.select(rec.id);
      },
      { fast: true },
    );
  }

  cancelMove() {
    const { home, save } = this.ctx;
    const p = home.placing;
    if (!p) return;
    const rec = save.buildings.find((b) => b.id === p.item.id);
    home.endPlacement();
    Object.assign(rec, this.moveFrom);
    this.mode = 'busy';
    this.render(true);
    home.placeBuilding(rec, () => this.select(rec.id), { fast: true });
  }

  // ---------- store / remove ----------

  store() {
    const { home, save, persist, toast, NAME } = this.ctx;
    const rec = save.buildings.find((b) => b.id === this.sel);
    if (!rec) return;
    this.deselect();
    this.mode = 'busy';
    this.render(true);
    save.buildings = save.buildings.filter((b) => b.id !== rec.id);
    save.tray.push({ id: rec.id, kind: rec.kind, variant: rec.variant, ...(rec.paint ? { paint: rec.paint } : {}) });
    persist(save);
    home.removeBuilding(rec.id, 'lift', () => {
      save.paths = home.rerouteAll(true);
      persist(save);
      this.mode = 'browse';
      this.render(true);
    });
    toast(`${NAME(rec.kind)} packed into your tray`);
  }

  demolish() {
    const { home, save, persist, toast, NAME, sfx } = this.ctx;
    const now = performance.now();
    if (now > this.confirmAt) {
      this.confirmAt = now + 3000;
      sfx.uiTick();
      this.render(true);
      return;
    }
    this.confirmAt = 0;
    const rec = save.buildings.find((b) => b.id === this.sel);
    if (!rec) return;
    this.deselect();
    this.mode = 'busy';
    this.render(true);
    save.buildings = save.buildings.filter((b) => b.id !== rec.id);
    persist(save);
    sfx.giveUpSound();
    home.removeBuilding(rec.id, 'crumble', () => {
      save.paths = home.rerouteAll(true);
      persist(save);
      this.mode = 'browse';
      this.render(true);
    });
    toast(`${NAME(rec.kind)} taken down. You can build it again any time`);
  }

  // ---------- paint ----------

  buildPaintTools() {
    for (const [hex, name] of SWATCHES) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = hex;
      b.title = name;
      b.setAttribute('aria-label', `Paint ${name}`);
      b.addEventListener('click', () => this.paint({ c: hex }));
      this.el.swatches.appendChild(b);
    }
    this.el.custom.addEventListener('input', (e) => this.paint({ c: e.target.value }, true));
    for (const m of PAINT_MATS) {
      const b = document.createElement('button');
      b.className = 'mini-chip';
      b.dataset.mat = m;
      b.textContent = MATERIALS[m].label;
      b.addEventListener('click', () => this.paint({ m }));
      this.el.mats.appendChild(b);
    }
  }

  startPaint() {
    const { home, rig } = this.ctx;
    const entry = this.entry();
    if (!entry) return;
    this.mode = 'paint';
    this.undo = [];
    home.clearRect();
    const r = entry.rect;
    const h = entry.fp.height;
    const size = Math.max(r.x1 - r.x0 + 1, r.z1 - r.z0 + 1, h);
    // aim a little below the building so it sits above the paint panel
    const target = home.group.localToWorld(new THREE.Vector3((r.x0 + r.x1) / 2, h * 0.42 + 0.5 - size * 0.22, (r.z0 + r.z1) / 2));
    rig.fly({ target, dist: Math.max(22, size * 2.7) }, 1.1);
    this.render(true);
  }

  endPaint() {
    this.setParts([]);
    this.ctx.flyHome();
    const entry = this.entry();
    this.mode = 'selected';
    if (entry) this.ctx.home.showRect(entry.rect);
    this.render(true);
  }

  /** Tapped block b: select it, or every block of the same blueprint colour and material. */
  selectParts(b) {
    const entry = this.entry();
    if (!entry) return;
    if (this.scope === 'one') return this.setParts([b]);
    const o = entry.fp.rel[b.idx];
    this.setParts(entry.blocks.filter((x) => x.tone === b.tone && entry.fp.rel[x.idx].mat === o.mat));
  }

  setParts(list) {
    for (const b of this.parts) this.ctx.home.fx.tint(b, b.color);
    this.parts = list;
    this.render(true);
  }

  paint({ c, m }, quiet = false) {
    const { home, save, persist, sfx, toast } = this.ctx;
    if (this.mode !== 'paint') return;
    if (!this.parts.length) return void toast('Tap a block on the building first');
    const entry = this.entry();
    const rec = entry.record;
    const snapshot = JSON.stringify(rec.paint || {});
    if (this.undo[this.undo.length - 1] !== snapshot) this.undo.push(snapshot);
    if (this.undo.length > 40) this.undo.shift();
    const paint = { ...(rec.paint || {}) };
    for (const b of this.parts) {
      const o = entry.fp.rel[b.idx];
      const next = { ...(paint[b.idx] || {}) };
      if (c) next.c = c;
      if (m) next.m = m;
      if (next.c && next.c.replace('#', '').toLowerCase() === String(o.tone).replace('#', '').toLowerCase()) delete next.c;
      if (next.m && next.m === (o.mat || 'plaster')) delete next.m;
      if (next.c || next.m) paint[b.idx] = next;
      else delete paint[b.idx];
    }
    if (Object.keys(paint).length) rec.paint = paint;
    else delete rec.paint;
    home.paintBlocks(entry);
    persist(save);
    if (!quiet) {
      sfx.uiTick();
      home.fx.many('hop', this.parts.filter((b) => b.handle != null).slice(0, 30), 0.01, { velocity: 0.3 });
    }
    this.render(true);
  }

  undoPaint() {
    const entry = this.entry();
    if (!entry || !this.undo.length) return;
    const prev = JSON.parse(this.undo.pop());
    if (Object.keys(prev).length) entry.record.paint = prev;
    else delete entry.record.paint;
    this.ctx.home.paintBlocks(entry);
    this.ctx.persist(this.ctx.save);
    this.ctx.sfx.uiTick();
    this.render(true);
  }

  resetPaint() {
    const entry = this.entry();
    if (!entry || !entry.record.paint) return;
    this.undo.push(JSON.stringify(entry.record.paint));
    delete entry.record.paint;
    this.ctx.home.paintBlocks(entry);
    this.ctx.persist(this.ctx.save);
    this.ctx.sfx.uiTick();
    this.ctx.toast('Back to its original colours');
    this.render(true);
  }

  // ---------- layouts ----------

  buildLayouts() {
    for (const l of LAYOUTS) {
      const card = document.createElement('button');
      card.className = 'layout-card';
      card.innerHTML = `<svg viewBox="0 0 120 80" class="layout-art" aria-hidden="true"><rect x="1" y="1" width="118" height="78" rx="14" class="la-bg"/>${LAYOUT_ART[l.key]}</svg><span class="card-name">${l.name}</span><span class="card-meta">${l.blurb}</span>`;
      card.addEventListener('click', () => this.applyLayout(l));
      this.el.grid.appendChild(card);
    }
  }

  openLayouts() {
    this.el.sheet.hidden = false;
    this.ctx.sfx.uiTick();
  }

  closeLayouts() {
    this.el.sheet.hidden = true;
  }

  applyLayout(tpl) {
    const { home, save, persist, toast, life, flyHome } = this.ctx;
    this.closeLayouts();
    if (!save.buildings.length) return void toast('Place a building first, then try a layout');
    const plan = home.planLayout(tpl);
    if (!plan) return void toast('Not enough room for that layout yet. Focus more to grow your island');
    const before = { moves: save.buildings.map((b) => ({ id: b.id, x: b.x, z: b.z, rot: b.rot || 0 })), paths: [...save.paths] };
    this.deselect();
    this.mode = 'busy';
    this.render(true);
    flyHome();
    home.applyMoves(plan.moves, { avenue: plan.avenue }, (paths) => {
      save.paths = paths;
      persist(save);
      this.review = { name: tpl.name, before };
      this.mode = 'review';
      this.render(true);
      if (save.square) life.celebrate(save.square.x, save.square.z);
    });
  }

  undoLayout() {
    const { home, save, persist, toast } = this.ctx;
    const r = this.review;
    if (!r) return;
    this.review = null;
    this.mode = 'busy';
    this.render(true);
    home.applyMoves(r.before.moves, { paths: r.before.paths }, (paths) => {
      save.paths = paths;
      persist(save);
      this.mode = 'browse';
      this.render(true);
      toast('Back to how it was');
    });
  }

  keepLayout() {
    this.review = null;
    this.mode = 'browse';
    this.ctx.sfx.complete();
    this.render(true);
  }

  // ---------- pointer ----------

  listen() {
    const canvas = $('scene');
    let down = null;
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointermove', (e) => {
      if (this.mode !== 'moving' || e.pointerType !== 'mouse' || e.buttons || !this.ctx.home.placing) return;
      const c = this.ctx.home.pick(this.ctx.ray(e));
      if (c) this.ctx.home.movePlacement(c.x, c.z);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || !this.active || this.ctx.rig.flying) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 6) return; // an orbit drag, not a tap
      this.tap(e);
    });
  }

  tap(e) {
    const { home } = this.ctx;
    const ray = this.ctx.ray(e);
    if (this.mode === 'browse' || this.mode === 'selected' || this.mode === 'review') {
      if (this.mode === 'review') this.keepLayout();
      const id = home.pickBuilding(ray);
      if (id != null && id !== this.sel) this.select(id);
      else if (id == null && this.sel != null) {
        this.deselect();
        this.mode = 'browse';
        this.render(true);
      }
    } else if (this.mode === 'moving') {
      const c = home.pick(ray);
      if (!c) return;
      home.movePlacement(c.x, c.z);
      if (e.pointerType === 'mouse') this.confirmMove();
    } else if (this.mode === 'paint') {
      const b = home.pickPart(ray, this.sel);
      if (b) {
        this.selectParts(b);
        this.ctx.sfx.uiTick();
      } else this.setParts([]);
    }
  }

  // ---------- per frame + panel ----------

  update(dt) {
    this.t += dt;
    const fx = this.ctx.home.fx;
    // the selected building breathes a soft glow; painting flashes the chosen blocks
    const glow = this.mode === 'selected' ? this.entry()?.blocks || [] : [];
    if (this.glowing && this.glowing !== glow) for (const b of this.glowing) fx.tint(b, b.color);
    this.glowing = glow.length ? glow : null;
    if (glow.length) {
      const k = 0.12 + 0.1 * Math.sin(this.t * 3.2);
      for (const b of glow) fx.tint(b, _c.set(b.color).lerp(WHITE, k));
    }
    if (!this.parts.length) return;
    const k = 0.22 + 0.18 * Math.sin(this.t * 6);
    for (const b of this.parts) fx.tint(b, _c.set(b.color).lerp(WHITE, k));
  }

  render(force = false) {
    const { panel } = this.el;
    const on = this.active;
    if (panel.hidden !== !on) panel.hidden = !on;
    if (!on) return;
    const m = this.mode;
    const { NAME, home } = this.ctx;
    const entry = this.entry();
    const name = entry ? NAME(entry.record.kind) : '';
    const confirming = performance.now() < this.confirmAt;
    if (m === 'moving') {
      const p = home.placing;
      this.el.hint.textContent = p?.reason || 'Tap a spot on your island, then place it. Roads find their own way.';
      this.el.hint.classList.toggle('bad', !!p?.reason);
      const place = this.el.actions.querySelector('[data-act="place"]');
      if (place) place.disabled = !p || !!p.reason || this.ctx.rig.flying;
      if (!force) return;
    } else if (!force) {
      const del = this.el.actions.querySelector('[data-act="remove"]');
      if (del && del.classList.contains('confirm') !== confirming) this.render(true);
      return;
    }
    this.el.hint.classList.remove('bad');
    const text = {
      browse: ['Edit your world', 'Tap a building to move, paint or store it, or try a whole new layout.'],
      selected: [name, 'Move it, give it new colours, or pack it away.'],
      moving: [`Move your ${name.toLowerCase() || 'building'}`, ''],
      paint: [`Paint your ${name.toLowerCase()}`, this.parts.length ? `${this.parts.length} block${this.parts.length === 1 ? '' : 's'} selected · pick a colour or material` : 'Tap the building to choose blocks'],
      busy: ['Rearranging…', 'Villagers are moving house'],
      review: [`Layout: ${this.review?.name || ''}`, 'Roads have been re-routed. Keep it?'],
    }[m];
    const nameForMove = m === 'moving' ? `Move your ${NAME(home.placing?.item.kind || '').toLowerCase()}` : null;
    this.el.title.textContent = nameForMove || text[0];
    if (m !== 'moving') this.el.hint.textContent = text[1];
    this.el.paint.hidden = m !== 'paint';
    this.el.close.hidden = m === 'busy';
    for (const b of document.querySelectorAll('#paint-scope button')) b.setAttribute('aria-pressed', String(b.dataset.scope === this.scope));
    const mats = new Set(this.parts.map((b) => b.mat || 'plaster'));
    for (const b of this.el.mats.children) b.setAttribute('aria-pressed', String(mats.size === 1 && mats.has(b.dataset.mat)));

    const acts = {
      browse: [['layouts', 'Layouts', 'btn-soft'], ['done', 'Done', 'btn-go']],
      selected: [['move', 'Move', 'btn-soft'], ['paint', 'Paint', 'btn-soft'], ['store', 'Store', 'btn-soft'], ['remove', confirming ? 'Sure?' : 'Remove', 'btn-danger' + (confirming ? ' confirm' : '')]],
      moving: [['rotate', 'Rotate', 'btn-soft'], ['cancel', 'Cancel', 'btn-soft'], ['place', 'Place here', 'btn-go']],
      paint: [['undo', 'Undo', 'btn-soft'], ['reset', 'Reset', 'btn-soft'], ['paintdone', 'Done', 'btn-go']],
      busy: [],
      review: [['undolayout', 'Undo', 'btn-soft'], ['keep', 'Keep it', 'btn-go']],
    }[m];
    const handlers = {
      layouts: () => this.openLayouts(),
      done: () => this.close(),
      move: () => this.startMove(),
      paint: () => this.startPaint(),
      store: () => this.store(),
      remove: () => this.demolish(),
      rotate: () => this.rotate(),
      cancel: () => this.cancelMove(),
      place: () => this.confirmMove(),
      undo: () => this.undoPaint(),
      reset: () => this.resetPaint(),
      paintdone: () => this.endPaint(),
      undolayout: () => this.undoLayout(),
      keep: () => this.keepLayout(),
    };
    this.el.actions.replaceChildren(
      ...acts.map(([act, label, cls]) => {
        const b = document.createElement('button');
        b.className = `btn ${cls}`;
        b.dataset.act = act;
        b.textContent = label;
        if (act === 'undo') b.disabled = !this.undo.length;
        if (act === 'reset') b.disabled = !entry?.record.paint;
        b.addEventListener('click', handlers[act]);
        return b;
      }),
    );
    if (m === 'moving') this.render(false);
  }
}
