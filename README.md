# HARDCORE SMP — Saison 2

Projet officiel du serveur Minecraft **HARDCORE SMP** (`hardcore-smp.mine.fun`, Minecraft Java 26.2, Paper).
Dépôt : https://github.com/l88167373-stack/hardcore-smp · Téléchargement du launcher : https://github.com/l88167373-stack/hardcore-smp/releases/latest
On ne rejoint le serveur qu'avec le launcher officiel, connecté à un compte Microsoft, whitelisté via le Discord,
règlement accepté et sans mod interdit.

| Dossier | Contenu |
|---|---|
| [`launcher/`](launcher/README.md) | Launcher Electron + React + TypeScript : connexion Microsoft, installation, catalogue Modrinth, quarantaine, statut du serveur, actus, Rich Presence, mises à jour |
| [`guard-mod/`](guard-mod/README.md) | Mod client Fabric « HSMP Guard » : réponse signée au défi du serveur |
| [`server-plugin/`](server-plugin/README.md) | Plugin Paper « HSMP Gatekeeper » : whitelist par Discord (bot intégré) et vérification du Guard |
| [`config/`](config/README.md) | Configuration publique (actus, règlement, mods autorisés…) lue en ligne par le launcher et le plugin |
| [`docs/`](docs/) | [Guide admin](docs/INSTALL-ADMIN.md) · [Guide joueur](docs/GUIDE-JOUEUR.md) · [Checklist de bout en bout](docs/CHECKLIST-E2E.md) · [Plan de la phase 0](docs/PLAN-PHASE-0.md) |
| [`.github/workflows/`](.github/workflows/) | Vérifications à chaque envoi, publication du launcher (Windows, macOS, Linux) et du Guard |
| `assets/` | Logo et icône officiels (à fournir : `logo.png`, `icon-1024.png`) |

## Par où commencer

1. Lis le [guide admin](docs/INSTALL-ADMIN.md) : il liste dans l'ordre tout ce que tu dois créer (GitHub, Azure, bot Discord,
   clé du Guard, application Discord pour la Rich Presence) et où coller chaque valeur `TODO_…`.
2. Publie la première version du launcher (guide admin, section 9.4).
3. Fais le test final avec la [checklist](docs/CHECKLIST-E2E.md), puis poste l'annonce du [guide joueur](docs/GUIDE-JOUEUR.md).

## Avancement

- [x] Phase 0 : vérifications et plan
- [x] Phase 1 : launcher, design et tous les écrans
- [x] Phase 2 : connexion Microsoft (en attente du Client ID Azure pour le test réel)
- [x] Phase 3 : installation et lancement du jeu (testé : installation réelle + démarrage du jeu)
- [x] Phase 4 : plugin Paper et bot Discord (testé sur un vrai Paper 26.2 ; bot réel en attente du token)
- [x] Phase 5 : HSMP Guard et vérification à la connexion (testé de bout en bout sur un vrai Paper 26.2)
- [x] Phase 6 : catalogue Modrinth, allowlist, quarantaine (testé avec le vrai Modrinth et sur Paper 26.2 : 7 scénarios)
- [x] Phase 7 : actus, statut serveur, Rich Presence, mises à jour (testé avec le vrai serveur, le vrai Discord, un flux de mise à jour local)
- [x] Phase 8 : CI, installateurs 3 OS, guides, checklist (installateur Windows construit et testé ; macOS et Linux construits par GitHub Actions)

## Encore à fournir par le propriétaire

Client ID Azure · token et identifiants du bot Discord · lien d'invitation Discord ·
Application ID Discord (Rich Presence) · logo et icône · validation de la liste des mods autorisés et du règlement.

Aucun secret n'est stocké dans ce dépôt : le token du bot Discord et la clé du Guard restent hors du code
(`config.yml` du serveur, secrets GitHub).
