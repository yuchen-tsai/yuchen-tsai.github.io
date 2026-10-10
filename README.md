# 静寂 · Personal homepage

A quiet, Zen-style homepage for an HCI researcher. You stand at the center of a
particle garden — raked sand rings at your feet, ink-wash mountains all around —
with six stations on the horizon. Each section of the page faces one of them:

| Direction | Section | Formation | Sound |
| --- | --- | --- | --- |
| 0° | Hero / About / Contact | Ensō (the moon at night) | breathing drone, rin bowl; a far temple bell or gong |
| 60° | 音 Spatial Audio | Spherical-harmonic lobes + wavefront rings | singing bowls |
| 120° | 探 Bayesian Optimization | GP surface, uncertainty, samples | chimes that search, then settle on a pitch |
| 180° | 動 Motion Capture | Tai-chi figure, markers, hand trail | the wooden pulse |
| 240° | 空 Spatial Computing | Lattice carved by a sphere | wind |
| 300° | 文 Publications | Karesansui stones and gravel | water, bamboo fountain |

**Scrolling** turns you from station to station, once around the circle over the
whole page (Contact brings you back to the ensō). A stream of particles flows to
the station of the current section and forms its shape.

**Looking around:** drag on open space (or swipe sideways, or press ← →) to turn,
with momentum; a mouse drag also tilts the view up or down a little. On phones,
turning the phone turns you too (on iPhone after sound is switched on, which asks
for motion permission). Wherever you turn, the view stays there — scrolling then
turns you by each section's step from that heading. Resting the mouse nudges the
view slightly toward it.

**The garden responds:** while you turn, the floating motes, sand grains and sound
glints trail behind like mist in wind and the sand ripples outward; the station
shapes stay solid and turn with the world. What you face gathers light while what
is behind you relaxes into mist; staying still deepens the breathing and calms the
drift. Moving the cursor parts the particles; a tap drops a ripple.

**Sound** (the compass button in the header, off by default): every station's
voice comes from its direction through HRTF panners, and what you face is heard
clearer; a bird (an insect at night) and a gust of wind circle you. A 12-step
cycle, one 10.5 s breath long, keeps a gentle pulse with probabilistic hits, and
rarer events arrive every 20–60 s. Fast turns bring a whoosh and briefly hold the
rhythm back. A tap rings a bowl where you point.

| | Day (light theme) | Night (dark theme) |
| --- | --- | --- |
| Scale | Yo (D E G A B) | In (D E♭ G A B♭) |
| Room | short, open garden reverb | long, dark temple-hall reverb |
| Pulse | bamboo knocks, every other step | wooden fish, every third step |
| Overhead | birds | bell-cricket trills |
| Rare events | chime runs, the bush warbler, bamboo fountain | temple bell, gong, bamboo fountain |

Switching theme crossfades the sound over about six seconds; the new scale starts
on the next breath, marked by dawn chimes or a dusk bell. The compass in the
button turns with you (the dot is home, the ensō). The on/off choice is remembered;
browsers need a click before audio can start, so returning visitors get a
"Resume sound" offer rather than sound out of nowhere.

**Stack:** Astro (static) · Three.js · custom GLSL · GSAP · Web Audio · GitHub Pages.

## Editing content

Everything personal lives in [`src/data/site.ts`](src/data/site.ts): name, roles,
bio, links, research blurbs, publications. To add a CV, put it at `public/cv.pdf`
and add `{ label: 'CV', href: '/cv.pdf' }` to `site.links`.

## Develop

```sh
npm install
npm run dev       # http://localhost:4321
npm run check     # type-check
npm run build     # static output in dist/
npm run preview   # serve dist/
```

## Deploy (GitHub Pages)

Live at **https://yuchen-tsai.github.io**. Every push to `main` runs
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which builds the
site and publishes `dist/` to GitHub Pages. Nothing else to configure.

For a custom domain later: add it under **Settings → Pages → Custom domain**,
set `site` in `astro.config.mjs`, and add a `public/CNAME` file containing the domain.

## Performance & accessibility

- All text is real HTML and renders first; the 3D chunk (~165 KB gzipped) loads when
  the browser is idle, and the sound (~5 KB) only when switched on.
- Three draw calls: the particles (all motion in the vertex shader), the painted
  mountain panorama, and the procedural sand.
- Particle budget by device (about 20k desktop / 14k low-core / 10k mobile), pixel
  ratio capped at 1.5, and an automatic step-down if the first seconds run below ~45 fps.
- Rendering and sound pause when the tab is hidden.
- `prefers-reduced-motion` or no WebGL → a static SVG ensō, no animation. Sound still works.

## Structure

```
src/
├── data/site.ts             ← your content
├── components/              ← Hero, About, Research, Publications, Contact, Navigation, toggles
├── layouts/Base.astro       ← head, fonts, no-flash theme script
├── scenes/
│   ├── world.ts             ← shared layout: stations, orbits, coordinates
│   ├── heading.ts           ← where you face: scroll tour, drag, keys, phone heading
│   ├── ZenScene.ts          ← renderer, camera at the center, loop, adaptive quality
│   ├── ParticleField.ts     ← geometry + shader material
│   ├── shapes.ts            ← procedural formations and the garden around you
│   ├── Horizon.ts           ← ink-wash mountains painted on a cylinder
│   ├── Ground.ts            ← raked sand rings (procedural shader)
│   ├── Interaction.ts       ← cursor wind
│   ├── SpatialAudio.ts      ← generative HRTF sound garden, day and night moods
│   ├── dom.ts               ← shared DOM helper
│   └── shaders/             ← particles.vert.glsl / particles.frag.glsl
└── styles/global.css        ← tokens (washi / sumi themes), base styles
```
