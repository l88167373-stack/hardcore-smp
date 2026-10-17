# HSMP Guard (mod client Fabric)

Petit mod client (Fabric, Minecraft 26.2, Java 25) installé **automatiquement** par le launcher officiel.
Il ne change rien au jeu : il répond seulement à la question que pose le serveur à la connexion,
« quels mods, packs de ressources et shaders sont chargés ? », avec une réponse **signée**.

## Ce qui se passe à la connexion

```
Serveur (HSMP Gatekeeper)                         Client (HSMP Guard)
  │ phase de configuration                          │
  │ ── défi : [protocole][nonce aléatoire][heure] ─▶│
  │                                                 │ liste les fichiers, calcule leurs SHA-512,
  │                                                 │ signe le tout (HMAC-SHA256), compresse
  │ ◀── réponse signée ─────────────────────────────│
  │ vérifie : signature, nonce, délai, versions,
  │ jeton du launcher, règlement, chaque mod (Modrinth)
  │ → entre dans le monde, ou déconnexion avec un message clair en français
```

- Canal réseau : `hsmp:guard`, pendant la **phase de configuration** (avant l'entrée dans le monde).
- Le nonce change à chaque connexion : une ancienne réponse ne peut pas être rejouée.
- Le serveur laisse 5 secondes pour répondre (`guard.timeout-seconds`). Sans réponse : « utilise le launcher officiel ».

## Ce que le Guard envoie (et rien d'autre)

| Donnée | Pourquoi |
|---|---|
| Version du Guard, du launcher, version du règlement acceptée | Refuser les versions trop anciennes et les règlements pas à jour |
| Jeton de lancement (créé par le launcher à chaque lancement) | Prouver que le jeu a été lancé par le launcher officiel |
| Mods chargés : identifiant, version, nom du fichier, SHA-512 | Identifier chaque mod sur Modrinth et le comparer à l'allowlist |
| Mods imbriqués (dans un autre jar) et mods chargés hors du dossier `mods` | Repérer les mods cachés |
| Packs de ressources activés : nom + SHA-512 (un dossier n'a pas d'empreinte) | Comparer à l'allowlist |
| Shader choisi (Iris) : nom + SHA-512 | Comparer à l'allowlist |

**Rien d'autre n'est collecté** : pas de liste des programmes ouverts, pas de fichiers en dehors du dossier du jeu,
pas d'adresse, pas d'identifiant du PC.

## Lancé sans le launcher officiel ?

Si le joueur installe le Guard à la main dans un autre launcher, le fichier `hsmp/launch.json` et le jeton
passé par le launcher (`-Dhsmp.launchToken`) manquent :

- sur l'écran titre, une fenêtre propose « **Télécharger le launcher** » ;
- s'il tente quand même de se connecter, le serveur refuse : « utilise le launcher officiel HARDCORE SMP ».

## Compiler

Prérequis : rien (le « wrapper » Gradle télécharge Gradle, le JDK 25 et Minecraft tout seul).

```bash
./gradlew build
```

Résultat dans `build/libs/` :

| Fichier | Usage |
|---|---|
| `hsmp-guard-<version>-protege.jar` | **Celui qu'on publie** (code obscurci avec ProGuard) |
| `hsmp-guard-<version>.jar` | Version lisible, pour le débogage |
| `build/guard-key.txt` | La clé de signature de CE build (à copier dans `guard.keys` du plugin) |

### La clé de signature

- **Build de release** : la clé vient de la variable d'environnement `HSMP_GUARD_KEY` (base64, 32 octets ou plus),
  stockée comme **secret GitHub** (jamais dans le dépôt). Elle change à chaque nouvelle version du Guard.
- **Build local** sans `HSMP_GUARD_KEY` : une **nouvelle clé aléatoire** est créée à chaque build et écrite
  dans `build/guard-key.txt` (dossier ignoré par git).
- Dans le jar, la clé n'apparaît pas en clair (deux tableaux combinés au dernier moment, code obscurci).

> **Limite honnête** : un tricheur très motivé peut toujours désassembler un mod client. L'obscurcissement,
> la clé qui change à chaque version, le jeton du launcher et le contrôle des empreintes côté serveur rendent
> la triche **beaucoup plus coûteuse**, sans la rendre impossible. Le staff reste le dernier rempart.

La procédure complète (création de la clé, rotation, publication) est dans
[`docs/INSTALL-ADMIN.md`](../docs/INSTALL-ADMIN.md#4-hsmp-guard--clé-de-signature-et-mises-à-jour).

## Tester avec le launcher en développement

Tant que le Guard n'est pas publié sur GitHub, le launcher de développement peut utiliser le jar compilé :

```bash
HSMP_GUARD_JAR=../guard-mod/build/libs/hsmp-guard-1.0.0-protege.jar npm run dev
```

Le test de bout en bout contre un vrai serveur Paper local est décrit dans
[`launcher/tests/integration/guard.integration.ts`](../launcher/tests/integration/guard.integration.ts).

## Organisation

```
src/main/java/fun/hardcoresmp/guard/
├─ GuardClient.java     point d'entrée : canal hsmp:guard, réponse au défi, fenêtre « launcher officiel »
├─ GuardPayloads.java   format des messages (défi et réponse)
├─ GuardResponse.java   construction de la réponse signée (JSON → HMAC-SHA256 → gzip)
├─ Inventory.java       inventaire : mods, packs de ressources, shader (+ SHA-512 mis en cache)
└─ LaunchMarker.java    lecture de hsmp/launch.json (preuve du lancement par le launcher)
build.gradle.kts        génération de GuardBuild (clé + lien), obscurcissement ProGuard
proguard.pro            règles d'obscurcissement
```
