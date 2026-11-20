import { Audio } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// Vidéo démo de Twiin (hackathon Build The Future) : de vrais tests filmés cette nuit, racontés par Iris et Ilo.
// Voix : public/demo/voix.json (ElevenLabs, voix des jumeaux). Extraits : public/demo/clips/*.mp4.

const FPS = 30;
const INK = "#161615", DIM = "#5d5d58", STRONG = "#56669c", LAV = "#c9d2e7", RULE = "#dce2f0";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
const ease = Easing.bezier(0.16, 1, 0.3, 1);

type Voix = { f: string; qui: "iris" | "ilo"; texte: string; s: number };
export type DemoProps = { voix: Voix[] };

// Une scène : son visuel, et les répliques (index dans voix.json) qui la racontent
type Scene = { id: string; repliques: number[]; min: number; rendu: React.FC<{ d: number }> };

const useApparait = (from = 0, dur = 0.7) => {
  const f = useCurrentFrame();
  return interpolate(f, [from * FPS, (from + dur) * FPS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
};

const Fond: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: "#fff", fontFamily: FONT, color: INK,
    backgroundImage: `radial-gradient(60% 70% at 88% 12%, ${LAV}aa 0%, transparent 70%), radial-gradient(50% 60% at 6% 100%, ${LAV}88 0%, transparent 65%)` }}>
    <AbsoluteFill style={{ backgroundImage: `radial-gradient(circle, ${STRONG}22 1.6px, transparent 2px)`, backgroundSize: "34px 34px" }} />
    {children}
  </AbsoluteFill>
);

const Kicker: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: "inline-block", fontFamily: MONO, fontSize: 26, letterSpacing: "0.08em", textTransform: "uppercase", color: STRONG,
    padding: "10px 20px", borderRadius: 999, background: `${STRONG}1a` }}>{children}</div>
);

// Iris ou Ilo, qui sautille quand il parle
const Jumeau: React.FC<{ qui: "iris" | "ilo"; size: number; parle?: boolean }> = ({ qui, size, parle }) => {
  const f = useCurrentFrame();
  return <Img src={staticFile(`twiin/${qui}.png`)} style={{ width: size, height: size, filter: `drop-shadow(0 ${size * 0.12}px ${size * 0.18}px rgba(30,34,60,.35))`,
    translate: `0px ${parle ? -Math.abs(Math.sin(f / 4)) * size * 0.06 : Math.sin(f / 20) * size * 0.02}px` }} />;
};

// Bulle de sous-titre : le jumeau qui parle et sa phrase
const Bulle: React.FC<{ v: Voix }> = ({ v }) => {
  const t = useApparait(0, 0.35);
  return (
    <div style={{ position: "absolute", left: 70, right: 70, bottom: 46, display: "flex", alignItems: "flex-end", gap: 18, opacity: t, translate: `0px ${(1 - t) * 20}px` }}>
      <Jumeau qui={v.qui} size={92} parle />
      <div style={{ background: "rgba(255,255,255,.96)", border: `2px solid ${RULE}`, borderRadius: "8px 26px 26px 26px", padding: "14px 24px",
        fontSize: 32, lineHeight: 1.3, fontWeight: 500, boxShadow: "0 24px 40px -26px rgba(56,66,110,.6)", maxWidth: 1500 }}>
        <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: "0.08em", color: STRONG }}>{v.qui.toUpperCase()}</div>{v.texte}
      </div>
    </div>
  );
};

// Un écran filmé dans un cadre (Mac) et éventuellement le téléphone à côté
const Ecran: React.FC<{ src: string; w?: number; x?: number; y?: number; debut?: number }> = ({ src, w = 1240, x = 70, y = 110, debut = 0 }) => {
  const t = useApparait(0, 0.6);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, borderRadius: 18, overflow: "hidden", border: `2px solid ${RULE}`, background: "#fff",
      boxShadow: "0 50px 90px -50px rgba(56,66,110,.7)", opacity: t, scale: `${0.96 + t * 0.04}` }}>
      <OffthreadVideo src={staticFile(src)} startFrom={debut} muted style={{ width: "100%", display: "block" }} />
    </div>
  );
};
const Telephone: React.FC<{ src: string; x?: number; y?: number; h?: number; debut?: number }> = ({ src, x = 1400, y = 70, h = 760, debut = 0 }) => {
  const t = useApparait(0.15, 0.6);
  return (
    <div style={{ position: "absolute", left: x, top: y, height: h, aspectRatio: "393 / 659", borderRadius: 54, padding: 12, background: "#111",
      boxShadow: "0 50px 90px -40px rgba(20,22,40,.75)", opacity: t, translate: `0px ${(1 - t) * 60}px`, rotate: `${(1 - t) * 4}deg` }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 42, overflow: "hidden", background: "#fff" }}>
        <OffthreadVideo src={staticFile(src)} startFrom={debut} muted style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
      </div>
    </div>
  );
};
const Titre: React.FC<{ k: string; t: string; x?: number; y?: number; w?: number }> = ({ k, t, x = 70, y = 40, w = 1300 }) => {
  const a = useApparait(0, 0.6);
  return <div style={{ position: "absolute", left: x, top: y, width: w, display: "flex", alignItems: "center", gap: 20, opacity: a }}>
    <Kicker>{k}</Kicker><div style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-0.03em" }}>{t}</div></div>;
};

const Chiffre: React.FC<{ n: string; l: string; at: number }> = ({ n, l, at }) => {
  const a = useApparait(at, 0.7);
  return <div style={{ opacity: a, translate: `0px ${(1 - a) * 40}px`, flex: 1, padding: "34px 38px", borderRadius: 28, background: "#fff", border: `2px solid ${RULE}`,
    boxShadow: "0 30px 60px -40px rgba(56,66,110,.6)" }}>
    <div style={{ fontSize: 96, fontWeight: 600, letterSpacing: "-0.05em", color: STRONG, lineHeight: 1 }}>{n}</div>
    <div style={{ fontSize: 30, marginTop: 14, color: DIM, lineHeight: 1.3 }}>{l}</div></div>;
};

const SCENES: Scene[] = [
  { id: "ouverture", repliques: [0, 1], min: 7, rendu: () => (<Fond>
    <Ecran src="demo/clips/mac_facture.mp4" debut={0} /><Telephone src="demo/clips/tel_facture.mp4" debut={0} /></Fond>) },
  { id: "titre", repliques: [2], min: 6, rendu: () => {
    const f = useCurrentFrame(); const { fps } = useVideoConfig();
    const s = spring({ frame: f, fps, config: { damping: 14 } });
    return (<Fond><AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
      <div style={{ display: "flex", gap: 40, scale: `${s}` }}><Jumeau qui="iris" size={260} parle /><Jumeau qui="ilo" size={260} /></div>
      <div style={{ fontSize: 170, fontWeight: 600, letterSpacing: "-0.06em", lineHeight: 1 }}>Twiin</div>
      <Kicker>powered by H Company · Holo</Kicker></AbsoluteFill></Fond>);
  } },
  { id: "probleme", repliques: [3], min: 9, rendu: () => (<Fond>
    <Titre k="Le problème" t="Les PME perdent leur temps sur des tâches répétitives" />
    <div style={{ position: "absolute", left: 70, right: 70, top: 220, display: "flex", gap: 30 }}>
      <Chiffre n="3 h" l="par semaine et par employé, sur des tâches répétitives" at={0.4} />
      <Chiffre n="30 à 50 %" l="des premiers projets d'automatisation échouent" at={1.4} />
      <Chiffre n="0" l="DSI dans la plupart des PME pour automatiser" at={2.4} /></div></Fond>) },
  { id: "solution", repliques: [4], min: 9, rendu: () => (<Fond>
    <Titre k="La solution" t="Montrez une fois. Twiin le fait pour toujours." />
    <div style={{ position: "absolute", left: 70, right: 70, top: 220, display: "flex", gap: 30 }}>
      <Chiffre n="Apprend" l="Vous faites la tâche une fois : Twiin la découpe en étapes" at={0.8} />
      <Chiffre n="Prouve" l="Il la rejoue et vérifie chaque valeur avant d'écrire" at={3} />
      <Chiffre n="Fait" l="Workflow n8n + agent Holo, là où il n'y a pas d'API" at={5.2} /></div></Fond>) },
  { id: "facture", repliques: [5, 6], min: 26, rendu: () => (<Fond>
    <Titre k="Test réel · 04 h 08" t="« Envoie-moi la facture fournisseur »" />
    <Ecran src="demo/clips/mac_facture.mp4" debut={0} /><Telephone src="demo/clips/tel_facture.mp4" debut={0} /></Fond>) },
  { id: "automatise", repliques: [7], min: 9, rendu: () => (<Fond>
    <Titre k="Depuis le téléphone" t="« Automatise cette tâche »" />
    <Ecran src="demo/clips/fiche.mp4" debut={0} w={1100} /><Telephone src="demo/clips/tel_automatise.mp4" x={1300} /></Fond>) },
  { id: "n8n", repliques: [8], min: 12, rendu: () => (<Fond>
    <Titre k="n8n" t="Le workflow écrit et testé par Twiin" /><Ecran src="demo/clips/n8n.mp4" w={1500} x={210} /></Fond>) },
  { id: "video", repliques: [9], min: 12, rendu: () => (<Fond>
    <Titre k="Vidéo de formation" t="Générée automatiquement, racontée par Iris et Ilo" /><Ecran src="demo/clips/videos.mp4" w={1500} x={210} /></Fond>) },
  { id: "fiche", repliques: [10], min: 9, rendu: () => (<Fond>
    <Titre k="Mon travail" t="Chaque employé a sa fiche" /><Ecran src="demo/clips/splash.mp4" w={1500} x={210} /></Fond>) },
  { id: "guides", repliques: [11], min: 22, rendu: () => (<Fond>
    <Titre k="Jumeaux guides" t="Pendant l'automatisation, on voit ce qui se passe" /><Ecran src="demo/clips/guides.mp4" w={1500} x={210} /></Fond>) },
  { id: "cloud", repliques: [12], min: 14, rendu: () => (<Fond>
    <Titre k="Cloud H Company" t="Le taux de la BCE en 28 s, ≈ 0,01 $" w={1250} />
    <Telephone src="demo/clips/tel_cloud.mp4" x={760} y={150} h={720} /></Fond>) },
  { id: "partout", repliques: [13], min: 8, rendu: () => (<Fond>
    <Titre k="Partout" t="Une seule promesse, quatre portes d'entrée" />
    <div style={{ position: "absolute", left: 70, right: 70, top: 230, display: "flex", gap: 24 }}>
      {[["SaaS", "Navigateur"], ["App Mac", "Barre de menus"], ["Extension", "Chrome"], ["Mobile", "Le dirigeant pressé"]].map(([a, b], i) => <Chiffre key={a} n={a} l={b} at={0.3 + i * 0.5} />)}</div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 560, display: "flex", gap: 40, alignItems: "center", justifyContent: "center", opacity: 0.85 }}>
      {["bnp-paribas", "microsoft", "loreal", "decathlon", "lvmh", "meetic"].map((m) => <Img key={m} src={staticFile(`marques/${m}.png`)} style={{ height: 64, maxWidth: 220, objectFit: "contain" }} />)}</div></Fond>) },
  { id: "resultats", repliques: [14], min: 6, rendu: () => (<Fond>
    <Titre k="Mesuré cette nuit" t="Vrais tests, vrais chiffres" />
    <div style={{ position: "absolute", left: 70, right: 70, top: 220, display: "flex", gap: 30 }}>
      <Chiffre n="1 min" l="facture trouvée et envoyée sur le téléphone" at={0.3} />
      <Chiffre n="1er essai" l="workflow n8n créé et réussi" at={0.9} />
      <Chiffre n="≈ 0,05 $" l="d'agent Holo par exécution" at={1.5} /></div></Fond>) },
  { id: "fin", repliques: [15, 16], min: 7, rendu: () => (<Fond><AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
    <div style={{ display: "flex", gap: 30 }}><Jumeau qui="iris" size={200} parle /><Jumeau qui="ilo" size={200} parle /></div>
    <div style={{ fontSize: 84, fontWeight: 600, letterSpacing: "-0.045em", textAlign: "center" }}>Montrez une fois.<br />Twiin le fait pour toujours.</div>
    <div style={{ fontFamily: MONO, fontSize: 28, color: STRONG, letterSpacing: "0.06em" }}>POWERED BY H COMPANY · AND NOT A LOT OF SLEEP</div>
    <div style={{ fontFamily: MONO, fontSize: 22, color: DIM }}>Team 10 · Hackathon Build The Future · github.com/hbendiab/twiin-holo</div></AbsoluteFill></Fond>) },
];

const GAP = 0.35; // secondes entre deux répliques
const dureeScene = (sc: Scene, voix: Voix[]) =>
  Math.max(sc.min, sc.repliques.reduce((n, i) => n + (voix[i]?.s || 0) + GAP, 0.6));
export const dureeDemo = (voix: Voix[]) => Math.ceil(SCENES.reduce((n, sc) => n + dureeScene(sc, voix), 0) * FPS);

export const TwiinDemo: React.FC<DemoProps> = ({ voix }) => {
  let t = 0;
  return (
    <AbsoluteFill style={{ background: "#fff", fontFamily: FONT, color: INK }}>
      {SCENES.map((sc) => {
        const d = dureeScene(sc, voix);
        const debut = t; t += d;
        let r = 0.4;
        return (
          <Sequence key={sc.id} name={sc.id} from={Math.round(debut * FPS)} durationInFrames={Math.round(d * FPS)}>
            <sc.rendu d={d} />
            {sc.repliques.map((i) => {
              const v = voix[i]; if (!v) return null;
              const at = r; r += v.s + GAP;
              return (
                <Sequence key={i} from={Math.round(at * FPS)} durationInFrames={Math.round((v.s + GAP) * FPS)}>
                  <Audio src={staticFile(v.f)} /><Bulle v={v} />
                </Sequence>
              );
            })}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
