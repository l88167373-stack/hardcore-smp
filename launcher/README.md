# Launcher HARDCORE SMP

Launcher officiel du serveur **HARDCORE SMP — Saison 2** : Electron 44 + React 19 + TypeScript (strict), construit avec electron-vite.

> **État : phase 7.** Design complet, **vraie connexion Microsoft**, **vraie installation et vrai lancement du jeu**
> (Java 25, Minecraft, Fabric, HSMP Guard, connexion directe au serveur, réparation, logs et plantages),
> **catalogue Modrinth** et **quarantaine**, **config en ligne** (actus, règlement, mods autorisés), **statut du serveur
> en direct**, **Discord Rich Presence** et **mises à jour automatiques**. Plus aucune donnée factice dans l'application.

## Activer la connexion Microsoft

Le Client ID Azure se met dans [`app-config.json`](app-config.json) (valeur `TODO_AZURE_CLIENT_ID` tant qu'il manque).
Tout est expliqué pas à pas dans [`docs/INSTALL-ADMIN.md`](../docs/INSTALL-ADMIN.md).

## Lancer le launcher sur ton PC

Prérequis : [Node.js 22.12 ou plus récent](https://nodejs.org) (Node 24 conseillé).

Dans un terminal ouvert dans le dossier `launcher/` :

```bash
npm install
```

```bash
npm run dev
```

La fenêtre du launcher s'ouvre. Chaque modification du code se recharge toute seule.

### Le panneau « Démo »

En haut à droite, le bouton **Démo** permet d'afficher chaque message d'erreur de connexion Microsoft (sans compte réel),
de « Recommencer la première ouverture », et en développement de tester le lancement hors ligne.
Il n'existe pas dans l'application installée (version publiée).

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `npm run dev` | Lance le launcher en mode développement |
| `npm run dev:web` | Ouvre seulement l'interface dans le navigateur (sans Electron) |
| `npm test` | Lance les tests |
| `npm run lint` | Vérifie la qualité du code |
| `npm run typecheck` | Vérifie les types TypeScript |
| `npm run build` | Vérifie les types puis compile dans `out/` |
| `npm run screenshots` | Compile puis capture chaque écran dans `screenshots/` |
| `npm run icons` | Génère les icônes `.ico`, `.icns`, `.png` dans `build/` |
| `npm run dist` | Crée l'installateur pour ton système dans `dist/` |

### Tester l'installation et le lancement sans compte (développement)

- Dans le panneau **Démo**, « Tester le lancement hors ligne » installe le jeu puis le lance **sans compte**
  (pseudo « Testeur », sans connexion au serveur). Ce bouton n'existe pas dans l'application installée.
- `HSMP_GAME_DIR` (développement uniquement) remplace le dossier du jeu, pour tester sans toucher au vrai :
  `HSMP_GAME_DIR=C:\hsmp-test npm run dev`
- Test d'intégration (vrais téléchargements, ~700 Mo) :
  `HSMP_TEST_GAME_DIR=C:\hsmp-test npx vitest run --config vitest.integration.mts install`
  (ajoute `HSMP_TEST_LAUNCH=1` pour lancer aussi le jeu une fois).

### Tester le HSMP Guard contre un serveur Paper local (développement)

Ces réglages n'ont **aucun effet** dans l'application installée.

| Variable | Effet |
|---|---|
| `HSMP_GUARD_JAR` | Installe ce jar de HSMP Guard (compilé dans `guard-mod/`) tant que le Guard n'est pas publié |
| `HSMP_DEV_SERVER` | « Tester le lancement hors ligne » se connecte à ce serveur (ex. `localhost:25599`) |
| `HSMP_DEV_SKIP_QUARANTINE=1` | Ne met plus les mods inconnus en quarantaine (pour vérifier que le **serveur** les refuse) |

Le serveur de test doit être en `online-mode=false` (pseudo « Testeur »), avec le plugin HSMP Gatekeeper,
la clé `guard-mod/build/guard-key.txt` dans `guard.keys` et un lien pour « Testeur » dans `gatekeeper.db`.

Test automatique de bout en bout (7 scénarios) : sans Guard → refusé ; officiel → accepté ; règlement pas à jour → refusé ;
mod interdit ajouté à la main → mis en quarantaine par le launcher, le joueur entre ; le même sans quarantaine → refusé
par le serveur ; pack + shader autorisés → acceptés ; pack interdit → refusé.

```bash
HSMP_TEST_GAME_DIR=C:\hsmp-test HSMP_E2E_SERVER=localhost:25599 HSMP_E2E_SERVER_LOG=C:\hsmp-paper\logs\latest.log HSMP_GUARD_JAR=../guard-mod/build/libs/hsmp-guard-1.0.0-protege.jar HSMP_E2E_EXTRA_MOD=C:\tests\freecam.jar HSMP_E2E_EXTRA_PACK=C:\tests\Better-Leaves.zip npx vitest run --config vitest.integration.mts guard
```

Service des mods contre le vrai Modrinth (contenu de départ, recherche, shader + Iris, pack, mises à jour, quarantaine) :

```bash
HSMP_TEST_MODS_DIR=C:\hsmp-mods npx vitest run --config vitest.integration.mts mods
```

### Tester la config en ligne et les mises à jour (développement)

| Variable | Effet |
|---|---|
| `HSMP_DEV_CONFIG_URL` | Lit le dossier `config/` à cette adresse (ex. `http://127.0.0.1:8765/config/`) au lieu de `app-config.json` |
| `HSMP_DEV_UPDATE_FEED` | Cherche les mises à jour dans ce dossier (`latest.yml` + installateur). Le fichier téléchargé n'est **jamais exécuté** en développement. |

Tests contre les vrais services :

```bash
HSMP_TEST_PING=1 npx vitest run --config vitest.integration.mts server-status
```

```bash
HSMP_TEST_DISCORD=1 npx vitest run --config vitest.integration.mts discord
```

## Organisation du code

```
src/
├─ main/        Process principal : fenêtre, sécurité, protocole app://, paramètres, dossier du jeu, journal
│  ├─ auth/     Connexion Microsoft → Xbox → XSTS → Minecraft, fenêtre isolée, comptes chiffrés
│  ├─ game/     Installation (Java, Minecraft, Fabric), client Modrinth, vérification, lancement
│  └─ mods/     Catalogue, mods/packs/shaders installés (hsmp/content.json), dépendances, quarantaine
├─ preload/     Pont minimal et typé entre l'interface et le process principal (window.hsmp)
├─ shared/      Code commun : schémas des configs (zod), RAM, versions, MOTD, erreurs de connexion
└─ renderer/    Interface React
   └─ src/
      ├─ components/   Cartes, boutons, bouton JOUER, barre de progression, barre de titre…
      ├─ screens/      Accueil, Actus, Le serveur, Mods, Paramètres, Comptes, Support, onboarding
      ├─ state/        État global et notifications
      ├─ lib/          Navigation, config, actions, outils
      └─ mock/         Données factices restantes (statut serveur ; catalogue pour l'aperçu navigateur)
```

La configuration publique (`../config/*.json`) est validée au démarrage et par les tests.

## Sécurité

- `contextIsolation`, `sandbox` et `nodeIntegration: false` sur toutes les fenêtres ; bac à sable forcé pour toute l'app.
- L'interface ne voit que `window.hsmp` (quelques fonctions typées), jamais Node.js.
- Chaque demande de l'interface vérifie son origine et ses arguments.
- Interface servie par un protocole interne `app://launcher` avec une **CSP stricte** (pas de script externe ni inline).
- Aucune navigation hors de l'app, aucune nouvelle fenêtre, aucune permission web (caméra, micro…).
- Les liens ne s'ouvrent dans le navigateur que vers une liste de sites autorisés (Discord, GitHub, Modrinth, Microsoft…).
- Markdown des actus et du règlement affiché sans HTML brut et assaini.
- Binaire Electron durci (« fuses ») à l'empaquetage.
- Aucun secret dans le launcher.

## Connexion Microsoft : comment ça marche

1. Fenêtre Microsoft **isolée** (session en mémoire vidée à chaque connexion, pas de preload, pages Microsoft/Xbox uniquement).
2. OAuth 2.0 + PKCE (client public, comptes personnels, scope `XboxLive.signin offline_access`).
3. Xbox Live → XSTS → `login_with_xbox` → vérification du profil / de l'achat → pseudo, UUID, skin.
4. Jetons chiffrés avec `safeStorage` (trousseau du système) ; l'interface ne reçoit **jamais** de jeton.
5. Renouvellement automatique (au démarrage, toutes les heures si besoin, et avant chaque lancement en phase 3).
   Le nouveau jeton de rafraîchissement remplace l'ancien à chaque fois.
6. Erreurs traduites : pas de profil Xbox, compte enfant, jeu non acheté, pas de pseudo, réseau, app pas encore validée par Mojang…

Le journal `logs/launcher.log` (dossier de l'application) masque tout ce qui ressemble à un jeton.

## Installation et lancement du jeu : comment ça marche

Le launcher a son propre installateur (pas de dépendance externe), qui lit uniquement les fichiers officiels :

1. **Plan** : manifeste des versions de Mojang → fichier de version 26.2 (empreinte SHA-1 vérifiée),
   profil Fabric (`meta.fabricmc.net`), index des assets, Java officiel de Mojang (`java-runtime-epsilon`, Java 25),
   les mods, packs et shaders choisis dans l'onglet Mods (voir plus bas), HSMP Guard (quand il sera publié).
   Les versions viennent de `config/launcher.json`, jamais du code.
2. **Vérification** : rapide (tailles) avant chaque lancement, complète (empreintes SHA-1/SHA-512) avec
   « Vérifier et réparer les fichiers ». Seuls les fichiers manquants ou abîmés sont retéléchargés.
3. **Téléchargement** : 12 fichiers en parallèle, fichier temporaire puis renommage, 3 essais, empreinte contrôlée.
4. **Quarantaine** (avant chaque lancement) : voir « Mods, packs et shaders » plus bas.
5. **Marqueur pour HSMP Guard** : `hsmp/launch.json` (version du launcher, version du règlement acceptée, jeton) +
   `-Dhsmp.launchToken=…` sur la ligne de commande.
6. **Lancement** : Java du launcher (jamais celui du PC), RAM des paramètres, connexion directe
   `--quickPlayMultiplayer hardcore-smp.mine.fun:25565`. Les arguments JVM du joueur sont filtrés
   (`-javaagent`, `-cp`, `-Xmx`… refusés : ils permettraient d'injecter du code ou doublonneraient la RAM).
7. **Hors ligne** : si Internet est coupé mais le jeu déjà installé, la dernière installation connue est utilisée.

Dossier du jeu : `%APPDATA%\.hardcore-smp` (Windows), `~/Library/Application Support/hardcore-smp` (macOS),
`~/.hardcore-smp` (Linux). Le `.minecraft` habituel n'est jamais touché.

## Polices et images

Les polices (Geist et Geist Mono) sont **embarquées** : rien n'est chargé depuis Internet.
Le logo officiel est lu dans `../assets/logo.png` s'il existe ; sinon un logo typographique s'affiche.
L'icône vient de `../assets/icon-1024.png` (ou d'une icône provisoire) via `npm run icons`.

## Mods, packs et shaders : comment ça marche

- **Catalogue** : API Modrinth v2, filtrée sur la version du serveur (`versions:26.2`, + `fabric` pour les mods,
  + `iris` pour les shaders). Onglets Recommandés, Installés, Mods, Packs de ressources, Shaders ; tri pertinence ou
  téléchargements ; case « Autorisés sur le serveur uniquement » ; fiche projet avec description et galerie.
  User-Agent qui identifie le launcher ; 4 requêtes à la fois au plus, pause automatique quand la limite de Modrinth
  (300 requêtes / minute) approche, nouvel essai après une réponse 429 ; résultats gardés 5 minutes.
- **Autorisations** : les badges suivent exactement la règle du plugin (`config/allowlist.json`, par type de contenu).
  Un projet non autorisé reste visible avec « Non autorisé sur le serveur » et « Proposer ce mod ».
- **Installation** : dernière version compatible + toutes ses dépendances obligatoires (acceptées par le serveur comme
  dépendances d'un projet autorisé), fichiers téléchargés uniquement depuis `cdn.modrinth.com`, SHA-512 vérifiée.
  Un shader installe aussi **Iris** (nécessaire). Projets déclarés incompatibles : installation refusée.
- **Désactiver** range le fichier dans `hsmp/disabled/` (hors du jeu) ; **désinstaller** retire aussi les dépendances
  devenues inutiles. Fabric API et HSMP Guard ne peuvent être ni retirés ni désactivés ; une dépendance suit le mod qui en a besoin.
- **Mises à jour** : une seule requête par type de contenu (`POST /version_files/update`), puis « Mettre à jour » ou
  « Tout mettre à jour ».
- **Registre** : `hsmp/content.json` (ce que le joueur a choisi). À la première installation : obligatoires + recommandés.
  Si un projet est retiré de l'allowlist, il quitte le registre ; si Minecraft change de version (ex. 26.3),
  chaque projet passe à sa version compatible.
- **Quarantaine avant chaque lancement** : tout fichier de `mods/`, `resourcepacks/` ou `shaderpacks/` qui n'est pas
  exactement (nom + SHA-512) ce que le launcher a installé est identifié sur Modrinth :
  - projet autorisé et compatible ajouté à la main → **gardé** et ajouté à l'onglet Mods (avec ses dépendances) ;
  - sinon → déplacé dans `quarantaine/<date>/` avec `POURQUOI.txt` (une raison par fichier : non autorisé,
    inconnu de Modrinth, autre version de Minecraft, fichier modifié, dossier, Modrinth injoignable).
  Le joueur voit la raison sur l'accueil et dans l'onglet Mods → Installés. Rien n'est supprimé.

## Config en ligne, statut du serveur, Rich Presence, mises à jour : comment ça marche

- **Config publique** (`src/main/public-config.ts`) : les 4 fichiers de `config/` sont lus en ligne au démarrage puis toutes
  les 10 minutes (adresse dans `app-config.json`). Ils sont validés **ensemble** (schémas zod + `rulesVersion` = version du
  règlement) : un ensemble invalide est ignoré. Dernière copie valide gardée dans le dossier de l'application (mode hors ligne),
  sinon copie embarquée. L'interface est prévenue à chaque changement (actus, règlement, mods autorisés, version minimale).
- **Statut du serveur** (`src/main/server-status.ts`) : « Server List Ping » implémenté sans dépendance (poignée de main,
  statut JSON, ping/pong), toutes les 30 secondes, délai de 5 secondes, réponse limitée à 512 Ko. Suit l'enregistrement SRV
  `_minecraft._tcp` comme le jeu. MOTD au format JSON ou « § » converti en couleurs ; icône du serveur acceptée seulement en PNG.
- **Rich Presence** (`src/main/rich-presence.ts`, `@xhayper/discord-rpc`) : « Dans le launcher » / « En jeu sur HARDCORE SMP —
  Saison 2 », temps écoulé, logo, boutons. Activable dans Paramètres. Discord fermé : nouvel essai toutes les minutes, sans erreur.
- **Mises à jour** (`src/main/updates.ts`, `electron-updater`) : GitHub Releases (dépôt dans `app-config.json`), au démarrage
  puis toutes les 4 heures, téléchargement en arrière-plan avec empreinte SHA-512 vérifiée, installation au redémarrage ou sur
  demande. Si `minLauncherVersion` (config en ligne) est supérieure à la version installée, le jeu est bloqué jusqu'à la mise à jour.
