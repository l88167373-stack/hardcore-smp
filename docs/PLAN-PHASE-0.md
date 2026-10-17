# HARDCORE SMP — Phase 0 : vérifications et plan

> Vérifié en direct le **16/10/2026** (API Mojang, PaperMC, Fabric Meta, Modrinth, npm, Maven).
> Rien n'est codé tant que tu n'as pas validé ce document.

---

## 1. En bref

- **Tout le projet est faisable sur 26.2** : Paper, Fabric, Java 25 et les principaux mods sont disponibles et stables.
- **Attention : Minecraft 26.3 est sorti le 15/09/2026.** Paper 26.2 reste maintenu (build stable du 14/10/2026). On reste sur 26.2 comme tu l'as demandé ; comme la version vient de `launcher.json`, passer en 26.3 plus tard = changer une ligne et publier les bons mods.
- **Paper 26.2 permet de tout vérifier AVANT que le joueur entre dans le monde** (phase de configuration). C'est la meilleure option, pas besoin du plan B « joueur figé ».
- **Le point le plus long ne dépend pas de moi** : la validation de ton application Microsoft par Mojang. **Lance-la dès maintenant** (section 8.A) : tant qu'elle n'est pas acceptée, personne ne peut se connecter avec le launcher.

---

## 2. Versions vérifiées

| Élément | Version retenue | Remarque |
|---|---|---|
| Minecraft Java | **26.2** (sortie 16/06/2026) | 26.3 sortie le 15/09 ; 26.4 en snapshots |
| Java | **25** (runtime officiel Mojang `java-runtime-epsilon`, 25.0.1) | Dispo Windows x64/ARM, macOS Intel/Apple Silicon, Linux x64. Pas de 32 bits. |
| Paper | **26.2 build 134** (canal STABLE, 14/10/2026) | Java 25 minimum. API Maven : `io.papermc.paper:paper-api:26.2.build.134-stable` |
| Fabric Loader | **0.19.5** (stable) | 0.20.0 encore en test |
| Fabric API | **0.161.0+26.2** | |
| Fabric Loom | **1.19.1**, plugin `net.fabricmc.fabric-loom` | Jeu non obfusqué depuis 26.1 : plus de mappings Yarn ni d'« intermediary », on code directement avec les noms officiels Mojang. Le profil Fabric 26.2 ne contient plus d'intermediary (vérifié). |
| Gradle | **9.8.1** + `foojay-resolver-convention` 1.0.0 | Gradle télécharge lui-même le JDK 25 : rien à installer pour toi. |
| Shadow (fat jar) | `com.gradleup.shadow` **9.6.1** | |
| JDA (bot Discord) | **6.7.0** (20/09/2026) | Relocalisé dans le jar du plugin |
| SQLite | `sqlite-jdbc` **3.53.4.0** | |
| MockBukkit | `mockbukkit-v26.2` **4.117.0** | ✅ compatible Paper 26.2 → tests du plugin possibles |
| ProGuard | **7.10.0** | Java 25 supporté depuis 7.8 |
| run-paper | **3.1.0** | Lance un serveur Paper de test en une commande |
| Electron | **44.8.0** (Node 24.22, Chromium 152) | Version stable actuelle, supportée jusqu'au 02/03/2027 |
| electron-vite / Vite / React | **6.0.0** / **8.3** / **19.3** | |
| electron-builder / electron-updater | **26.15.3** / **6.8.9** | |
| TypeScript | **6.0.3** (et pas 7.0) | TS 7.0.2 (nouveau compilateur natif) vient de sortir, mais `typescript-eslint` n'accepte que TS < 6.1. On passera en 7 quand l'outillage suivra. |
| zod / vitest | **4.6.7** / **5.0.5** | |
| Discord Rich Presence | `@xhayper/discord-rpc` **1.5.1** (24/09/2026) | Maintenu |
| GrimAC (anti-cheat serveur) | **2.3.74** (15/10/2026) | ✅ compatible Paper 26.2 |

Outils déjà présents sur ton PC : Node 24.16 ✅, npm 11 ✅, Git 2.54 ✅. Tu as Java 17 et 21 mais pas 25 : pas grave, Gradle le téléchargera pour compiler, et le launcher télécharge le sien pour les joueurs.

---

## 3. Choix des librairies (justifiés)

### 3.1 Installation et lancement de Minecraft : `@xmcl/core` + `@xmcl/installer` ✅

| Critère | `@xmcl/core` + `@xmcl/installer` | `minecraft-java-core` |
|---|---|---|
| Maintenance | Code maintenant dans le dépôt du launcher XMCL (l'ancien dépôt a été archivé le 06/05/2026). Dernière publication 03/10/2026. | luuxis (launcher Selvania), 4.2.9 du 23/08/2026 |
| 26.x / Java 25 | Utilisé par X Minecraft Launcher, un vrai launcher grand public : 26.x testé en conditions réelles. Java via le manifeste officiel Mojang (+ Zulu en secours). | Java via manifeste Mojang + Zulu |
| Fabric | Workflow dédié basé sur Fabric Meta | Oui |
| Contrôle | Fonctions séparées : installer, **diagnostiquer/réparer** (`resolveVersionRepairManifest`), lancer. On garde la main pour la vérification des fichiers et la quarantaine avant chaque lancement. | Une seule classe `Launch` qui télécharge et lance d'un bloc : difficile d'insérer nos contrôles anti-triche avant le lancement. |
| Connexion directe | Option `quickPlayMultiplayer` intégrée (vérifié dans le code) | À ajouter à la main |
| Défaut constaté | Un sous-paquet (`@xmcl/unzip`) est publié avec une dépendance cassée. **Contourné par un `overrides` npm, testé : l'installation passe.** | — |

→ **Choix : `@xmcl`**, pour le contrôle fin (réparation + quarantaine) et parce qu'il fait tourner un launcher utilisé par beaucoup de joueurs.

> **Mise à jour (phase 3) : choix révisé → installateur maison.** En l'étudiant en détail, `@xmcl/installer` 6.x
> s'est révélé être un système interne de « plans d'installation » propre au launcher XMCL, peu documenté, avec
> un paquet publié cassé. Nos besoins sont étroits (une version vanilla 26.x + Fabric + le Java de Mojang) et
> toutes les données officielles fournissent tailles et empreintes : l'installateur maison (~700 lignes, testé,
> sans dépendance) est plus sûr et plus simple à maintenir. Il a été validé par une installation réelle
> (726 Mo) et un démarrage complet du jeu.

### 3.2 Connexion Microsoft : implémentation maison (pas `msmc`)
`msmc` n'a plus été publié depuis mars 2024 : je ne m'appuie pas dessus. J'écris la chaîne moi-même (≈ 300 lignes, testées avec des réponses simulées) : OAuth2 + PKCE → Xbox Live → XSTS → `login_with_xbox` → vérification de l'achat → profil. Avantage : chaque erreur est traduite en français exactement comme on veut.

### 3.3 Statut du serveur : implémentation maison du Server List Ping
`minecraft-server-util` n'est plus maintenu (2023) et `@xmcl/client` est publié avec des dépendances cassées. Le protocole est simple (≈ 150 lignes) : je l'écris et je le teste.

### 3.4 Le reste
- **Interface** : React 19 + Vite 8 via electron-vite 6, polices embarquées (`@fontsource-variable/inter`, `@fontsource-variable/geist-mono`), icônes `lucide-react`.
- **Actus en Markdown** : `react-markdown` (n'exécute pas le HTML brut) + `rehype-sanitize`.
- **Validation des configs** : `zod` côté launcher, validation Java côté plugin, et une GitHub Action qui valide les JSON (mêmes schémas JSON Schema générés depuis zod).
- **Plugin** : Paper API 26.2, Gradle Kotlin DSL, JDA relocalisé (le bot du pont chat déjà installé utilise peut-être aussi JDA : la relocalisation évite tout conflit), SQLite.

---

## 4. Décisions d'architecture à valider

### 4.1 Vérification à la connexion (API Paper confirmée dans la doc 26.2)
1. **Phase de login** — événement `PlayerConnectionValidateLoginEvent` : bypass staff ? → whitelisté et lié à un membre du Discord ? Sinon refus immédiat avec le message.
2. **Phase de configuration** — événement `AsyncPlayerConnectionConfigureEvent` (asynchrone, le joueur attend sur l'écran de chargement, **avant** d'entrer dans le monde) :
   - si le client n'a pas déclaré le canal `hsmp:guard` → refus immédiat (« utilise le launcher officiel »), sans attendre 5 s ;
   - sinon envoi du défi (nonce aléatoire de 32 octets) avec `connection.sendPluginMessage(...)` ;
   - réponse reçue par `PluginMessageListener.onPluginMessageReceived(canal, PlayerConnection, données)` (Paper la livre aussi pendant la configuration) ;
   - vérifications 3 à 6 (signature + nonce, version du Guard, règlement, mods/packs/shaders) → `connection.disconnect(message)` en cas d'échec.
3. **Côté mod** : Fabric API `ClientConfigurationNetworking` répond pendant la phase de configuration.

Aucun impact sur tes plugins existants : on ne touche ni au chat, ni au scoreboard, ni aux joueurs déjà dans le monde.

### 4.2 Clé de signature HMAC — ma proposition (différente de « une clé par build »)
Une clé différente **à chaque build** obligerait à mettre à jour le serveur à chaque compilation, même pour un commit de documentation. Je propose :
- la clé est un **secret GitHub Actions** (`HSMP_GUARD_KEY`) injecté dans le Guard au moment du build de release (en local : un `.env` ignoré par git) ;
- tu colles la même clé dans le `config.yml` du plugin ;
- le plugin accepte **plusieurs clés** (l'actuelle + la précédente) ;
- **rotation à chaque nouvelle version du Guard** : nouvelle clé → nouvelle release → tu ajoutes la clé dans `config.yml` → tu montes `minGuardVersion`. Une clé volée devient inutile à la release suivante.

### 4.3 Distribution du Guard et de Fabric
`launcher.json` contient la version de Fabric Loader et l'adresse + le SHA-512 du jar HSMP Guard (publié sur GitHub Releases). Le launcher télécharge, vérifie le hash, installe. Rien n'est codé en dur.

### 4.4 Mods inclus dans d'autres mods (« Jar-in-Jar »)
Beaucoup de mods embarquent des sous-mods (Fabric API en contient des dizaines). Le Guard envoie le hash du **jar principal** ; les sous-mods sont rattachés à leur parent et acceptés si le parent l'est. Les mods « intégrés » (`minecraft`, `java`, `fabricloader`) sont ignorés.

### 4.5 Packs de ressources et shaders
- Packs : le Guard lit les packs **actifs** dans le jeu et hashe les `.zip` de `resourcepacks/`. Le pack imposé par le serveur et les packs intégrés (vanilla, mods) sont ignorés. Les packs en dossier (non zippés) sont refusés : impossible de les identifier sur Modrinth.
- Shaders : le Guard lit `config/iris.properties` (shader actif) et hashe le fichier dans `shaderpacks/`.
- Grâce au hash, seule la version **officielle non modifiée** d'un shader/pack est acceptée (un shader modifié en X-ray a un autre hash → refusé).

### 4.6 Si le bot Discord est déconnecté
La whitelist reste basée sur la base SQLite (liens Discord ↔ UUID), mise à jour par les événements Discord + la réconciliation périodique. Si le bot est hors ligne au moment d'une connexion, on se fie à la base (option `discord-offline-policy: allow` / `deny` dans `config.yml`, `allow` par défaut pour ne pas bloquer tout le serveur à cause d'une panne Discord).

### 4.7 Dépôt GitHub public
Obligatoire pour l'hébergement gratuit : le launcher lit `config/` en ligne sans clé, et `electron-updater` lit les releases publiques. Aucun secret dans le dépôt (token du bot et clé HMAC restent hors du code).

### 4.8 Mises à jour automatiques : limites honnêtes
- **Windows** : mise à jour auto OK (même sans certificat). Avertissement SmartScreen au premier lancement.
- **Linux AppImage** : mise à jour auto OK. Le `.deb` sera mis à jour via un bouton « Télécharger ».
- **macOS** : sans compte Apple Developer (99 $/an), **macOS refuse les mises à jour automatiques d'une app non signée**. Le launcher affichera « Nouvelle version disponible → Télécharger » qui ouvre la page de release. Tout le reste marche.

---

## 5. Arborescence prévue

```
hardcore-smp/
├─ launcher/
│  ├─ electron-builder.yml
│  ├─ src/main/          process principal : auth, install, lancement, quarantaine, RPC, updater, ping
│  ├─ src/preload/       pont minimal et typé (contextBridge)
│  ├─ src/renderer/      React : écrans, composants, thème
│  ├─ src/shared/        types + schémas zod partagés
│  ├─ resources/         icônes, polices
│  └─ tests/
├─ guard-mod/
│  ├─ build.gradle.kts   Loom 1.19 + ProGuard
│  └─ src/main/java/fun/hardcoresmp/guard/
├─ server-plugin/
│  ├─ build.gradle.kts   Paper API 26.2 + Shadow + run-paper
│  └─ src/main/java/fun/hardcoresmp/gatekeeper/
│     ├─ check/          vérifications à la connexion
│     ├─ discord/        bot JDA, whitelist, réconciliation
│     ├─ modrinth/       identification des hashs + cache
│     └─ storage/        SQLite
├─ config/
│  ├─ launcher.json  news.json  rules.json  allowlist.json
│  └─ schemas/           JSON Schema (validés par la CI)
├─ assets/               logo.png, icon-1024.png (fournis par toi)
├─ reference/            video-style-*.png (fournis par toi)
├─ docs/                 INSTALL-ADMIN.md, GUIDE-JOUEUR.md, PLAN-PHASE-0.md
├─ scripts/              génération des icônes, rotation de clé…
└─ .github/workflows/    ci.yml, release.yml, validate-config.yml
```

Package Java proposé : `fun.hardcoresmp` (tiré de ton domaine `mine.fun`) — dis-moi si tu préfères autre chose.

### Brouillon de `config/launcher.json`
```json
{
  "minecraftVersion": "26.2",
  "fabricLoaderVersion": "0.19.5",
  "minLauncherVersion": "1.0.0",
  "minGuardVersion": "1.0.0",
  "rulesVersion": 1,
  "server": { "host": "hardcore-smp.mine.fun", "port": 25565 },
  "guard": { "version": "1.0.0", "url": "TODO_GITHUB_RELEASE_URL", "sha512": "TODO" },
  "requiredMods": ["P7dR8mSH"],
  "discordInvite": "TODO_DISCORD_INVITE",
  "links": { "download": "TODO", "suggestions": "TODO", "website": "TODO" }
}
```

---

## 6. Proposition d'allowlist (à valider par toi)

Toutes les entrées ci-dessous **existent en 26.2 sur Modrinth** (vérifié aujourd'hui).

### ✅ Sûrs — performance et confort (je propose de les autoriser)
| Mod | Rôle | Recommandé par défaut |
|---|---|---|
| Fabric API | obligatoire | 🔒 obligatoire |
| Sodium | gros gain de FPS | ⭐ |
| Lithium | optimisation logique du jeu | ⭐ |
| FerriteCore | moins de RAM | ⭐ |
| EntityCulling | n'affiche pas ce qui est caché | ⭐ |
| ImmediatelyFast | rendu plus rapide | ⭐ |
| Mod Menu | liste des mods | ⭐ |
| Iris | shaders | |
| More Culling, Cull Leaves | optimisations visuelles | |
| Dynamic FPS | baisse les FPS quand le jeu est en arrière-plan | |
| Krypton | optimisation réseau | |
| Sodium Extra, Reese's Sodium Options | réglages vidéo | |
| Continuity | textures connectées | |
| Mouse Tweaks | confort d'inventaire | |
| Controlling | recherche de touches | |
| Entity Texture Features + Entity Model Features | cosmétique (requis par Fresh Animations) | |
| Cloth Config, YACL, Fabric Language Kotlin | bibliothèques (dépendances) | |

Packs de ressources sûrs : Faithful 32x, Fresh Animations.
Shaders sûrs : Complementary Reimagined, Complementary Unbound, BSL, MakeUp Ultra Fast, Solas, Photon.

### ⚠️ À trancher toi-même (donnent un avantage plus ou moins grand)
| Mod | Risque | Mon avis |
|---|---|---|
| Xaero's Minimap | radar des joueurs/mobs + mode grotte | Autoriser **seulement** si on force le « mode fair-play » de Xaero (code envoyé par le serveur ; à vérifier en phase 6). La version « Fair-Play » séparée n'existe plus après 1.21. |
| Xaero's World Map | carte + mode grotte | Même remarque |
| JourneyMap, VoxelMap | radar + cartographie des grottes | Plutôt **refuser** |
| Zoomify, Ok Zoomer | zoom = repérage à distance | À toi de voir (avantage modéré) |
| AppleSkin | affiche faim/saturation | Plutôt autoriser (très courant) |
| LambDynamicLights | torche en main éclaire | Plutôt autoriser (aide un peu dans les grottes) |
| Jade / WTHIT | infos sur le bloc/mob visé | Plutôt autoriser |
| BetterF3 | réorganise l'écran F3 | Autoriser (n'ajoute pas d'info) |
| Inventory Profiles Next | tri et recharge auto | Avantage léger |
| ItemSwapper | changement d'objet rapide | Avantage léger |
| Litematica | schémas de construction (mode « easy place ») | À toi de voir |
| MiniHUD | niveaux de lumière, zones de structures | Avantage modéré |

### ❌ À refuser
Freecam (voir à travers les murs), Tweakeroo (contient une freecam et des automatisations), tout mod de type X-ray, « printer », auto-clicker, etc. — ils ne seront simplement pas dans l'allowlist.

---

## 7. Plan des phases

| Phase | Contenu | Ce que tu pourras tester toi-même |
|---|---|---|
| 1 | Squelette du launcher, design complet, tous les écrans (données factices) | Lancer le launcher et valider le look |
| 2 | Connexion Microsoft complète (multi-comptes, refresh, erreurs) | Te connecter (si l'app Azure est validée) |
| 3 | Installation Java 25 / 26.2 / Fabric, lancement direct sur le serveur, RAM, logs, réparation | Jouer en solo/serveur depuis le launcher |
| 4 | Plugin Paper : bot Discord, whitelist auto, réconciliation | Écrire ton pseudo dans #whitelist |
| 5 | HSMP Guard + vérification à la connexion | Être accepté avec le launcher, refusé sans |
| 6 | Catalogue Modrinth, allowlist, quarantaine | Installer/retirer des mods |
| 7 | Actus, statut serveur, Rich Presence, mises à jour auto | Voir le statut et ta présence Discord |
| 8 | CI, builds 3 OS, docs, checklist de bout en bout | Publier une release |

---

## 8. Ce que tu dois créer toi-même

### A. Application Microsoft (à faire **maintenant**, c'est le plus long)
1. Va sur <https://portal.azure.com> et connecte-toi avec ton compte Microsoft.
2. Dans la barre de recherche en haut, tape **« Inscriptions d'applications »** (en anglais : *App registrations*) et ouvre-la.
   - Si un message dit que tu ne peux pas créer d'application « en dehors d'un annuaire », crée d'abord un compte Azure gratuit sur <https://azure.microsoft.com/free>. Microsoft demande une carte bancaire et un téléphone **pour vérifier ton identité** ; l'inscription d'application est gratuite. Dis-moi si tu bloques ici.
3. Clique **« + Nouvelle inscription »**.
4. **Nom** : `HARDCORE SMP Launcher`.
5. **Types de comptes pris en charge** : choisis **« Comptes Microsoft personnels uniquement »**.
6. **URI de redirection** : dans la liste, choisis **« Client public/natif (mobile et bureau) »** et colle :
   `https://login.microsoftonline.com/common/oauth2/nativeclient`
7. Clique **« Inscrire »**.
8. Sur la page qui s'ouvre, copie **« ID d'application (client) »** (format `xxxxxxxx-xxxx-…`). **C'est le Client ID à me donner** — ce n'est pas un secret.
9. Menu de gauche → **« Authentification »** → tout en bas, **« Autoriser les flux de clients publics »** → **Oui** → **Enregistrer**.
10. Ne crée **pas** de « secret client » : le launcher n'en a pas besoin.

**Ensuite, demande l'accès à l'API Minecraft** : ouvre <https://aka.ms/mce-reviewappid> (c'est un formulaire Microsoft Forms officiel, j'ai vérifié le lien). Remplis-le avec ton Client ID, le nom `HARDCORE SMP Launcher`, et une description du genre : *« Launcher privé et gratuit pour notre serveur Minecraft Java HARDCORE SMP. Il utilise la connexion Microsoft officielle pour lancer le jeu avec le compte du joueur. »* Si un champ te pose question, envoie-moi une capture. La réponse arrive par e-mail ; le délai n'est pas garanti (souvent plusieurs jours). Pendant ce temps je code avec des réponses simulées.

### B. Bot Discord (nécessaire en phase 4, tu peux le préparer quand tu veux)
1. Va sur <https://discord.com/developers/applications> → **New Application** → nom : `HSMP Gatekeeper` (un bot **différent** de celui du pont chat).
2. Onglet **Bot** → **Reset Token** → copie le token. ⚠️ **Ne me l'envoie pas et ne le publie nulle part** : tu le colleras toi-même dans `config.yml` en phase 4.
3. Toujours dans **Bot**, section *Privileged Gateway Intents* : active **Server Members Intent** et **Message Content Intent** → **Save Changes**.
4. Onglet **OAuth2 → URL Generator** : coche les scopes `bot` et `applications.commands`, puis les permissions : *View Channels, Send Messages, Embed Links, Add Reactions, Read Message History, Manage Messages, Manage Roles*. Ouvre l'URL générée et ajoute le bot à ton serveur.
5. Crée les salons `#whitelist`, `#logs-anticheat` (visible staff seulement), `#suggestions-mods`, `#annonces` et le rôle **« Whitelisté »** (s'ils n'existent pas déjà).
6. Dans *Paramètres du serveur → Rôles*, place le rôle du bot **au-dessus** de « Whitelisté » (sinon il ne peut pas le donner).
7. Active le mode développeur : *Paramètres utilisateur → Avancés → Mode développeur*. Ensuite, clic droit sur le serveur / un salon / un rôle → **Copier l'identifiant**. Ce sont ces identifiants qu'il me faudra.

### C. GitHub (nécessaire pour publier ; utile dès la phase 1 pour les URL de config)
1. Crée un compte sur <https://github.com> si tu n'en as pas.
2. Bouton **+ → New repository** → nom proposé : `hardcore-smp` → **Public** → ne coche rien d'autre → **Create repository**.
3. Donne-moi ton nom d'utilisateur et le nom du dépôt. Je t'expliquerai l'envoi du code (avec GitHub Desktop, le plus simple) quand on y sera.
4. (Phase 5) On ajoutera le secret `HSMP_GUARD_KEY` dans *Settings → Secrets and variables → Actions* : je te guiderai.

### D. Fichiers graphiques
Le prompt cite `assets/logo.png`, `assets/icon-1024.png` et `reference/video-style-*.png`, mais **ils ne sont pas dans le dossier** de travail actuel. Mets-les dans le dossier du projet (voir la question sur l'emplacement du projet).

---

## 9. Infos dont j'ai besoin (je mets des `TODO_…` en attendant)

| Info | Quand | Remarque |
|---|---|---|
| Client ID Azure | phase 2 | Pas secret |
| ID du serveur Discord, IDs des salons `#whitelist`, `#logs-anticheat`, `#suggestions-mods`, `#annonces`, ID du rôle « Whitelisté » | phase 4 | Clic droit → Copier l'identifiant |
| Token du bot | — | Tu le mets toi-même dans `config.yml` |
| Lien d'invitation Discord | phase 1 | Lien permanent (« n'expire jamais ») |
| Compte GitHub + nom du dépôt | phase 1 | Pour les URL de config |
| Port du serveur | phase 1 | Si ce n'est pas 25565 |
| Ta liste de mods autorisés | phase 6 | À partir de la section 6 |
| Validation du règlement | phase 6 | Je rédige un premier jet |
| Ton hébergeur | phase 4 | Pour vérifier que le serveur peut se connecter à Discord, Modrinth et GitHub (presque toujours oui) |

---

## 10. Limites à connaître dès maintenant

- **Un tricheur très motivé peut modifier le Guard** (le code client est toujours entre ses mains). Le système bloque les clients non officiels, les mods non autorisés et la grande majorité des tricheurs, mais il faut aussi **GrimAC** côté serveur (compatible 26.2) contre les cheats de mouvement/combat.
- Le marqueur « lancé par le launcher officiel » est une barrière pour les joueurs normaux, pas une preuve cryptographique (le launcher est public et ne contient aucun secret).
- La connexion Microsoft dépend de la validation de Mojang (section 8.A).
- macOS : pas de mise à jour auto sans compte Apple payant ; Windows : avertissement SmartScreen sans certificat.

---

## Sources
- Versions Minecraft : <https://piston-meta.mojang.com/mc/game/version_manifest_v2.json>
- Paper : <https://fill.papermc.io/v3/projects/paper>
- Événement de configuration : <https://jd.papermc.io/paper/26.2/io/papermc/paper/event/connection/configuration/AsyncPlayerConnectionConfigureEvent.html>
- Connexion en configuration : <https://jd.papermc.io/paper/26.2/io/papermc/paper/connection/PlayerConfigurationConnection.html>
- Messages de plugin en configuration : <https://jd.papermc.io/paper/26.2/org/bukkit/plugin/messaging/PluginMessageListener.html>
- Validation au login : <https://jd.papermc.io/paper/26.2/io/papermc/paper/event/connection/PlayerConnectionValidateLoginEvent.html>
- Fabric Meta : <https://meta.fabricmc.net/v2/versions/loader/26.2>
- Loom (IDs de plugin pour 26.x) : <https://docs.fabricmc.net/develop/loom/options>
- Mappings 26.x : <https://docs.fabricmc.net/develop/porting/mappings/>
- Chaîne d'authentification Microsoft : <https://minecraft.wiki/w/Microsoft_authentication>
- Comptes personnels et annuaire Azure : <https://learn.microsoft.com/en-us/answers/questions/2127352/how-to-move-an-azure-application-created-under-a-p>
- ProGuard et Java 25 : <https://www.guardsquare.com/manual/releasenotes>
- Modrinth API : <https://api.modrinth.com/v2> (test réel de `POST /v2/version_files` en sha512 ✅)
- Electron : <https://releases.electronjs.org/releases.json>
