// Pitch vidéo de Twiin (≈ 1 min 40) : une scène par phrase de la voix off (tuto/build_pitch.py écrit public/pitch/props.json).
// Style du nouveau Twiin : fond gris → lavande, cartes en verre, pilules noires, le logo animé des deux sphères.
import { Audio } from "@remotion/media";
import { fade } from "@remotion/transitions/fade";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type React from "react";
import {
  AbsoluteFill,
  type CalculateMetadataFunction,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type PitchScene = { id: string; text: string; audio: string; frames: number };
export type PitchData = { scenes: PitchScene[]; logoFrames: number };
export type PitchProps = { readonly data?: PitchData; readonly only?: string };

const T = 12; // fondu entre deux scènes (images)
export const C = {
  text: "#16181d", dim: "#6b7180", accent: "#121418", ink: "#ffffff", blue: "#7d9be3", coral: "#e56b6b", green: "#3f9b74",
  panel: "rgba(255,255,255,0.62)", solid: "#f7f8fa", border: "rgba(255,255,255,0.85)", line: "rgba(22,24,29,0.08)",
};
export const FONT = '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
const BG = "linear-gradient(180deg, #eceef1 0%, #e6e9ef 38%, #d8dff0 72%, #c8d3ee 100%)";

export const calculatePitchMetadata: CalculateMetadataFunction<PitchProps> = async ({ props }) => {
  const data: PitchData = await fetch(staticFile("pitch/props.json")).then((r) => r.json());
  const total = data.scenes.reduce((n, s) => n + s.frames, 0) - (data.scenes.length - 1) * T;
  return { durationInFrames: props.only ? 300 : total, props: { ...props, data } }; // image fixe : on prend la dernière image
};

// ── petits outils d'animation ──────────────────────────────────────────────────────────────────────────────────────
const useIn = (delay = 0, dur = 22) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, durationInFrames: dur, config: { damping: 200 } });
};
const Appear: React.FC<{ delay?: number; y?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ delay = 0, y = 24, children, style }) => {
  const p = useIn(delay);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * y}px)`, ...style }}>{children}</div>;
};

// Logo animé : les deux sphères (images du logo, 12,5 par seconde)
export const Logo: React.FC<{ height: number; n: number }> = ({ height, n }) => {
  const frame = useCurrentFrame();
  const i = Math.floor((frame * 12.5) / 30) % Math.max(1, n);
  return <Img src={staticFile(`pitch/logo/l${String(i).padStart(3, "0")}.png`)} style={{ height, width: "auto" }} />;
};

const Glass: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.panel, border: `1.5px solid ${C.border}`, borderRadius: 36, boxShadow: "0 30px 70px -30px rgba(54,72,120,0.35)", ...style }}>
    {children}
  </div>
);
const Chip: React.FC<{ children: React.ReactNode; dark?: boolean; color?: string }> = ({ children, dark, color }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "10px 22px", borderRadius: 999, fontSize: 26, fontWeight: 650,
    background: dark ? C.accent : color || "#fff", color: dark || color ? "#fff" : C.text, border: dark || color ? "none" : `1.5px solid ${C.border}` }}>{children}</span>
);
const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.16em", color: C.blue, textTransform: "uppercase" }}>{children}</div>
);
const H: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 76 }) => (
  <div style={{ fontSize: size, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.05, color: C.text }}>{children}</div>
);
// Fenêtre de navigateur autour d'une capture de l'app
const Screen: React.FC<{ src: string; width: number; style?: React.CSSProperties }> = ({ src, width, style }) => (
  <div style={{ width, borderRadius: 22, overflow: "hidden", background: "#fff", boxShadow: "0 40px 90px -30px rgba(30,40,80,0.45)", border: "1.5px solid #fff", ...style }}>
    <div style={{ height: 34, background: "#f1f2f5", display: "flex", alignItems: "center", gap: 8, padding: "0 16px" }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />)}
      <span style={{ marginLeft: 18, fontSize: 15, color: C.dim }}>localhost:3000 · Twiin</span>
    </div>
    <Img src={staticFile(`pitch/img/${src}`)} style={{ width: "100%", display: "block" }} />
  </div>
);
const Icon: React.FC<{ name: string; size?: number }> = ({ name, size = 64 }) => (
  <Img src={staticFile(`pitch/icons/${name}.png`)} style={{ width: size, height: size, objectFit: "contain" }} />
);

// ── scènes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const Hook: React.FC<{ n: number }> = ({ n }) => {
  const frame = useCurrentFrame();
  const apps = ["microsoft-excel", "microsoft-outlook", "google-chrome", "google-sheets", "linkedin", "microsoft-onenote", "gmail", "microsoft-word"];
  return (
    <AbsoluteFill style={{ padding: "120px 140px", justifyContent: "center" }}>
      <Appear><Logo height={70} n={n} /></Appear>
      <div style={{ height: 40 }} />
      <Appear delay={6}><H size={96}>Des heures perdues chaque semaine</H></Appear>
      <Appear delay={16}><H size={96}><span style={{ color: C.dim }}>à recopier d'un logiciel à l'autre.</span></H></Appear>
      <div style={{ display: "flex", gap: 28, marginTop: 70 }}>
        {apps.map((a, i) => {
          const p = spring({ frame: frame - 30 - i * 4, fps: 30, config: { damping: 12 } });
          const bob = Math.sin((frame + i * 9) / 14) * 6;
          return (
            <Glass key={a} style={{ width: 120, height: 120, display: "grid", placeItems: "center", borderRadius: 30, opacity: p, transform: `scale(${0.6 + 0.4 * p}) translateY(${bob}px)` }}>
              <Icon name={a} size={70} />
            </Glass>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Probleme: React.FC = () => {
  const rows: [string, string, boolean][] = [["Celonis", "dit où ça coince.", false], ["UiPath", "dit comment vous travaillez.", false], ["Twiin", "prouve que l'automatisation tient, avant de la déployer.", true]];
  return (
    <AbsoluteFill style={{ padding: "0 160px", justifyContent: "center", gap: 34 }}>
      <Appear><Eyebrow>Le problème</Eyebrow></Appear>
      {rows.map(([who, what, us], i) => (
        <Appear key={who} delay={10 + i * 40}>
          <Glass style={{ display: "flex", alignItems: "center", gap: 36, padding: "34px 44px", background: us ? C.accent : C.panel }}>
            <span style={{ fontSize: 50, fontWeight: 800, width: 240, color: us ? "#fff" : C.text }}>{who}</span>
            <span style={{ fontSize: 46, fontWeight: 500, color: us ? "#fff" : C.dim, letterSpacing: "-0.02em" }}>{what}</span>
          </Glass>
        </Appear>
      ))}
    </AbsoluteFill>
  );
};

const ETAPES = [
  { n: "1", t: "Auditer", d: "Les outils du poste, quelques clics, le top 3 des tâches en heures et en €", ok: true },
  { n: "2", t: "Observer", d: "L'employé fait la tâche une fois. Twiin demande : « Ai-je bien compris ? »", ok: true },
  { n: "3", t: "Tester", d: "Un jumeau aux fausses données : 3 essais Holo + 2 essais d'automatisation", ok: true },
  { n: "4", t: "Déployer", d: "≥ 90 % : automatiser (API, n8n, Holo). Sinon : accélérer, avec un tuto vidéo", ok: true },
];
export const Parcours: React.FC<{ n: number }> = ({ n }) => (
  <AbsoluteFill style={{ padding: "110px 110px", justifyContent: "center" }}>
    <Appear style={{ display: "flex", alignItems: "center", gap: 22 }}><Logo height={54} n={n} /><Eyebrow>Le parcours</Eyebrow></Appear>
    <Appear delay={6}><H>Auditer, observer, tester, déployer.</H></Appear>
    <div style={{ display: "flex", alignItems: "stretch", gap: 18, marginTop: 70 }}>
      {ETAPES.map((e, i) => (
        <div key={e.n} style={{ display: "flex", alignItems: "center", gap: 18, flex: 1 }}>
          <Appear delay={20 + i * 14} style={{ flex: 1, height: "100%" }}>
            <Glass style={{ padding: "36px 32px", height: 330, display: "flex", flexDirection: "column", gap: 18, background: e.ok ? C.panel : "rgba(229,107,107,0.10)" }}>
              <span style={{ width: 64, height: 64, borderRadius: 32, background: C.accent, color: "#fff", display: "grid", placeItems: "center", fontSize: 32, fontWeight: 800 }}>{e.n}</span>
              <span style={{ fontSize: 46, fontWeight: 800, letterSpacing: "-0.03em" }}>{e.t}</span>
              <span style={{ fontSize: 26, color: C.dim, lineHeight: 1.35 }}>{e.d}</span>
              {!e.ok ? <span style={{ marginTop: "auto" }}><Chip color={C.coral}>En cours</Chip></span> : null}
            </Glass>
          </Appear>
          {i < ETAPES.length - 1 ? <Appear delay={26 + i * 14}><span style={{ fontSize: 46, color: C.dim }}>›</span></Appear> : null}
        </div>
      ))}
    </div>
  </AbsoluteFill>
);

// Scène « capture de l'app » : étiquette, titre, et une ou deux captures qui glissent
const Demo: React.FC<{ step: string; title: string; main: string; second?: string; inset?: string; insetW?: number; tags?: string[]; swapAt?: number }> = ({ step, title, main, second, inset, insetW = 380, tags = [], swapAt = 0.55 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const swap = second ? interpolate(frame, [durationInFrames * swapAt, durationInFrames * swapAt + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const zoom = interpolate(frame, [0, durationInFrames], [1, 1.04], { easing: Easing.inOut(Easing.quad) });
  const pIn = useIn(4, 30);
  const pInset = useIn(30, 26);
  return (
    <AbsoluteFill style={{ padding: "70px 100px 0", flexDirection: "row", gap: 60 }}>
      <div style={{ width: 520, paddingTop: 70, display: "flex", flexDirection: "column", gap: 26 }}>
        <Appear><Chip dark>{step}</Chip></Appear>
        <Appear delay={6}><H size={68}>{title}</H></Appear>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
          {tags.map((t, i) => <Appear key={t} delay={18 + i * 6}><Chip>{t}</Chip></Appear>)}
        </div>
      </div>
      <div style={{ position: "relative", flex: 1, paddingTop: 40 }}>
        <div style={{ position: "relative", opacity: pIn, transform: `translateX(${(1 - pIn) * 80}px) scale(${zoom})`, transformOrigin: "top left" }}>
          <Screen src={main} width={1130} style={{ opacity: 1 - swap }} />
          {second ? <Screen src={second} width={1130} style={{ position: "absolute", top: 0, left: 0, opacity: swap }} /> : null}
        </div>
        {inset ? (
          <div style={{ position: "absolute", right: -40, bottom: 190, width: insetW, borderRadius: 28, overflow: "hidden", boxShadow: "0 40px 80px -24px rgba(20,30,60,0.55)",
            border: "3px solid #fff", opacity: pInset, transform: `translateY(${(1 - pInset) * 60}px)` }}>
            <Img src={staticFile(`pitch/img/${inset}`)} style={{ width: "100%", display: "block" }} />
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const Tester: React.FC = () => {
  const frame = useCurrentFrame();
  const essais: [string, string, string][] = [["1", "Conseil", "agent Holo"], ["2", "Conseil", "agent Holo"], ["3", "Conseil", "agent Holo"],
    ["4", "Automatisation", "n8n"], ["5", "Automatisation", "n8n + Holo"]];
  const fill = (i: number) => interpolate(frame, [60 + i * 10, 150 + i * 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ padding: "90px 120px", justifyContent: "center" }}>
      <Appear><Eyebrow>3 · Tester · le crash test</Eyebrow></Appear>
      <Appear delay={6}><H>On rejoue sur un jumeau, on garde ce qui tient.</H></Appear>
      <div style={{ display: "flex", gap: 40, marginTop: 56, alignItems: "center" }}>
        <Appear delay={14}>
          <Glass style={{ width: 400, padding: "34px 36px" }}>
            <div style={{ fontSize: 26, color: C.dim, fontWeight: 600 }}>Le jumeau</div>
            <div style={{ fontSize: 36, fontWeight: 800, margin: "8px 0 14px", lineHeight: 1.2 }}>Une copie de la tâche, aux fausses données</div>
            <div style={{ fontSize: 24, color: C.dim, lineHeight: 1.4 }}>Construite en 1 à 2 min. Les essais n'y touchent jamais les vrais outils.</div>
          </Glass>
        </Appear>
        <Appear delay={24}><span style={{ fontSize: 64, color: C.dim }}>→</span></Appear>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 640 }}>
          {essais.map(([k, t, d], i) => (
            <Appear key={k} delay={30 + i * 6}>
              <Glass style={{ display: "flex", alignItems: "center", gap: 20, padding: "16px 26px", borderRadius: 22 }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: i < 3 ? C.blue : C.coral, width: 30 }}>{k}</span>
                <span style={{ fontSize: 30, fontWeight: 700, width: 250 }}>{t}</span>
                <span style={{ fontSize: 24, color: C.dim, width: 160 }}>{d}</span>
                <span style={{ flex: 1, height: 12, borderRadius: 6, background: C.line, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${fill(i) * 100}%`, background: i < 3 ? C.blue : C.coral, borderRadius: 6 }} />
                </span>
              </Glass>
            </Appear>
          ))}
        </div>
        <Appear delay={60}><span style={{ fontSize: 64, color: C.dim }}>→</span></Appear>
        <Appear delay={70}>
          <Glass style={{ padding: "34px 36px", width: 360, background: C.accent }}>
            <div style={{ fontSize: 26, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>Décision</div>
            <div style={{ fontSize: 70, fontWeight: 800, color: "#fff", letterSpacing: "-0.04em", margin: "6px 0" }}>≥ 90 %</div>
            <div style={{ fontSize: 28, color: "#fff", fontWeight: 700 }}>on automatise</div>
            <div style={{ fontSize: 24, color: "rgba(255,255,255,0.7)", marginTop: 8 }}>sinon : accélérer, avec un tuto</div>
          </Glass>
        </Appear>
      </div>
    </AbsoluteFill>
  );
};

// Résultats mesurés (tests de Lucas, branche feat/decouverte-env-test, PC Windows)
const Resultats: React.FC = () => {
  const frame = useCurrentFrame();
  const count = (to: number, from: number, start: number) => Math.round(interpolate(frame, [start, start + 40], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const cas: [string, string, React.ReactNode, string][] = [
    ["Comparatif d'achat", "3 sites marchands → un tableau Excel", <>{count(51, 0, 20)} s</>, "automatisé, sans toucher l'écran du salarié"],
    ["Saisie comptable", "facture PDF → logiciel sans API", <>{count(79, 0, 70)} s</>, "par Holo, toutes les valeurs justes"],
    ["Fiabilité de Holo", "avec mémoire de travail et guidage", <>{count(30, 30, 120)} → {count(100, 30, 130)} %</>, "de réussite des essais"],
  ];
  return (
    <AbsoluteFill style={{ padding: "100px 130px", justifyContent: "center" }}>
      <Appear><Eyebrow>Testé sur des tâches réelles</Eyebrow></Appear>
      <Appear delay={6}><H>Des résultats mesurés.</H></Appear>
      <div style={{ display: "flex", gap: 32, marginTop: 60 }}>
        {cas.map(([t, d, big, s2], i) => (
          <Appear key={t} delay={14 + i * 46} style={{ flex: 1 }}>
            <Glass style={{ padding: "40px 40px", height: 400, display: "flex", flexDirection: "column", gap: 10, background: i === 2 ? C.accent : C.panel }}>
              <span style={{ fontSize: 38, fontWeight: 800, color: i === 2 ? "#fff" : C.text }}>{t}</span>
              <span style={{ fontSize: 26, color: i === 2 ? "rgba(255,255,255,0.7)" : C.dim }}>{d}</span>
              <span style={{ marginTop: "auto", fontSize: i === 2 ? 84 : 104, fontWeight: 800, letterSpacing: "-0.05em", whiteSpace: "nowrap", color: i === 2 ? "#fff" : C.green }}>{big}</span>
              <span style={{ fontSize: 26, color: i === 2 ? "rgba(255,255,255,0.75)" : C.dim }}>{s2}</span>
            </Glass>
          </Appear>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Box: React.FC<{ title: string; items: string[]; icon?: string; delay: number; accent?: boolean }> = ({ title, items, icon, delay, accent }) => (
  <Appear delay={delay}>
    <Glass style={{ padding: "26px 30px", borderRadius: 28, background: accent ? C.accent : C.panel }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 32, fontWeight: 800, color: accent ? "#fff" : C.text }}>{icon ? <Icon name={icon} size={40} /> : null}{title}</div>
      {items.map((x) => <div key={x} style={{ fontSize: 24, color: accent ? "rgba(255,255,255,0.75)" : C.dim, marginTop: 8 }}>{x}</div>)}
    </Glass>
  </Appear>
);
export const Archi: React.FC = () => (
  <AbsoluteFill style={{ padding: "90px 110px", justifyContent: "center" }}>
    <Appear><Eyebrow>Architecture technique</Eyebrow></Appear>
    <Appear delay={6}><H size={64}>Les données sensibles restent sur le Mac.</H></Appear>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 1fr 90px 1.15fr", alignItems: "center", marginTop: 54, gap: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: C.dim, letterSpacing: "0.1em" }}>SUR LE MAC DE L'EMPLOYÉ</div>
        <Box delay={14} title="Interfaces" items={["Page web Twiin", "Extension Chrome", "App Mac (Electron)"]} />
        <Box delay={22} title="Capture locale · Mac ou Windows" items={["Écrans · OCR local", "Journal des clics (sans les touches)", "Audit des outils"]} />
      </div>
      <Appear delay={30} style={{ textAlign: "center", fontSize: 54, color: C.dim }}>→</Appear>
      <Box delay={34} accent title="Serveur Twiin" items={["Node.js · Express", "Workers Python : audit, jumeau, essais", "Playwright : navigateurs invisibles"]} />
      <Appear delay={42} style={{ textAlign: "center", fontSize: 54, color: C.dim }}>→</Appear>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: C.dim, letterSpacing: "0.1em" }}>SERVICES</div>
        <Box delay={46} title="Qwen · Hugging Face" items={["Comprendre la tâche, bâtir le jumeau"]} />
        <Box delay={52} icon="n8n" title="Holo 4 (H) + n8n" items={["Essais, puis automatisations"]} />
        <Box delay={58} title="ElevenLabs + Remotion" items={["Vidéos de formation, voix studio"]} />
        <Box delay={64} title="Supabase" items={["Données cloisonnées par entreprise"]} />
      </div>
    </div>
  </AbsoluteFill>
);

const FAIT = ["Audit du poste : outils, top 3 en heures et en €", "Capture multi-écrans, OCR local, Mac et Windows", "Analyse, « Ai-je bien compris ? », recommandation",
  "Jumeau + crash test : 3 essais Holo + 2 automatisations", "Vidéos de formation, voix studio", "Automatisations n8n + Holo, en arrière-plan", "Extension Chrome + app Mac"];
const EN_COURS = ["Réunir les deux branches en une version", "Tests A → Z sur de nouveaux cas", "Comparer les modèles Holo (3 et 4)"];

export const Avancement: React.FC = () => (
  <AbsoluteFill style={{ padding: "100px 130px", justifyContent: "center" }}>
    <Appear><Eyebrow>Avancement</Eyebrow></Appear>
    <Appear delay={6}><H>Ce qui marche aujourd'hui.</H></Appear>
    <div style={{ display: "flex", gap: 40, marginTop: 56 }}>
      <Glass style={{ flex: 1.3, padding: "34px 40px" }}>
        {FAIT.map((x, i) => (
          <Appear key={x} delay={14 + i * 6} style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 32, padding: "10px 0" }}>
            <span style={{ width: 40, height: 40, borderRadius: 20, background: C.green, color: "#fff", display: "grid", placeItems: "center", fontSize: 24, flex: "none" }}>✓</span>{x}
          </Appear>
        ))}
      </Glass>
      <Glass style={{ flex: 1, padding: "34px 40px", background: "rgba(229,107,107,0.10)" }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.coral, letterSpacing: "0.1em", marginBottom: 10 }}>EN COURS</div>
        {EN_COURS.map((x, i) => (
          <Appear key={x} delay={52 + i * 6} style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 32, padding: "10px 0" }}>
            <span style={{ width: 40, height: 40, borderRadius: 20, border: `3px solid ${C.coral}`, flex: "none" }} />{x}
          </Appear>
        ))}
      </Glass>
    </div>
  </AbsoluteFill>
);

const ROADMAP: [string, string, string][] = [
  ["Lun 16/11", "Premier test de Holo", "cadrage, logiciel de démo sans API"],
  ["Mar 17/11", "Observer", "capture multi-écrans, étapes, rejeu par Holo, n8n"],
  ["Mer 18/11", "Audit, jumeau, essais", "audit du poste, crash test, tutos vidéo, extension, app Mac"],
  ["Jeu 19/11 · ce soir", "Réunir et tester", "une seule version, tests A → Z, comparer Holo 3 et 4"],
];
export const Roadmap: React.FC = () => {
  const frame = useCurrentFrame();
  const line = interpolate(frame, [10, 70], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ padding: "100px 120px", justifyContent: "center" }}>
      <Appear><Eyebrow>Roadmap · du lundi 16 au jeudi 19 novembre</Eyebrow></Appear>
      <Appear delay={6}><H>Quatre jours, du premier test au crash test.</H></Appear>
      <div style={{ position: "relative", marginTop: 90 }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 22, height: 6, borderRadius: 3, background: C.line }} />
        <div style={{ position: "absolute", left: 0, width: `${line}%`, top: 22, height: 6, borderRadius: 3, background: `linear-gradient(90deg, ${C.blue}, ${C.coral})` }} />
        <div style={{ display: "flex", justifyContent: "space-between", position: "relative" }}>
          {ROADMAP.map(([d, t, s], i) => (
            <Appear key={d} delay={14 + i * 10} style={{ width: 380 }}>
              <span style={{ display: "block", width: 50, height: 50, borderRadius: 25, background: i === ROADMAP.length - 1 ? C.coral : C.accent, border: "6px solid #fff" }} />
              <div style={{ fontSize: 26, fontWeight: 700, color: C.blue, marginTop: 24 }}>{d}</div>
              <div style={{ fontSize: 36, fontWeight: 800, marginTop: 8, letterSpacing: "-0.02em" }}>{t}</div>
              <div style={{ fontSize: 25, color: C.dim, marginTop: 8, lineHeight: 1.35 }}>{s}</div>
            </Appear>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ n: number }> = ({ n }) => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 30 }}>
    <Appear style={{ display: "flex", alignItems: "center", gap: 30 }}><Logo height={130} n={n} /><span style={{ fontSize: 130, fontWeight: 800, letterSpacing: "-0.05em" }}>Twiin</span></Appear>
    <Appear delay={10}><div style={{ fontSize: 54, fontWeight: 600, color: C.dim, letterSpacing: "-0.02em" }}>Analyse tes tâches. Automatise tes process.</div></Appear>
    <Appear delay={22}><Chip>Hackathon Build The Future · Team 10</Chip></Appear>
  </AbsoluteFill>
);

// Sous-titres : la phrase dite, en bas (une vidéo de pitch est souvent regardée sans le son)
const Subtitle: React.FC<{ text: string }> = ({ text }) => {
  const p = useIn(8, 18);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 38, display: "flex", justifyContent: "center", opacity: p }}>
      <div style={{ maxWidth: 1500, textAlign: "center", fontSize: 28, lineHeight: 1.35, color: C.text, background: "rgba(255,255,255,0.72)", padding: "12px 26px", borderRadius: 18 }}>{text}</div>
    </div>
  );
};

const VISUEL: Record<string, (n: number) => React.ReactNode> = {
  hook: (n) => <Hook n={n} />,
  probleme: () => <Probleme />,
  parcours: (n) => <Parcours n={n} />,
  audit: () => <Demo step="1 · Auditer" title="Les outils du poste, puis quelques clics." main="audit.png" second="taches.png" tags={["Outils détectés", "Tâches de la semaine", "Top 3 en €"]} />,
  observer: () => <Demo step="2 · Observer" title="L'employé fait la tâche une fois." main="enregistrer.png" inset="panel-rec.png" insetW={340} tags={["Navigateur", "Extension Chrome", "App Mac"]} />,
  reco: () => <Demo step="Recommander" title="Accélérer, ou automatiser." main="reco.png" second="autos.png" inset="tuto.png" insetW={520} swapAt={0.5} tags={["Vidéo de formation", "n8n", "Holo"]} />,
  tester: () => <Tester />,
  resultats: () => <Resultats />,
  archi: () => <Archi />,
  avancement: () => <Avancement />,
  roadmap: () => <Roadmap />,
  outro: (n) => <Outro n={n} />,
};

export const TwiinPitch: React.FC<PitchProps> = ({ data, only }) => {
  const { fps } = useVideoConfig();
  if (!data) return null;
  const bg = { background: BG, fontFamily: FONT, color: C.text } as const;
  // Image fixe (parcours, architecture, roadmap) : la scène entièrement affichée, sans voix ni sous-titre
  if (only) return <AbsoluteFill style={bg}>{VISUEL[only](data.logoFrames)}</AbsoluteFill>;
  const timing = linearTiming({ durationInFrames: T });
  return (
    <AbsoluteFill style={bg}>
      <TransitionSeries>
        {data.scenes.flatMap((s, i) => [
          ...(i ? [<TransitionSeries.Transition key={`t${s.id}`} presentation={fade()} timing={timing} />] : []),
          <TransitionSeries.Sequence key={s.id} name={s.id} durationInFrames={s.frames} premountFor={fps}>
            <AbsoluteFill style={bg}>
              <Audio src={staticFile(s.audio)} />
              {VISUEL[s.id]?.(data.logoFrames)}
              {s.id !== "outro" ? <Subtitle text={s.text} /> : null}
            </AbsoluteFill>
          </TransitionSeries.Sequence>,
        ])}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
