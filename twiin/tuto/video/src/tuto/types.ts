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
  marque?: Marque | null;
  logos?: string[]; // logos des applis de la tâche (couverture)
};

// DA Twiin : blanc et lavande, encre presque noire ; la couleur forte devient celle de l'entreprise cliente si elle est réglée
export const COLORS = {
  bg: "#f7f8fc",
  panel: "#ffffff",
  line: "#dce2f0",
  text: "#161615",
  dim: "#5d5d58",
  accent: "#56669c",
  lavender: "#c9d2e7",
  chip: "#e6ebf5",
  ok: "#1f8a5b",
  warn: "#e8a33d",
  click: "#e2533f",
};

export type Marque = { nom: string; couleur: string | null; couleur2?: string | null; police?: string | null; logo: string | null };

export const FONT = '"Google Sans Flex", -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
export const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';

export const TRANSITION_FRAMES = 12;
