import * as Tone from 'tone';

// All sounds are synthesised here; there are no audio files.
let ready = false;
let muted = false;
let v = null; // voices
const lastStart = new WeakMap();

export async function unlockAudio() {
  if (ready) return;
  await Tone.start();
  build();
  ready = true;
  Tone.getDestination().mute = muted;
  applyMusic();
  setAmbience(ambLevel);
}

export function setMuted(m) {
  muted = m;
  if (ready) Tone.getDestination().mute = m;
}
export const isMuted = () => muted;

function build() {
  const comp = new Tone.Compressor(-16, 4).toDestination();
  const verb = new Tone.Reverb(1.1).connect(comp);
  verb.wet.value = 0.14;
  const bus = new Tone.Gain(0.9).connect(verb);

  // The "thock": a short pitched membrane body + a woody tick + a filtered noise click.
  const body = new Tone.MembraneSynth({
    pitchDecay: 0.018,
    octaves: 2.4,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.04 },
    volume: -3,
  }).connect(bus);
  const wood = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.02 },
    volume: -15,
  }).connect(bus);
  const clickFilter = new Tone.Filter(2600, 'bandpass').connect(bus);
  const click = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.0005, decay: 0.022, sustain: 0 },
    volume: -13,
  }).connect(clickFilter);

  // Crumble: brown-noise crunch and a low falling knock.
  const crunchFilter = new Tone.Filter(900, 'lowpass').connect(bus);
  const crunch = new Tone.NoiseSynth({
    noise: { type: 'brown' },
    envelope: { attack: 0.002, decay: 0.2, sustain: 0 },
    volume: -2,
  }).connect(crunchFilter);
  const knock = new Tone.MembraneSynth({
    pitchDecay: 0.06,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.05 },
    volume: -9,
  }).connect(bus);

  const chime = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.004, decay: 0.35, sustain: 0.08, release: 0.9 },
    volume: -13,
  }).connect(bus);
  const blip = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.05 },
    volume: -12,
  }).connect(bus);

  v = { body, wood, click, clickFilter, crunch, crunchFilter, knock, chime, blip };
}

// Mono synths throw if two notes start at the same instant; keep each voice's start times increasing.
function at(voice, offset = 0) {
  let t = Tone.now() + 0.01 + offset;
  const prev = lastStart.get(voice) || 0;
  if (t <= prev) t = prev + 0.003;
  lastStart.set(voice, t);
  return t;
}

/** One block landing. combo = landings in quick succession, so pitch climbs during a cascade. */
export function thock(combo = 0, velocity = 1) {
  if (!ready) return;
  const semis = Math.min(combo, 28) * 0.4 + (Math.random() * 2 - 1) * 0.9;
  const f = 96 * 2 ** (semis / 12);
  v.body.triggerAttackRelease(f, 0.1, at(v.body), velocity);
  v.wood.triggerAttackRelease(f * 4.03, 0.03, at(v.wood), velocity);
  v.clickFilter.frequency.value = 1900 + Math.random() * 1800;
  v.click.triggerAttackRelease(0.02, at(v.click), velocity);
}

export function crumble(i = 0) {
  if (!ready) return;
  v.crunchFilter.frequency.value = 450 + Math.random() * 800;
  v.crunch.triggerAttackRelease(0.15, at(v.crunch));
  const f = 70 * 2 ** ((-Math.min(i, 24) * 0.3 + (Math.random() * 2 - 1)) / 12);
  v.knock.triggerAttackRelease(f, 0.2, at(v.knock));
}

export function complete() {
  if (!ready) return;
  const notes = ['G4', 'C5', 'E5', 'G5', 'C6'];
  notes.forEach((n, i) => v.chime.triggerAttackRelease(n, 0.25, Tone.now() + 0.02 + i * 0.085));
}

/** Bright two-note "ching" when coins arrive. */
export function coin() {
  if (!ready) return;
  v.chime.triggerAttackRelease('E6', 0.08, Tone.now() + 0.02);
  v.chime.triggerAttackRelease('B6', 0.18, Tone.now() + 0.1);
}

export function purchase() {
  if (!ready) return;
  ['C5', 'G5', 'C6', 'E6', 'G6'].forEach((n, i) => v.chime.triggerAttackRelease(n, 0.2, Tone.now() + 0.02 + i * 0.06));
}

/** Soft stone click as a road tile is laid. */
export function pave() {
  if (!ready) return;
  v.clickFilter.frequency.value = 1200 + Math.random() * 600;
  v.click.triggerAttackRelease(0.015, at(v.click), 0.35);
  v.wood.triggerAttackRelease(700 + Math.random() * 160, 0.02, at(v.wood), 0.25);
}

export function startSound() {
  if (!ready) return;
  v.blip.triggerAttackRelease('E5', 0.06, at(v.blip));
  v.blip.triggerAttackRelease('A5', 0.08, at(v.blip, 0.08));
}

export function giveUpSound() {
  if (!ready) return;
  v.blip.triggerAttackRelease('C5', 0.08, at(v.blip));
  v.blip.triggerAttackRelease('F#4', 0.12, at(v.blip, 0.1));
}

export function uiTick() {
  if (!ready) return;
  v.blip.triggerAttackRelease('C6', 0.03, at(v.blip));
}

// ---------------------------------------------------------------- music + ambience
// Generative and slow: a soft pad walks through four warm chords, a music box picks sparse
// pentatonic notes over it, and a quiet bass holds the root. Night plays lower and sparser.
// Ambience (rain, wind, birds) follows the weather and lives under the master mute only.

const CHORDS = [
  ['C4', 'E4', 'G4', 'B4'],
  ['A3', 'C4', 'E4', 'G4'],
  ['F3', 'A3', 'C4', 'E4'],
  ['G3', 'B3', 'D4', 'E4'],
];
const ROOTS = ['C2', 'A1', 'F1', 'G1'];
const SCALE = ['C', 'D', 'E', 'G', 'A'];

let m = null; // music voices
let musicWanted = false;
let musicPlaying = false;
let night = 0;
let stopTimer = 0;
let amb = null; // ambience voices
const ambLevel = { rain: 0, wind: 0, day: 1, clear: 1 };

function buildMusic() {
  const out = new Tone.Gain(0).toDestination();
  const verb = new Tone.Reverb({ decay: 7, wet: 0.5 }).connect(out);
  const delay = new Tone.FeedbackDelay('8n.', 0.3).connect(verb);
  delay.wet.value = 0.32;
  const padFilter = new Tone.Filter(1000, 'lowpass').connect(verb);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fattriangle', count: 2, spread: 14 },
    envelope: { attack: 2.6, decay: 1.5, sustain: 0.65, release: 5 },
    volume: -25,
  }).connect(padFilter);
  const bell = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01,
    modulationIndex: 1.4,
    envelope: { attack: 0.004, decay: 1.4, sustain: 0, release: 1.6 },
    modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.4 },
    volume: -21,
  }).connect(delay);
  bell.connect(verb);
  const bass = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 1, decay: 1.5, sustain: 0.5, release: 3 },
    volume: -19,
  }).connect(verb);

  const transport = Tone.getTransport();
  transport.bpm.value = 64;
  let step = 0;
  let walk = 7; // index into the note ladder
  transport.scheduleRepeat((time) => {
    const bar = Math.floor(step / 16) % CHORDS.length;
    if (step % 16 === 0) {
      const chord = night > 0.5 ? CHORDS[bar].map((n) => Tone.Frequency(n).transpose(-12).toNote()) : CHORDS[bar];
      pad.triggerAttackRelease(chord, '2m', time, 0.6);
      bass.triggerAttackRelease(ROOTS[bar], '1m', time, 0.7);
    }
    // a sparse music box: random walk over a pentatonic ladder, resting often
    const chance = (step % 4 === 0 ? 0.42 : 0.16) * (1 - night * 0.55);
    if (Math.random() < chance) {
      walk = Math.max(0, Math.min(11, walk + Math.round((Math.random() - 0.5) * 4)));
      const octave = (night > 0.5 ? 4 : 5) + Math.floor(walk / 5) - 1;
      const note = `${SCALE[walk % 5]}${octave}`;
      bell.triggerAttackRelease(note, '8n', time, 0.35 + Math.random() * 0.3);
      if (Math.random() < 0.18) bell.triggerAttackRelease(`${SCALE[(walk + 2) % 5]}${octave + 1}`, '8n', time + Tone.Time('8n').toSeconds(), 0.25);
    }
    step++;
  }, '8n');
  m = { out, transport };
}

function applyMusic() {
  if (!ready) return;
  if (musicWanted) {
    if (!m) buildMusic();
    clearTimeout(stopTimer);
    if (!musicPlaying) {
      m.transport.start('+0.1');
      musicPlaying = true;
    }
    m.out.gain.rampTo(0.9, 3);
  } else if (m && musicPlaying) {
    m.out.gain.rampTo(0, 2);
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      if (!musicWanted) {
        m.transport.pause();
        musicPlaying = false;
      }
    }, 2400);
  }
}

/** Turn the background music on or off (fades). Safe to call before audio is unlocked. */
export function setMusic(on) {
  musicWanted = on;
  applyMusic();
}

function buildAmbience() {
  const rainGain = new Tone.Gain(0).toDestination();
  const rainFilter = new Tone.Filter(1400, 'lowpass').connect(rainGain);
  const rain = new Tone.Noise('pink').connect(rainFilter);
  const windGain = new Tone.Gain(0).toDestination();
  const windFilter = new Tone.Filter(420, 'bandpass').connect(windGain);
  windFilter.Q.value = 0.8;
  const wind = new Tone.Noise('brown').connect(windFilter);
  const windLfo = new Tone.LFO(0.07, 220, 700).connect(windFilter.frequency);
  windLfo.start();
  const bird = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.08, sustain: 0.2, release: 0.06 }, volume: -31 }).toDestination();
  amb = { rain, rainGain, wind, windGain, bird, rainOn: false, windOn: false, nextBird: Tone.now() + 6 };
}

/** Called about once a second with the sky: rain/snow/wind 0..1, day 0..1, clear 0..1. */
export function setAmbience({ rain = 0, wind = 0, day = 1, clear = 1 } = {}) {
  Object.assign(ambLevel, { rain, wind, day, clear });
  night = 1 - day;
  if (!ready) return;
  if (!amb) buildAmbience();
  const toggle = (src, key, level) => {
    if (level > 0.02 && !amb[key]) {
      src.start();
      amb[key] = true;
    } else if (level <= 0.005 && amb[key]) {
      src.stop('+2');
      amb[key] = false;
    }
  };
  toggle(amb.rain, 'rainOn', rain);
  toggle(amb.wind, 'windOn', wind);
  amb.rainGain.gain.rampTo(rain * 0.16, 2);
  amb.windGain.gain.rampTo(wind * 0.22, 2);
  // the odd bird on fine days: a quick two- or three-note chirp
  const now = Tone.now();
  if (day > 0.6 && clear > 0.6 && rain < 0.05 && now > amb.nextBird) {
    amb.nextBird = now + 5 + Math.random() * 14;
    const base = 2400 + Math.random() * 1200;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const t = now + 0.05 + i * 0.13;
      amb.bird.triggerAttackRelease(base * (1 + i * 0.12 * (Math.random() < 0.5 ? 1 : -1)), 0.06, t);
    }
  }
}

/** Debug: what the audio engine is doing. */
export function audioState() {
  return { ready, musicWanted, musicPlaying, transport: Tone.getTransport().state, context: Tone.getContext().state, ambience: { ...ambLevel } };
}
