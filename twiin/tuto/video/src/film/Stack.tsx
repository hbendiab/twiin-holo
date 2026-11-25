import type React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Carte, DIM, dureeFilm, Ecran, FPS, Film, Fond, INK, Jumeau, Kicker, MONO, Ouverture, Pourquoi, RULE, type Scene, STRONG, Telephone, Titre, useApparait, type Voix } from "./kit";

// Film de la stack technique de Twiin : chaque brique, et pourquoi ce choix. Voix : public/film/s.json.

type Bloc = { t: string; s?: string; fort?: boolean };

// Une chaîne de blocs qui s'allument l'un après l'autre, reliés par des flèches qui se dessinent
const Chaine: React.FC<{ blocs: Bloc[]; at?: number; pas?: number; x?: number; y?: number; w?: number; vertical?: boolean }> =
  ({ blocs, at = 0.5, pas = 0.9, x = 90, y = 230, w = 1180, vertical }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "stretch", gap: 0 }}>
      {blocs.map((b, i) => {
        const a = interpolate(f, [(at + i * pas) * FPS, (at + i * pas + 0.6) * FPS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const fl = interpolate(f, [(at + i * pas - 0.35) * FPS, (at + i * pas) * FPS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={i} style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "center", flex: vertical ? undefined : 1 }}>
            {i > 0 && <div style={{ [vertical ? "height" : "width"]: 46, [vertical ? "width" : "height"]: 4, background: STRONG, opacity: 0.7,
              transform: vertical ? `scaleY(${fl})` : `scaleX(${fl})`, transformOrigin: vertical ? "top" : "left", flexShrink: 0 }} />}
            <div style={{ flex: 1, width: vertical ? "100%" : undefined, opacity: a, scale: `${0.9 + a * 0.1}`, padding: "24px 26px", borderRadius: 24, boxSizing: "border-box",
              background: b.fort ? STRONG : "#fff", color: b.fort ? "#fff" : INK, border: `2px solid ${b.fort ? STRONG : RULE}`,
              boxShadow: "0 30px 60px -40px rgba(56,66,110,.6)" }}>
              <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.15 }}>{b.t}</div>
              {b.s && <div style={{ fontFamily: MONO, fontSize: 20, marginTop: 10, letterSpacing: "0.03em", color: b.fort ? "#e8ebf5" : DIM, lineHeight: 1.35 }}>{b.s}</div>}
            </div>
          </div>);
      })}
    </div>);
};

const Lieux: React.FC = () => {
  const zones = [["Le Mac", "de l'employé", "Electron · Node · Python"], ["Le cloud", "API et données", "Hugging Face · H Company · Supabase · Vercel"], ["Le téléphone", "du dirigeant", "Page mobile · relais"]];
  return (<Fond><Titre k="Vue d'ensemble" t="Trois endroits, une seule tâche" />
    <div style={{ position: "absolute", left: 90, right: 90, top: 250, display: "flex", gap: 40 }}>
      {zones.map(([a, b, c], i) => { const t = useApparait(0.4 + i * 0.8, 0.7);
        return <div key={a} style={{ flex: 1, opacity: t, translate: `0px ${(1 - t) * 50}px`, padding: "44px 40px", borderRadius: 32, background: "#fff", border: `2px solid ${RULE}`,
          boxShadow: "0 40px 70px -45px rgba(56,66,110,.6)" }}>
          <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: "-0.05em", color: STRONG }}>{a}</div>
          <div style={{ fontSize: 34, color: DIM, marginTop: 6 }}>{b}</div>
          <div style={{ fontFamily: MONO, fontSize: 22, color: STRONG, marginTop: 30, lineHeight: 1.5 }}>{c}</div></div>; })}
    </div></Fond>);
};

const SCENES: Scene[] = [
  { id: "titre", repliques: [0], min: 5, rendu: () => <Ouverture titre="La stack de Twiin" sous="Ce qu'on a choisi, et pourquoi" /> },
  { id: "lieux", repliques: [1], min: 7, rendu: Lieux },
  { id: "poste", repliques: [2, 3], rendu: () => (<Fond><Titre k="Sur le poste" t="Enregistrer et lire l'écran, en local" />
    <Chaine vertical w={980} y={170} pas={1.6} blocs={[{ t: "App Electron", s: "barre de menus · bulles des jumeaux · multi-écran" },
      { t: "Serveur Node + Express", s: "SaaS local · API · télécommande" }, { t: "Workers Python", s: "compilation n8n · pont Holo" },
      { t: "Enregistreur + OCR du Mac", s: "captures · clics sans touches · texte lu en local", fort: true }]} />
    <Pourquoi oui="Lire l'écran en local, aucune touche enregistrée" non="Envoyer tout l'écran dans le cloud" at={9.5} x={1200} w={630} /></Fond>) },
  { id: "analyse", repliques: [4, 5], rendu: () => (<Fond><Titre k="Comprendre" t="Un modèle vision-langage open source" />
    <Chaine y={260} w={1740} pas={1.3} blocs={[{ t: "Texte + quelques images", s: "issus de l'enregistrement" }, { t: "Routeur Hugging Face", s: "router.huggingface.co" },
      { t: "Qwen3.8-27B", s: "vision-langage · open source", fort: true }, { t: "Étapes de la tâche", s: "plan, vérifications, cibles" }]} />
    <Pourquoi oui="Un modèle hébergeable chez le client" non="Être enfermé chez un seul fournisseur" at={7.5} x={90} y={560} w={1740} /></Fond>) },
  { id: "holo", repliques: [6, 7], rendu: () => (<Fond><Titre k="Agir" t="Holo, l'agent de H Company" />
    <Chaine y={220} w={1740} pas={1.2} blocs={[{ t: "Étape à faire", s: "« ouvrir l'e-mail du fournisseur »" }, { t: "H Agents API", s: "Holo voit l'écran, choisit le clic", fort: true },
      { t: "Cloud H Company", s: "tâches web" }, { t: "Pont local sur le Mac", s: "logiciels du poste" }]} />
    <div style={{ position: "absolute", left: 90, right: 90, top: 560, display: "flex", gap: 30 }}>
      <Carte n="≈ 0,01 $" l="tâche web dans le cloud · 28 s · 34 k tokens" at={9} petit />
      <Carte n="≈ 0,06 $" l="tâche sur le Mac · 169 k tokens" at={10} petit />
      <Carte n="Sans API" l="là où les autres outils s'arrêtent" at={11} petit /></div></Fond>) },
  { id: "n8n", repliques: [8, 9], rendu: () => (<Fond><Titre k="Orchestrer" t="Le plan compilé en workflow n8n" />
    <Ecran src="demo/clips/n8n.mp4" w={1180} dur={20.6} />
    <Pourquoi oui="n8n : lisible, modifiable, auditable" non="Un script maison illisible" at={7} x={1300} w={550} /></Fond>) },
  { id: "donnees", repliques: [10], rendu: () => (<Fond><Titre k="Données" t="Supabase, cloisonné par entreprise" />
    <div style={{ position: "absolute", left: 90, right: 90, top: 240, display: "flex", gap: 30 }}>
      <Carte n="Postgres" l="tâches, essais, automatisations, exécutions" at={0.6} />
      <Carte n="Auth" l="un compte par employé" at={1.6} />
      <Carte n="RLS" l="chaque entreprise ne voit que ses données" at={2.6} /></div>
    <div style={{ position: "absolute", left: 90, right: 90, top: 600, textAlign: "center", fontSize: 40, fontWeight: 600, letterSpacing: "-0.02em", color: STRONG,
      opacity: useApparait(6, 0.7) }}>Les clés restent sur le poste, jamais dans l'installeur.</div></Fond>) },
  { id: "mobile", repliques: [11], rendu: () => (<Fond><Titre k="À distance" t="Le téléphone ne touche jamais le Mac" />
    <Telephone src="demo/clips/tel_facture.mp4" x={110} y={140} h={700} dur={38} />
    <Chaine x={620} y={330} w={1220} pas={1.4} blocs={[{ t: "Téléphone", s: "une demande" }, { t: "Relais Vercel", s: "file d'attente", fort: true }, { t: "Mac", s: "exécute, renvoie le résultat" }]} />
    <div style={{ position: "absolute", left: 620, top: 620, opacity: useApparait(6, 0.7) }}><Kicker>Accès coupé en un geste</Kicker></div></Fond>) },
  { id: "voix", repliques: [12], rendu: () => (<Fond><Titre k="Voix et vidéos" t="ElevenLabs + Remotion" />
    <Ecran src="demo/clips/videos.mp4" w={1100} dur={28} />
    <div style={{ position: "absolute", left: 1230, right: 90, top: 200, display: "flex", flexDirection: "column", gap: 26 }}>
      <Carte n="ElevenLabs" l="les voix d'Iris et Ilo" at={0.8} petit />
      <Carte n="Remotion" l="vidéos montées en code, aux couleurs de l'entreprise" at={2.5} petit /></div></Fond>) },
  { id: "fin", repliques: [13], min: 8, rendu: () => (<Fond><AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30, paddingBottom: 140 }}>
    <div style={{ display: "flex", gap: 30 }}><Jumeau qui="iris" size={170} parle /><Jumeau qui="ilo" size={170} parle /></div>
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center", maxWidth: 1500 }}>
      {["Electron", "Node", "Python", "Qwen", "Holo", "n8n", "Supabase", "Vercel", "ElevenLabs", "Remotion"].map((x, i) => {
        const a = useApparait(0.3 + i * 0.25, 0.5); return <div key={x} style={{ opacity: a, scale: `${0.8 + a * 0.2}` }}><Kicker>{x}</Kicker></div>; })}</div>
    <div style={{ fontSize: 96, fontWeight: 600, letterSpacing: "-0.05em" }}>Twiin</div>
    <div style={{ fontFamily: MONO, fontSize: 26, color: STRONG, letterSpacing: "0.06em" }}>POWERED BY H COMPANY · HOLO</div>
  </AbsoluteFill></Fond>) },
];

export const dureeStack = (voix: Voix[]) => dureeFilm(SCENES, voix);
export const TwiinStack: React.FC<{ voix: Voix[] }> = ({ voix }) => <Film scenes={SCENES} voix={voix} />;
