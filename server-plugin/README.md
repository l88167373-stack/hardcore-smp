# HSMP Gatekeeper (plugin Paper)

Plugin Paper 26.2 (Java 25) du serveur **HARDCORE SMP**. Il gère :

- la **whitelist par Discord** : le joueur écrit son pseudo dans `#whitelist` (ou `/whitelist pseudo:`),
  le bot vérifie le compte chez Mojang, l'enregistre, l'ajoute à la whitelist et lui donne le rôle « Whitelisté » ;
- le **retrait automatique** quand un membre quitte le Discord, en est expulsé ou banni (retrait de la whitelist + kick) ;
- la **réconciliation** au démarrage puis toutes les X heures (départs manqués pendant que le serveur était éteint) ;
- le **contrôle à la connexion** n°1 : être whitelisté ET lié à un membre présent sur le Discord ;
- les **commandes** du staff : `/wl info|list|remove|force` sur Discord, `/gatekeeper reload|info|bypass` en jeu ;
- le **contrôle à la connexion** n°2, pendant la phase de configuration (avant l'entrée dans le monde) :
  défi envoyé au mod **HSMP Guard**, réponse signée (HMAC-SHA256), versions minimales, jeton du launcher,
  règlement accepté, et chaque mod / pack / shader identifié sur **Modrinth** puis comparé à l'allowlist
  (les dépendances obligatoires des mods autorisés sont acceptées aussi).

Il ne modifie aucun autre plugin et utilise un **bot Discord dédié** (différent de celui du pont chat).

## Installer sur le serveur

1. Récupère `HSMPGatekeeper-<version>.jar` (dans `build/libs/` après compilation, ou sur la page des releases).
2. Copie-le dans le dossier `plugins/` du serveur et redémarre le serveur.
3. Ouvre `plugins/HSMPGatekeeper/config.yml` : chaque réglage est expliqué en français.
   Remplace les valeurs `TODO_…` (token du bot, identifiants du serveur, des salons et des rôles,
   clé du Guard `guard.keys`, adresse `public-config.url`).
4. Tape `/gatekeeper reload` (en jeu ou dans la console).

Le guide pas à pas (création du bot Discord, intentions à activer, permissions) est dans
[`docs/INSTALL-ADMIN.md`](../docs/INSTALL-ADMIN.md).

Dans `server.properties`, garde `white-list=true` et `enforce-whitelist=true` : le plugin tient la whitelist à jour.

## Compiler

Prérequis : rien (le « wrapper » Gradle télécharge Gradle et le JDK 25 tout seul). Il faut seulement un Java 17+
pour lancer Gradle (déjà présent sur ton PC).

```bash
./gradlew build
```

Le plugin est créé dans `build/libs/HSMPGatekeeper-<version>.jar` (JDA embarqué et relocalisé).
`./gradlew test` lance les tests (whitelist, base de données, configuration, commandes Discord, MockBukkit).

## Organisation

```
src/main/java/fun/hardcoresmp/gatekeeper/
├─ GatekeeperPlugin.java     démarrage, rechargement, bypass
├─ config/                   lecture et validation de config.yml, messages MiniMessage
├─ storage/                  SQLite (liens Discord ↔ Minecraft, preuves d'acceptation du règlement, historique)
├─ mojang/                   recherche d'un compte Minecraft par pseudo (API officielle)
├─ whitelist/                cœur : lier, retirer, réconcilier, décider à la connexion
├─ discord/                  bot JDA : #whitelist, /whitelist, /wl, départs et bannissements, logs du staff
├─ login/                    contrôle à la connexion n°1 (whitelist Discord)
├─ guard/                    contrôle n°2 : défi HSMP Guard, vérification signée, identification Modrinth
├─ publicconfig/             config/ du dépôt (versions minimales, règlement, allowlist) : en ligne → cache → embarquée
└─ command/                  /gatekeeper
```

## Données

`plugins/HSMPGatekeeper/gatekeeper.db` (SQLite) :

| Table | Contenu |
|---|---|
| `links` | UUID Minecraft, identifiant Discord, pseudo, date, qui a créé le lien |
| `rules_acceptance` | UUID, version du règlement, date d'acceptation (preuve, enregistrée à chaque connexion acceptée) |
| `audit_log` | historique de la whitelist et des refus du Guard (`GUARD_DENIED`) |
| `modrinth_cache` | empreinte SHA-512 → projet Modrinth et dépendances (évite de redemander à chaque connexion) |

Tout est basé sur l'**UUID** : un changement de pseudo ne casse rien (le pseudo enregistré est mis à jour à la connexion).

## Fils d'exécution

- Le thread principal du serveur ne fait **jamais** de réseau ni de base de données.
- Base SQLite : un fil dédié. Bot Discord et Mojang : asynchrones. Whitelist et kicks : renvoyés sur le thread principal.
- À la connexion, la décision de whitelist est instantanée (tout est en mémoire).
- Le Guard est vérifié sur le fil propre à chaque joueur en configuration (événement asynchrone de Paper) :
  attendre sa réponse (5 s maximum) ne ralentit ni le serveur ni les autres joueurs.
