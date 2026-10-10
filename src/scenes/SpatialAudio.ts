/**
 * The garden's sound. Each station has its own voice at its own place on the
 * horizon, so turning toward something is also turning toward its sound; a
 * bird (or, at night, an insect) and a travelling gust circle you. What you
 * face is heard a little clearer. A 12-step cycle, one breath long, keeps a
 * gentle pulse; every hit is a chance rather than a certainty, and rarer
 * events arrive every 20–60 s.
 *
 * Day and night are different moods: the bright Yo scale, open air, bamboo and
 * birds by day; the In scale, a temple hall, a wooden fish and insects by night.
 *
 * Off by default: nothing here exists until the visitor opts in.
 */
import { getHeading } from './heading';
import {
  ORBITERS,
  STATIONS,
  STATION_DISTANCE,
  TAU,
  forward,
  orbitPosition,
  placeAt,
  screenToWorld,
  sound,
  stationAngle,
  stationCenter,
  type NoteDetail,
  type Vec3,
} from './world';

const BREATH = 10.5; // seconds; matches the visual breathing cycle
const STEPS = 12;
const STEP = BREATH / STEPS;
const LOOKAHEAD = 0.12;
/** World units to metres around the listener's head. */
const AUDIO_SCALE = 0.4;

type Theme = 'light' | 'dark';

// Two Japanese pentatonic scales, as semitones above D.
const YO = [0, 2, 5, 7, 9];
const IN = [0, 1, 5, 7, 8];

function notes(scale: number[], lo: number, hi: number) {
  const out: number[] = [];
  for (let octave = 0; octave < 9; octave++) {
    for (const s of scale) {
      const f = 36.71 * 2 ** (octave + s / 12);
      if (f >= lo && f <= hi) out.push(f);
    }
  }
  return out;
}

const every = (n: number, offset = 0) => Array.from({ length: STEPS }, (_, i) => (i - offset) % n === 0);

/** Evenly spread hits (a Euclidean rhythm), rotated so the layers interlock. */
const euclid = (hits: number, rotate: number) =>
  Array.from({ length: STEPS }, (_, i) => ((i + rotate) * hits) % STEPS < hits);

const BOWL_STEPS = euclid(5, 1);
const CHIME_STEPS = euclid(4, 2);

type Rare = 'chimeRun' | 'uguisu' | 'shishi' | 'templeBell' | 'gong';

interface Mood {
  wood: number[];
  woodDecay: number;
  woodSteps: boolean[];
  bowl: number[];
  chime: number[];
  rin: number;
  high: 'bird' | 'insect';
  air: number;
  water: number;
  density: number;
  rare: Rare[];
}

const MOODS: Record<Theme, Mood> = {
  light: {
    wood: notes(YO, 380, 700),
    woodDecay: 0.16,
    woodSteps: every(2),
    bowl: notes(YO, 290, 1200),
    chime: notes(YO, 1500, 4800),
    rin: 587.33,
    high: 'bird',
    air: 7000,
    water: 0.22,
    density: 1.1,
    rare: ['chimeRun', 'uguisu', 'shishi'],
  },
  dark: {
    wood: notes(IN, 140, 300),
    woodDecay: 0.4,
    woodSteps: every(3),
    bowl: notes(IN, 145, 620),
    chime: notes(IN, 1100, 3200),
    rin: 293.66,
    high: 'insect',
    air: 2600,
    water: 0.08,
    density: 0.8,
    rare: ['templeBell', 'gong', 'shishi'],
  },
};

// What lives where: the stations follow the page.
const ENSO = 0;
const BOWLS = 1;
const SEARCH = 2;
const PULSE = 3;
const WIND = 4;
const WATER = 5;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const clampIndex = (i: number, list: unknown[]) => Math.max(0, Math.min(list.length - 1, Math.round(i)));
const toAudio = ([x, y, z]: Vec3): Vec3 => [x * AUDIO_SCALE, y * AUDIO_SCALE, z * AUDIO_SCALE];

function gauss() {
  return Math.sqrt(-2 * Math.log(Math.max(Math.random(), 1e-9))) * Math.cos(TAU * Math.random());
}

/** A decaying stereo tail, generated so there is no file to download. */
function impulse(ctx: BaseAudioContext, seconds: number, darkness: number) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // A one-pole low-pass that closes over time: the tail gets darker.
      low += (Math.random() * 2 - 1 - low) * (0.85 - darkness * 0.35 - darkness * 0.45 * t);
      data[i] = low * (1 - t) ** 4;
    }
  }
  return buffer;
}

interface StationVoice {
  input: GainNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  angle: number;
}

export class SoundGarden {
  private heading = getHeading();
  private master: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private sendDay: GainNode;
  private sendNight: GainNode;
  private noise: AudioBuffer;
  private stations: StationVoice[] = [];
  private orbiters: { input: GainNode; panner: PannerNode }[] = [];
  private droneDay: GainNode;
  private droneNight: GainNode;
  private droneBreath: GainNode;
  private air: GainNode;
  private airFilter: BiquadFilterNode;
  private gust: GainNode;
  private whoosh: GainNode;
  private whooshFilter: BiquadFilterNode;

  private theme: Theme;
  private mood: Mood;
  private pendingTheme: Theme | null = null;
  private enabled = false;
  private timer = 0;
  private stopTimer = 0;
  private step = 0;
  private nextStep = 0;
  private nextRare = 0;
  private lastTick = 0;
  private hold = 1;
  private bowlIndex = 4;
  private search = { target: 3, progress: 0 };

  constructor(private ctx: AudioContext) {
    this.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    this.mood = MOODS[this.theme];

    this.master = new GainNode(ctx, { gain: 0 });
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -16, knee: 8, ratio: 6, attack: 0.004, release: 0.3 });
    this.master.connect(limiter).connect(ctx.destination);

    // Dry plus two rooms: an open garden by day, a temple hall by night.
    this.dry = new GainNode(ctx);
    this.dry.connect(this.master);
    this.wet = new GainNode(ctx);
    this.sendDay = new GainNode(ctx, { gain: 0 });
    this.sendNight = new GainNode(ctx, { gain: 0 });
    this.wet.connect(this.sendDay).connect(new ConvolverNode(ctx, { buffer: impulse(ctx, 2.2, 0) })).connect(this.master);
    this.wet.connect(this.sendNight).connect(new ConvolverNode(ctx, { buffer: impulse(ctx, 4.8, 1) })).connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;

    // One fixed voice per station; a filter and gain let the one you face come forward.
    for (let k = 0; k < STATIONS; k++) {
      const input = new GainNode(ctx);
      const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 18000, Q: 0.5 });
      const gain = new GainNode(ctx);
      input.connect(filter).connect(gain).connect(this.panner(toAudio(stationCenter(k))));
      this.stations.push({ input, filter, gain, angle: stationAngle(k) });
    }
    for (let i = 0; i < ORBITERS.length; i++) {
      const input = new GainNode(ctx);
      const panner = this.panner([0, 0, -1]);
      input.connect(panner);
      this.orbiters.push({ input, panner });
    }

    // Earth: a drone that breathes, all around rather than anywhere. By day it
    // sits higher and lighter; by night it adds a low hum. The D3 octave lets
    // laptop and phone speakers carry it.
    this.droneBreath = new GainNode(ctx, { gain: 0 });
    this.droneBreath.connect(this.dry);
    this.droneBreath.connect(this.wet);
    this.droneDay = this.drone([
      [146.83, 0.5, -0.3],
      [147.1, 0.4, 0.3],
      [220.0, 0.25, 0],
      [293.66, 0.1, 0],
    ]);
    this.droneNight = this.drone([
      [36.71, 0.35, 0],
      [73.42, 0.55, -0.3],
      [73.62, 0.45, 0.3],
      [110.0, 0.18, 0],
      [146.83, 0.28, 0],
    ]);

    // Wind lives at its station; a gust travels around you; a whoosh follows fast turns.
    this.airFilter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: this.mood.air, Q: 0.6 });
    this.air = new GainNode(ctx, { gain: 0 });
    this.loop(0).connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1200 })).connect(this.airFilter).connect(this.air).connect(this.stations[WIND].input);

    this.gust = new GainNode(ctx, { gain: 0 });
    this.loop(0.7).connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 0.7 })).connect(this.gust).connect(this.orbiters[1].input);

    this.whooshFilter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 400, Q: 0.9 });
    this.whoosh = new GainNode(ctx, { gain: 0 });
    this.loop(1.3).connect(this.whooshFilter).connect(this.whoosh).connect(this.dry);

    this.applyTheme(this.theme, true);
    this.listen();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    const now = this.ctx.currentTime;
    window.clearTimeout(this.stopTimer);
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    if (on) {
      void this.ctx.resume();
      this.master.gain.setTargetAtTime(0.85, now, 1.3);
      this.run();
    } else {
      this.master.gain.setTargetAtTime(0, now, 0.35);
      this.stopTimer = window.setTimeout(() => this.pause(), 1800);
    }
  }

  // ── Clock ─────────────────────────────────────────────────

  private run() {
    if (this.timer) return;
    void this.ctx.resume();
    this.nextStep = this.ctx.currentTime + 0.1;
    this.lastTick = this.ctx.currentTime;
    if (!this.nextRare) this.nextRare = this.ctx.currentTime + rand(14, 30);
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  private pause() {
    window.clearInterval(this.timer);
    this.timer = 0;
    sound.level = 0;
    void this.ctx.suspend();
  }

  private tick() {
    const now = this.ctx.currentTime;
    const dt = Math.min(now - this.lastTick, 0.2);
    this.lastTick = now;
    sound.level = this.enabled ? 1 : 0;

    const h = this.heading.update();
    this.orient(h.yaw, h.pitch, now);

    // Attention: what you face is clearer and a little louder; what is behind you, muffled.
    for (const s of this.stations) {
      const f = 0.5 + 0.5 * Math.cos(s.angle - h.yaw);
      s.filter.frequency.setTargetAtTime(700 + 17000 * f ** 2.5, now, 0.08);
      s.gain.gain.setTargetAtTime(0.6 + 0.55 * f, now, 0.08);
    }

    sound.clock += dt;
    ORBITERS.forEach((orbit, i) => this.moveTo(this.orbiters[i].panner, toAudio(orbitPosition(orbit, sound.clock)), now));

    // Turning fast: a whoosh of air, and the rhythm holds its breath.
    const spin = Math.min(1, Math.abs(h.omega) / 2.5);
    this.whoosh.gain.setTargetAtTime(0.16 * spin, now, 0.08);
    this.whooshFilter.frequency.setTargetAtTime(300 + 2400 * spin, now, 0.1);
    this.hold = 1 - 0.7 * spin;

    while (this.nextStep < now + LOOKAHEAD) {
      this.schedule(this.step, this.nextStep);
      this.nextStep += STEP;
      this.step = (this.step + 1) % STEPS;
    }
  }

  private schedule(i: number, t: number) {
    // A new mood begins with the breath, marked by dawn chimes or a dusk bell.
    if (i === 0 && this.pendingTheme) {
      this.mood = MOODS[this.pendingTheme];
      this.bowlIndex = Math.min(this.bowlIndex, this.mood.bowl.length - 1);
      if (this.pendingTheme === 'dark') this.templeBell(t);
      else this.chimeRun(t);
      this.pendingTheme = null;
    }

    const m = this.mood;
    const dens = m.density * this.hold;

    // The breath: 0 at the start of the cycle, fullest halfway through.
    const breath = 0.5 - 0.5 * Math.cos((TAU * i) / STEPS);
    this.droneBreath.gain.linearRampToValueAtTime(0.055 * (0.5 + 0.5 * breath), t);
    this.air.gain.linearRampToValueAtTime(0.12 * breath ** 1.5 * rand(0.7, 1.15), t);

    // Ensō: a small rin bowl opens some cycles.
    if (i === 0 && Math.random() < 0.45) {
      this.bowl(t, m.rin, 0.16, this.stations[ENSO].input);
      this.emit(t, stationCenter(ENSO), 0.35);
    }

    // Motion: the pulse. Accents fall on each half-breath.
    if (m.woodSteps[i]) {
      const accent = i === 0 || i === STEPS / 2;
      if (Math.random() < (accent ? Math.min(1, 0.4 + this.hold) : 0.88 * dens)) {
        const freq = accent ? m.wood[0] : pick(m.wood.slice(1));
        this.wood(t + rand(-0.004, 0.004), freq, (accent ? 0.5 : 0.34) * rand(0.85, 1.1), this.stations[PULSE].input, m.woodDecay);
        this.emit(t, stationCenter(PULSE), accent ? 0.3 : 0.16);
      }
    } else if (Math.random() < 0.1 * dens) {
      this.wood(t + rand(0, 0.02), m.wood[m.wood.length - 1], 0.08, this.stations[PULSE].input, m.woodDecay * 0.6);
    }

    // Spatial audio: singing bowls wander up and down the scale.
    if (BOWL_STEPS[i] && Math.random() < 0.7 * dens) {
      this.bowlIndex = clampIndex(this.bowlIndex + pick([-2, -1, -1, 1, 1, 2]), m.bowl);
      this.bowl(t + rand(0, 0.03), m.bowl[this.bowlIndex], 0.22, this.stations[BOWLS].input);
      this.emit(t, stationCenter(BOWLS), 0.45);
    }

    // Optimization: chimes that search. Scattered at first, they close in on
    // one pitch over three breaths, sound it, and begin again.
    if (i === 0) {
      this.search.progress += 1 / 3;
      if (this.search.progress > 1) {
        const found = m.chime[clampIndex(this.search.target, m.chime)];
        this.chime(t, found, 0.1, this.stations[SEARCH].input);
        this.chime(t + 0.3, found, 0.07, this.stations[SEARCH].input);
        this.emit(t, stationCenter(SEARCH), 0.6);
        this.search = { target: Math.floor(rand(0, m.chime.length)), progress: 0 };
      }
    } else if (CHIME_STEPS[i] && Math.random() < 0.6 * dens) {
      const spread = (1 - this.search.progress) * 4;
      const note = m.chime[clampIndex(this.search.target + gauss() * spread, m.chime)];
      this.chime(t + rand(0, 0.04), note, 0.08, this.stations[SEARCH].input);
      this.emit(t, stationCenter(SEARCH), 0.3);
    }

    // Garden: water dripping into the basin.
    if (Math.random() < m.water * dens) {
      const drops = pick([1, 1, 2, 3]);
      for (let d = 0; d < drops; d++) this.waterDrop(t + d * rand(0.12, 0.3), this.stations[WATER].input);
      this.emit(t, stationCenter(WATER), 0.2);
    }

    // Overhead: birds by day, insects by night, circling.
    if (m.high === 'bird' ? Math.random() < 0.07 * dens : Math.random() < 0.12 * dens) {
      if (m.high === 'bird') this.chirps(t, this.orbiters[0].input);
      else this.insect(t, this.orbiters[0].input);
      this.emit(t, orbitPosition(ORBITERS[0], sound.clock), 0.25, 0);
    }

    // A gust sometimes passes around you.
    if (Math.random() < 0.05 * dens) {
      const g = this.gust.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(rand(0.08, 0.14), t + rand(0.8, 1.6));
      g.linearRampToValueAtTime(0, t + rand(2.6, 4));
      this.emit(t + 1, orbitPosition(ORBITERS[1], sound.clock + 1), 0.15, 1);
    }

    if (t >= this.nextRare && i % 3 === 0) {
      const event = pick(m.rare);
      if (event === 'chimeRun') this.chimeRun(t);
      else if (event === 'uguisu') this.uguisu(t);
      else if (event === 'shishi') this.shishiOdoshi(t);
      else if (event === 'templeBell') this.templeBell(t);
      else this.gong(t);
      this.nextRare = t + rand(20, 60);
    }
  }

  // ── Rare events ──────────────────────────────────────────

  /** Far beyond the ensō, a cast bell: hum, prime, tierce, quint, nominal. */
  private templeBell(t: number) {
    const at = placeAt(ENSO, [rand(-2, 2), 1, 0], STATION_DISTANCE * 2);
    const out = this.spot(toAudio(at), 11, 1.6);
    for (const [ratio, gain, decay] of [
      [0.5, 0.5, 10],
      [1, 0.8, 8],
      [1.19, 0.3, 5],
      [1.5, 0.22, 4],
      [2, 0.35, 3.5],
      [2.66, 0.12, 2],
    ]) {
      this.partial(t, 146.83 * ratio, 0.2 * gain, 0.006, decay, out);
    }
    this.emit(t, stationCenter(ENSO), 0.9);
  }

  /** Beyond the ensō, a distant gong that blooms slowly. */
  private gong(t: number) {
    const at = placeAt(ENSO, [rand(-2, 2), 0.5, 0], STATION_DISTANCE * 1.8);
    const out = this.spot(toAudio(at), 9, 1.6);
    for (const [ratio, gain, decay] of [
      [1, 1, 7],
      [1.47, 0.5, 5.5],
      [2.09, 0.35, 4.5],
      [2.56, 0.25, 3.5],
      [3.18, 0.15, 2.5],
      [4.1, 0.08, 1.8],
    ]) {
      this.partial(t, 110 * ratio, 0.13 * gain, 0.04, decay, out);
    }
    this.emit(t, at, 0.8);
  }

  private shishiOdoshi(t: number) {
    const out = this.stations[WATER].input;
    this.wood(t, 330, 0.6, out, 0.5);
    this.wood(t + 0.11, 495, 0.18, out, 0.3);
    for (let d = 0; d < 4; d++) this.waterDrop(t + 0.25 + d * rand(0.08, 0.2), out);
    this.emit(t, stationCenter(WATER), 0.7);
  }

  /** Chimes climbing the scale as they circle all the way around you. */
  private chimeRun(t: number) {
    const start = rand(0, TAU);
    const scale = this.mood.chime;
    for (let n = 0; n < 7; n++) {
      const a = start + (n / 7) * TAU;
      const at: Vec3 = [Math.sin(a) * 3.2, 1.2 + n * 0.1, -Math.cos(a) * 3.2];
      const when = t + n * 0.17;
      this.chime(when, scale[Math.min(n, scale.length - 1)], 0.07, this.spot(toAudio(at), 3.5));
      this.emit(when, at, 0.25);
    }
  }

  /** The bush warbler's spring call: a long "hoo", then "ho-ke-kyo". */
  private uguisu(t: number) {
    const out = this.orbiters[0].input;
    const glide = (start: number, f0: number, f1: number, length: number, amp: number) => {
      const osc = new OscillatorNode(this.ctx, { frequency: f0 });
      osc.frequency.setValueAtTime(f0, start);
      osc.frequency.linearRampToValueAtTime(f1, start + length);
      this.envelope(osc, start, amp, Math.min(0.06, length / 3), length, out);
    };
    glide(t, 1350, 1480, 0.8, 0.05);
    glide(t + 1.05, 2500, 2700, 0.12, 0.05);
    glide(t + 1.22, 3200, 3300, 0.1, 0.045);
    glide(t + 1.36, 2600, 2200, 0.4, 0.05);
    this.emit(t, orbitPosition(ORBITERS[0], sound.clock), 0.4, 0);
  }

  // ── Instruments ───────────────────────────────────────────

  /** A hollow wooden knock: a pitched thump with a quick drop, plus a noise click. */
  private wood(t: number, freq: number, amp: number, out: AudioNode, decay = 0.32) {
    const osc = new OscillatorNode(this.ctx, { frequency: freq * 1.5 });
    osc.frequency.setValueAtTime(freq * 1.5, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.03);
    this.envelope(osc, t, amp, 0.002, decay, out);

    const click = new AudioBufferSourceNode(this.ctx, { buffer: this.noise, playbackRate: rand(0.9, 1.1) });
    const band = new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: freq * 4, Q: 3 });
    click.connect(band);
    this.envelope(click, t, amp * 0.45, 0.001, 0.05, out, band);
  }

  /** A singing bowl: inharmonic partials, the fundamental slowly beating. */
  private bowl(t: number, freq: number, amp: number, out: AudioNode) {
    this.partial(t, freq, amp * 0.55, 0.012, 4.4, out);
    this.partial(t, freq + rand(0.6, 1.2), amp * 0.45, 0.012, 4.0, out);
    this.partial(t, freq * 2.71, amp * 0.36, 0.01, 2.6, out);
    this.partial(t, freq * 5.15, amp * 0.13, 0.008, 1.3, out);
  }

  /** A small glass chime: FM gives the bright strike, a sine carries the ring. */
  private chime(t: number, freq: number, amp: number, out: AudioNode) {
    const carrier = new OscillatorNode(this.ctx, { frequency: freq });
    const mod = new OscillatorNode(this.ctx, { frequency: freq * 3.5 });
    const depth = new GainNode(this.ctx, { gain: 0 });
    depth.gain.setValueAtTime(freq * 1.2, t);
    depth.gain.exponentialRampToValueAtTime(1, t + 0.4);
    mod.connect(depth).connect(carrier.frequency);
    mod.start(t);
    mod.stop(t + 0.5);
    this.envelope(carrier, t, amp, 0.003, 2.4, out);
    this.partial(t, freq * 2.76, amp * 0.25, 0.002, 0.8, out);
  }

  /** A drop into still water: a short sine that leaps upward. */
  private waterDrop(t: number, out: AudioNode) {
    const f = rand(600, 1100);
    const osc = new OscillatorNode(this.ctx, { frequency: f });
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * rand(1.8, 2.6), t + 0.05);
    this.envelope(osc, t, rand(0.08, 0.14), 0.002, 0.12, out);
  }

  /** Two to four quick rising chirps. */
  private chirps(t: number, out: AudioNode) {
    const count = Math.floor(rand(2, 5));
    for (let n = 0; n < count; n++) {
      const start = t + n * rand(0.08, 0.12);
      const f = rand(2600, 3400);
      const osc = new OscillatorNode(this.ctx, { frequency: f });
      osc.frequency.setValueAtTime(f, start);
      osc.frequency.linearRampToValueAtTime(f * rand(1.15, 1.4), start + 0.06);
      this.envelope(osc, start, 0.035, 0.005, 0.08, out);
    }
  }

  /** A bell cricket's trill: a high tone pulsed thirty times a second. */
  private insect(t: number, out: AudioNode) {
    const length = rand(0.4, 0.9);
    const carrier = new OscillatorNode(this.ctx, { frequency: rand(3800, 4600) });
    const pulse = new GainNode(this.ctx, { gain: 0.5 });
    const lfo = new OscillatorNode(this.ctx, { type: 'square', frequency: rand(26, 34) });
    lfo.connect(new GainNode(this.ctx, { gain: 0.5 })).connect(pulse.gain);
    carrier.connect(pulse);
    lfo.start(t);
    lfo.stop(t + length + 0.1);
    this.envelope(carrier, t, 0.03, 0.05, length, out, pulse);
  }

  private partial(t: number, freq: number, amp: number, attack: number, decay: number, out: AudioNode) {
    this.envelope(new OscillatorNode(this.ctx, { frequency: freq }), t, amp, attack, decay, out);
  }

  /** Strike-and-decay envelope; nodes clean themselves up when they finish. */
  private envelope(
    source: AudioScheduledSourceNode,
    t: number,
    amp: number,
    attack: number,
    decay: number,
    out: AudioNode,
    via: AudioNode = source,
  ) {
    const env = new GainNode(this.ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    via.connect(env).connect(out);
    source.start(t);
    source.stop(t + attack + decay + 0.05);
    source.onended = () => env.disconnect();
  }

  private drone(voices: number[][]) {
    const out = new GainNode(this.ctx, { gain: 0 });
    out.connect(this.droneBreath);
    for (const [freq, gain, pan] of voices) {
      const osc = new OscillatorNode(this.ctx, { frequency: freq });
      osc.connect(new GainNode(this.ctx, { gain })).connect(new StereoPannerNode(this.ctx, { pan })).connect(out);
      osc.start();
    }
    return out;
  }

  /** A looping noise source, started at its own offset so the layers don't correlate. */
  private loop(offset: number) {
    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.noise, loop: true });
    src.start(0, offset);
    return src;
  }

  // ── Mood ──────────────────────────────────────────────────

  private applyTheme(theme: Theme, immediate = false) {
    this.theme = theme;
    const now = this.ctx.currentTime;
    const night = theme === 'dark';
    // About six seconds to cross over.
    const tau = immediate ? 0.01 : 2;
    this.sendDay.gain.setTargetAtTime(night ? 0 : 0.3, now, tau);
    this.sendNight.gain.setTargetAtTime(night ? 0.55 : 0, now, tau);
    this.droneDay.gain.setTargetAtTime(night ? 0 : 1, now, tau);
    this.droneNight.gain.setTargetAtTime(night ? 1 : 0, now, tau);
    this.airFilter.frequency.setTargetAtTime(MOODS[theme].air, now, tau);
    if (immediate) this.mood = MOODS[theme];
    else this.pendingTheme = theme;
  }

  // ── Space ─────────────────────────────────────────────────

  private panner(at: Vec3, refDistance = 1) {
    const panner = new PannerNode(this.ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance,
      rolloffFactor: 0.8,
      positionX: at[0],
      positionY: at[1],
      positionZ: at[2],
    });
    panner.connect(this.dry);
    panner.connect(this.wet);
    return panner;
  }

  /** A one-off source at a fixed place, removed once its sound has died away. */
  private spot(at: Vec3, seconds: number, refDistance = 1) {
    const panner = this.panner(at, refDistance);
    window.setTimeout(() => panner.disconnect(), (seconds + LOOKAHEAD + 4) * 1000);
    return panner;
  }

  private moveTo(panner: PannerNode, [x, y, z]: Vec3, now: number) {
    panner.positionX.setTargetAtTime(x, now, 0.05);
    panner.positionY.setTargetAtTime(y, now, 0.05);
    panner.positionZ.setTargetAtTime(z, now, 0.05);
  }

  /** The listener's head follows the shared heading. */
  private orient(yaw: number, pitch: number, now: number) {
    const [fx, fy, fz] = forward(yaw, pitch);
    const ux = -Math.sin(yaw) * Math.sin(pitch);
    const uy = Math.cos(pitch);
    const uz = Math.cos(yaw) * Math.sin(pitch);
    const l = this.ctx.listener;
    if (l.forwardX) {
      l.forwardX.setTargetAtTime(fx, now, 0.05);
      l.forwardY.setTargetAtTime(fy, now, 0.05);
      l.forwardZ.setTargetAtTime(fz, now, 0.05);
      l.upX.setTargetAtTime(ux, now, 0.05);
      l.upY.setTargetAtTime(uy, now, 0.05);
      l.upZ.setTargetAtTime(uz, now, 0.05);
    } else {
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  /** Tell the scene a sound happened, timed to when it is heard. */
  private emit(t: number, at: Vec3, amp: number, orbiter?: number) {
    window.setTimeout(
      () => {
        window.dispatchEvent(new CustomEvent<NoteDetail>('zen:note', { detail: { at, amp } }));
        if (orbiter !== undefined) sound.activity[orbiter] = 1;
      },
      Math.max(0, (t - this.ctx.currentTime) * 1000),
    );
  }

  // ── Inputs ────────────────────────────────────────────────

  private listen() {
    // A tap rings a bowl where you point; higher on screen, higher in pitch.
    window.addEventListener('zen:tap', (event) => {
      if (!this.enabled) return;
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      const h = this.heading;
      const at = screenToWorld(x, y, h.yaw, h.pitch, STATION_DISTANCE);
      const scale = this.mood.bowl;
      const step = clampIndex((1 - y / window.innerHeight) * (scale.length - 1), scale);
      this.bowl(this.ctx.currentTime + 0.01, scale[step], 0.3, this.spot(toAudio(at), 5));
    });

    window.addEventListener('zen:theme', (event) => {
      const theme = (event as CustomEvent<Theme>).detail;
      if (theme !== this.theme) this.applyTheme(theme);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else if (this.enabled) this.run();
    });
  }
}
