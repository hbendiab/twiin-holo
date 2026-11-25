import type React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Carte, DIM, dureeFilm, Ecran, FPS, Film, Fond, Jumeau, Kicker, MONO, Ouverture, Pourquoi, RULE, type Scene, STRONG, Telephone, Titre, useApparait, type Voix } from "./kit";

// Film des fonctionnalités de Twiin : chaque fonctionnalité, et pourquoi ce choix plutôt qu'un autre.
// Voix : public/film/f.json (ElevenLabs, Iris et Ilo). Extraits : public/film/*.mp4 et public/demo/clips/*.mp4.

const W = 1220; // largeur des écrans à gauche, la carte « Pourquoi » à droite

// Schéma du multi-écran : la tâche passe du moniteur au Mac, la bulle du jumeau suit
const MultiEcran: React.FC = () => {
  const f = useCurrentFrame();
  const p = interpolate(f, [5.5 * FPS, 6.6 * FPS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const a = useApparait(0.2, 0.7);
  const mac = { x: 170, y: 420, w: 640, h: 400 }, mon = { x: 940, y: 200, w: 820, h: 520 };
  const ecran = (e: typeof mac, actif: number, label: string) => (
    <div style={{ position: "absolute", left: e.x, top: e.y, width: e.w, height: e.h, borderRadius: 22, background: "#fff",
      border: `${3 + actif * 3}px solid ${actif > 0.5 ? STRONG : RULE}`, boxShadow: `0 40px 80px -50px rgba(56,66,110,${0.4 + actif * 0.4})` }}>
      <div style={{ position: "absolute", left: 24, top: 18, fontFamily: MONO, fontSize: 22, letterSpacing: "0.08em", color: actif > 0.5 ? STRONG : DIM }}>{label}</div>
    </div>);
  const tache = { x: interpolate(p, [0, 1], [mon.x + 140, mac.x + 90]), y: interpolate(p, [0, 1], [mon.y + 110, mac.y + 80]) };
  return (<Fond>
    <Titre k="Multi-écran" t="La bulle apparaît sur l'écran de la tâche" />
    <div style={{ opacity: a }}>
      {ecran(mon, 1 - p, "MONITEUR EXTERNE")}{ecran(mac, p, "MAC")}
      <div style={{ position: "absolute", left: mac.x + mac.w / 2 - 380, top: mac.y + mac.h + 6, width: 760, height: 22, borderRadius: "0 0 20px 20px", background: RULE }} />
      <div style={{ position: "absolute", left: mon.x + mon.w / 2 - 40, top: mon.y + mon.h, width: 80, height: 70, background: RULE }} />
      <div style={{ position: "absolute", left: tache.x, top: tache.y, width: 420, height: 250, borderRadius: 16, background: "#f4f6fb", border: `2px solid ${RULE}`,
        padding: 22, boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: 8 }}>{[0, 1, 2].map((i) => <div key={i} style={{ width: 14, height: 14, borderRadius: 7, background: RULE }} />)}</div>
        <div style={{ fontSize: 30, fontWeight: 600, marginTop: 18 }}>Gmail</div>
        <div style={{ fontSize: 24, color: DIM, marginTop: 8 }}>Facture Bureau Lumière</div>
      </div>
      <div style={{ position: "absolute", left: tache.x + 300, top: tache.y + 150 + Math.sin(f / 8) * 6, display: "flex", alignItems: "flex-end", gap: 10 }}>
        <Jumeau qui="iris" size={86} parle />
        <div style={{ background: "#fff", border: `2px solid ${STRONG}`, borderRadius: "8px 22px 22px 22px", padding: "12px 18px", fontSize: 24, fontWeight: 500, width: 300 }}>
          Étape 2 : j'ouvre l'e-mail</div>
      </div>
    </div>
  </Fond>);
};

const SCENES: Scene[] = [
  { id: "intro", repliques: [0], min: 5, rendu: () => <Ouverture titre="Twiin en détail" sous="Les fonctionnalités · powered by H Company" /> },
  { id: "accueil", repliques: [1], min: 6, rendu: () => (<Fond>
    <Titre k="Bienvenue" t="Iris et Ilo accueillent chaque employé" /><Ecran src="demo/clips/splash.mp4" w={1300} x={310} dur={20} /></Fond>) },
  { id: "audit", repliques: [2, 3], rendu: () => (<Fond>
    <Titre k="Mon travail" t="L'audit du poste" /><Ecran src="film/audit.mp4" w={W} dur={11.68} />
    <Pourquoi oui="Commencer par la tâche qui rapporte le plus d'heures" non="Automatiser au hasard" at={6} /></Fond>) },
  { id: "enregistrer", repliques: [4, 5], rendu: () => (<Fond>
    <Titre k="Enregistrer" t="La tâche, faite une seule fois" /><Ecran src="film/enregistrer.png" image w={W} h={740} />
    <Pourquoi oui="Observer la tâche une fois, lire l'écran en local" non="Demander de la décrire clic par clic" at={5} /></Fond>) },
  { id: "extension", repliques: [6, 7], rendu: () => (<Fond>
    <Titre k="Extension Chrome" t="Twiin sur chaque page, et dans le panneau latéral" />
    <Ecran src="film/ext_page.mp4" w={1180} y={130} dur={15.3} />
    <Ecran src="film/ext_panel.mp4" w={380} x={1390} y={130} dur={5.6} zoom={false} /></Fond>) },
  { id: "app-mac", repliques: [29, 30], rendu: () => (<Fond>
    <Titre k="App Mac" t="Toujours à portée de main, installée en quelques minutes" />
    <Ecran src="film/app.mp4" w={400} x={110} y={140} dur={11.7} zoom={false} />
    <Ecran src="film/onb.mp4" w={1040} x={600} y={150} dur={23.9} /></Fond>) },
  { id: "app-mac-2", repliques: [31, 32], rendu: () => (<Fond>
    <Titre k="App Mac" t="Notifications et jumeaux guides" />
    <Ecran src="demo/clips/guides.mp4" w={1180} debut={20} dur={50.3} />
    <Ecran src="film/toast.mp4" w={460} x={1360} y={130} dur={5.4} zoom={false} />
    <Pourquoi oui="Être sur le Mac pour lire l'écran et le piloter" non="Un simple site dans un onglet" at={7} x={1340} y={330} w={510} /></Fond>) },
  { id: "automatisations", repliques: [8, 9], rendu: () => (<Fond>
    <Titre k="Mes automatisations" t="Chaque tâche devient un workflow" /><Ecran src="film/autos.mp4" w={W} dur={12.28} />
    <Pourquoi oui="n8n : ouvert, lisible, chez le client" non="Une boîte noire propriétaire" at={5} /></Fond>) },
  { id: "cibles", repliques: [10, 11], rendu: () => (<Fond>
    <Titre k="Personnalisable" t="Une branche par entreprise suivie" /><Ecran src="film/autos.mp4" debut={6} w={W} dur={12.28} />
    <Pourquoi oui="Une cible qui échoue n'arrête pas les autres" non="Tout s'arrête à la première erreur" at={5} /></Fond>) },
  { id: "preuve", repliques: [12, 13], rendu: () => (<Fond>
    <Titre k="Il prouve" t="Rejoué et vérifié avant d'être activé" /><Ecran src="demo/clips/n8n.mp4" w={W} dur={20.6} />
    <Pourquoi oui="Bloquer une valeur douteuse" non="Écrire une erreur dans le fichier" at={5} /></Fond>) },
  { id: "guides", repliques: [14], min: 8, rendu: () => (<Fond>
    <Titre k="Jumeaux guides" t="On voit ce que fait la machine" /><Ecran src="demo/clips/guides.mp4" w={1380} x={270} debut={8} dur={50.3} /></Fond>) },
  { id: "multi-ecran", repliques: [15, 16], rendu: MultiEcran },
  { id: "cloud", repliques: [17, 18], rendu: () => (<Fond>
    <Titre k="Cloud ou Mac" t="Twiin choisit où exécuter" /><Telephone src="demo/clips/tel_cloud.mp4" x={170} y={140} h={720} dur={33.3} />
    <div style={{ position: "absolute", left: 730, right: 90, top: 200, display: "flex", flexDirection: "column", gap: 28 }}>
      <Carte n="Cloud H Company" l="Tâche sur le web · 28 s · environ 0,01 $" at={0.8} />
      <Carte n="Le Mac" l="Logiciel installé sur le poste · Holo pilote le Mac" at={5.5} /></div></Fond>) },
  { id: "mobile", repliques: [19, 20], rendu: () => (<Fond>
    <Titre k="Téléphone" t="Le dirigeant parle, le Mac fait" />
    <Telephone src="demo/clips/tel_facture.mp4" x={150} y={140} h={720} dur={38} />
    <Telephone src="demo/clips/tel_automatise.mp4" x={650} y={140} h={720} dur={25} />
    <Pourquoi oui="Le canal du dirigeant pressé" non="Attendre d'être devant l'ordinateur" at={5.5} x={1240} w={600} /></Fond>) },
  { id: "videos", repliques: [21, 22], rendu: () => (<Fond>
    <Titre k="Mes vidéos" t="Une vidéo de formation pour chaque tâche" /><Ecran src="demo/clips/videos.mp4" w={W} dur={28} />
    <Pourquoi oui="Une vidéo qui explique la machine" non="Une automatisation qu'on désactive faute de la comprendre" at={6} /></Fond>) },
  { id: "marque", repliques: [23, 24], rendu: () => (<Fond>
    <Titre k="Mise en service" t="La marque de l'entreprise, partout" /><Ecran src="film/marque.mp4" debut={0.6} w={W} dur={17.68} />
    <Pourquoi oui="Aux couleurs de l'entreprise, contraste vérifié" non="Un outil de plus, au look générique" at={6} /></Fond>) },
  { id: "connexions", repliques: [25, 26], rendu: () => (<Fond>
    <Titre k="Connexions · Équipe" t="Google en un clic, un espace par personne" /><Ecran src="film/connexions.mp4" w={W} dur={8.48} />
    <Pourquoi oui="Une page de mise en service, sans DSI" non="Paramétrer n8n à la main" at={6} /></Fond>) },
  { id: "fin", repliques: [27, 28], min: 9, rendu: () => (<Fond><AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26, paddingBottom: 140 }}>
    <div style={{ display: "flex", gap: 30 }}><Jumeau qui="iris" size={190} parle /><Jumeau qui="ilo" size={190} parle /></div>
    <div style={{ fontSize: 96, fontWeight: 600, letterSpacing: "-0.05em", textAlign: "center" }}>Apprend. Prouve. Fait.</div>
    <div style={{ display: "flex", gap: 16 }}>{["SaaS", "App Mac", "Extension Chrome", "Téléphone"].map((x) => <Kicker key={x}>{x}</Kicker>)}</div>
    <div style={{ fontFamily: MONO, fontSize: 26, color: STRONG, letterSpacing: "0.06em" }}>TWIIN · POWERED BY H COMPANY · AND NOT A LOT OF SLEEP</div>
  </AbsoluteFill></Fond>) },
];

export const dureeFonctions = (voix: Voix[]) => dureeFilm(SCENES, voix);
export const TwiinFonctions: React.FC<{ voix: Voix[] }> = ({ voix }) => <Film scenes={SCENES} voix={voix} />;
