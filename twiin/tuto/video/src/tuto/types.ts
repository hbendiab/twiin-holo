// Données d'un tuto Twiin, écrites par tuto/build_tuto.py dans public/tutos/<nom>/props.json

export type Click = { x: number; y: number } | null;

export type Shot = {
  src: string; // chemin dans public/
  w: number;
  h: number;
  click: Click; // position du clic de Holo, normalisée 0-1 dans la capture
  action: string;
};

export type Scene = {
  title: string;
  narration: string;
  tip: string;
  audio: string | null;
  durationInFrames: number;
  shots: Shot[];
};

export type TutoData = {
  title: string;
  intro: string;
  outro: string;
  introAudio: string | null;
  introFrames: number;
  outroAudio: string | null;
  outroFrames: number;
  scenes: Scene[];
};

export const COLORS = {
  bg: "#0e1014",
  panel: "#171a21",
  line: "#272b35",
  text: "#e8eaed",
  dim: "#9aa0a6",
  accent: "#4ea1ff",
  ok: "#36d399",
  warn: "#ffd166",
  click: "#ff6b5b",
};

export const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';

export const TRANSITION_FRAMES = 12;
