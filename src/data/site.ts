/**
 * All personal content lives here. Replace the placeholders and the site updates.
 * Keep it short; the page is meant to stay quiet.
 */

export const site = {
  name: 'Zen Tsai',
  fullName: 'Yu-Chen Tsai',
  role: 'HCI Researcher',
  affiliation: 'National Taiwan University',
  advisor: { name: 'Lung-Pan Cheng', href: 'https://www.lungpancheng.tw/' },
  /** Other roles, shown under the bio. */
  roles: [
    { role: 'Organizer, leading the technical track', org: 'NTU AI Safety', href: 'https://ntuais.org/', since: 'Spring 2026' },
  ],
  tagline: 'Designing how people hear, move, and think in space.',
  bio: 'I build interactive systems at the meeting point of perception and computation: spatial sound, embodied motion, and optimization loops that learn from people.',
  email: 'yuchentsai2026@gmail.com',
  links: [
    { label: 'ORCID', href: 'https://orcid.org/0009-0008-3558-5236' },
    { label: 'GitHub', href: 'https://github.com/yuchen-tsai' },
  ],
  description: 'Zen (Yu-Chen) Tsai, HCI researcher at National Taiwan University working on spatial audio, Bayesian optimization, spatial computing, and motion capture.',
};

/** `shape` selects the particle formation shown while the section is in view. */
export const shapes = {
  enso: 0,
  audio: 1,
  optimization: 2,
  motion: 3,
  space: 4,
  garden: 5,
} as const;

export const research = [
  {
    id: 'spatial-audio',
    kanji: '音',
    title: 'Spatial Audio',
    text: 'Rendering and perceiving sound in three dimensions: personalized HRTFs, auditory displays, and listening in mixed reality.',
    shape: shapes.audio,
  },
  {
    id: 'bayesian-optimization',
    kanji: '探',
    title: 'Bayesian Optimization',
    text: 'Human-in-the-loop optimization that tunes interfaces and experiences from a handful of human judgments.',
    shape: shapes.optimization,
  },
  {
    id: 'motion-capture',
    kanji: '動',
    title: 'Motion Capture',
    text: 'Sensing and modeling the moving body to understand skill, expression, and interaction.',
    shape: shapes.motion,
  },
  {
    id: 'spatial-computing',
    kanji: '空',
    title: 'Spatial Computing',
    text: 'Interfaces that live in the room rather than on a screen, and the computation that makes space legible.',
    shape: shapes.space,
  },
];

export const alsoInterested = ['perception', 'haptics', 'prototyping', 'machine learning for design'];

/** `authors` entries matching `site.fullName` are highlighted. */
export const publications = [
  {
    title: 'Hear-to-Hear: Uncertainty-Aware, Head-Tracked Interaction for Personalized Spatial Audio',
    authors: ['Yu-Chen Tsai', 'Lung-Pan Cheng'],
    venue: 'UIST',
    year: 2026,
    links: { doi: 'https://doi.org/10.1145/3830398.3830661', github: 'https://github.com/yuchen-tsai/Hear-to-Hear' },
  },
];
