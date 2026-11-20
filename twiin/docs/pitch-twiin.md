# Twiin — pitch du 20 novembre 2026 (Team 10)

**Twiin · powered by H Company (Holo)** — « Montrez une fois. Twiin le fait pour toujours. »
Twiin **apprend** une tâche (vous la faites une fois), **prouve** qu'elle tient (il la rejoue et vérifie chaque valeur),
puis **la fait à votre place** — sur le Mac, dans le navigateur, dans Chrome ou depuis le téléphone.

---

## 1. Ce qui a été testé cette nuit (filmé, de bout en bout)

| Test | Comment | Résultat | Durée mesurée | Coût agent Holo |
|---|---|---|---|---|
| Facture fournisseur (Gmail → PDF sur le téléphone) | Message depuis la page mobile ; Holo agit sur le Mac | Réussi | ≈ 47 s du message à la facture sur le téléphone | 169 k tokens · ≈ 0,06 $ |
| « Automatise cette tâche » | Depuis le téléphone | Workflow n8n créé, importé, testé : **réussi au 1er essai** | ≈ 1 min 30 | — |
| « Crée la vidéo de formation » | Depuis le téléphone | Vidéo de 1 min 04 (3 étapes, voix d'Iris et Ilo), rangée dans *Mes vidéos*, partagée avec l'équipe | ≈ 4 min | — |
| Relancer l'automatisation facture | Depuis *Mes automatisations*, sur le Mac, avec les jumeaux guides | Réussi | 1 min 51 (n8n) | ≈ 0,06 $ |
| Taux euro-dollar de la BCE (web) | Depuis le téléphone, puis automatisé | 1er essai bloqué par la vérification (« 1.0992 » au lieu de « 1,0992 ») → **corrigé** (les deux séparateurs sont acceptés) → **réussi**, dans le cloud de H Company | **28 s** | 34 k tokens · ≈ 0,01 $ |

Ce que l'échec du taux BCE prouve : la vérification bloque une écriture douteuse au lieu d'écrire une valeur fausse ;
c'est exactement la promesse « elle prouve que ça tient ». Taux : holo4‑35b à 0,30 $/M tokens en entrée, 2 $/M en sortie.

**Limites vues :** l'agent Holo ne peut pas utiliser le Mac pendant qu'un autre agent le pilote (corrigé : le pont du
téléphone se met en pause le temps de l'étape) ; le temps « à la main » de ces tâches reste à chronométrer avec un
vrai employé (on ne l'invente pas).

---

## 2. Le pitch en 6 minutes, à 3 voix

### Ouverture (Hanine, 0:00 → 0:45) — « le téléphone qui lance le pitch »
Hanine entre par les marches (ou s'assoit à côté du jury), téléphone en main, sans toucher l'ordinateur.
> « Twiin, ouvre notre présentation. »

Sur l'écran projeté, Holo ouvre le deck et le met en plein écran. **Préparation :** le deck déjà ouvert dans un onglet
(ou le fichier dans *Documents* avec un nom clair, ex. « Pitch Twiin ») ; la télécommande appairée ; répétition 2 fois.
**Plan B :** la vidéo démo démarre sur la même scène (téléphone + Mac).

> « Ce que vous venez de voir, c'est Twiin : on lui parle, il fait. Et ça marche pour le travail des PME. »

### Problème (Hanine, 0:45 → 1:30)
Dans une PME, chaque employé perd environ 3 h par semaine sur des tâches répétitives, souvent dans des logiciels
sans API. 30 à 50 % des premiers projets d'automatisation échouent : on automatise à l'aveugle. Et il n'y a pas de DSI.

### Solution et démo (Lucas, 1:30 → 3:30)
Apprend → prouve → fait. Démo live (ou extrait filmé) :
1. Depuis le téléphone : « Envoie-moi la facture Bureau Lumière » → le PDF arrive sur le téléphone.
2. « Automatise cette tâche » → workflow n8n testé ; on le montre dans *Mes automatisations*, avec les jumeaux qui
   guident à l'écran.
3. La vidéo de formation créée toute seule ; le taux BCE dans le cloud de H Company en 28 s.
4. Twiin partout : SaaS, app Mac, extension Chrome, téléphone, aux couleurs de l'entreprise (bouton BNP / Meetic).

### Business et chiffres (Jérémy, 3:30 → 5:15)
Cible, offres et prix (section 3), coût de fonctionnement mesuré, go-to-market.

### Architecture, limites et suite (Lucas, 5:15 → 5:45)
Holo (Agents API) pour les logiciels sans API, n8n pour orchestrer, modèle Hugging Face pour l'analyse, relais Vercel,
Supabase. Limites : temps humain à mesurer, tarif entreprise de H Company non public.

### Fin (Hanine, 5:45 → 6:00)
> « On a dormi deux heures. Twiin, lui, n'a pas besoin de dormir. »

Lancer la vidéo de fin : Iris et Ilo saluent (« Merci à tous… À très vite sur Twiin ! Powered by H Company… and not a
lot of sleep »).

---

## 3. Pricing — trois offres, une cible

**Cœur de cible :** TPE-PME de 10 à 250 salariés sans DSI (le dirigeant achète, le back-office utilise).
Le mobile est le canal du dirigeant ; les indépendants sont l'offre Solo ; les grands comptes viennent ensuite.

| Offre | Pour qui | Prix proposé | Inclus |
|---|---|---|---|
| **Solo** | Indépendant, profession libérale, artisan | **29 € / mois** | 1 poste, mobile, 5 automatisations, 100 exécutions Holo / mois |
| **Équipe** | PME (jusqu'à 25 postes) | **390 € / mois** | Audit des postes, enregistrements, automatisations illimitées, vidéos, espace d'équipe, marque de l'entreprise, 1 000 exécutions Holo / mois |
| **Entreprise** | Plus de 25 postes, multi-sites | **Sur devis** | Diagnostic Twiin 2 900 € (offre de Jérémy), mise en service DSI, connexions, accompagnement |

**Comparaison avec le deck de Jérémy (« Axe business », Holo 4) :** même cible et même acheteur ; il propose un
diagnostic à 2 900 €, un abonnement à 390 €/mois, 990 € de mise en place et 49 €/mois par automatisation (12 314 € la
1re année pour 3 automatisations, 70 % de marge). Notre produit faisant désormais l'analyse et la mise en place
lui-même, on garde son abonnement à 390 € comme cœur, on garde le diagnostic pour l'offre Entreprise, et on remplace
les 990 € de mise en place par du libre-service (c'est ce que la démo montre). On ajoute l'offre Solo pour le mobile.

**Coût de fonctionnement mesuré cette nuit :** 0,01 $ (tâche web dans le cloud) à 0,06 $ (tâche sur le Mac) d'agent
Holo par exécution, + 20 % au-delà du quota gratuit. Une PME qui lance 1 000 exécutions par mois coûte donc de 10 à
70 € d'agent, pour un abonnement à 390 €. La vidéo de formation coûte surtout en voix (ElevenLabs, ≈ 1 000 caractères).

---

## 4. Deck (8 à 12 slides, ordre demandé par les organisateurs)

1. **Problème** — 3 h/semaine/employé ; 30-50 % d'échecs ; pas de DSI.
2. **Solution** — Apprend · Prouve · Fait. Twiin powered by H Company.
3. **Démo** — vidéo (twiin-demo.mp4) ou live depuis le téléphone.
4. **Business model** — Solo 29 € · Équipe 390 € · Entreprise sur devis.
5. **Go-to-market** — premiers pilotes : Eugenia (contrats d'alternance, absences), PME du réseau ; le dirigeant via
   le mobile ; partenariat H Company (cas d'usage sans API).
6. **Architecture** — Mac (enregistreur, OCR local, Holo) · n8n · Hugging Face · relais Vercel · Supabase · H Agents API.
7. **Limites, améliorations, roadmap** — temps humain à mesurer ; multi-postes via le relais ; signature Apple ;
   Windows ; plus de connecteurs (Microsoft 365).
8. **Coût de run** — mesuré : 0,01 à 0,06 $ par exécution d'agent ; détail section 3.

Liens à mettre sur la dernière slide : dépôt GitHub, release v0.2.0 (installeur), lien démo + code d'accès.
