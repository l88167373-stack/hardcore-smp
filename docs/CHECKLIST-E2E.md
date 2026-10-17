# Checklist de bout en bout — HARDCORE SMP

État au **17/10/2026**. Chaque ligne indique ce qui a été vérifié **pour de vrai**, avec quoi, et ce qui reste à faire
quand les dernières infos seront renseignées (Client ID Azure, bot Discord, dépôt GitHub).

Légende : ✅ vérifié de bout en bout · 🟡 vérifié en partie (le reste attend une info) · ⬜ à faire

| # | Scénario | État | Comment ça a été vérifié |
|---|---|---|---|
| 1 | Joueur avec le launcher officiel, whitelisté, règlement accepté → **il entre** | 🟡 | Vrai serveur Paper 26.2 local + vrai jeu lancé par le launcher (compte hors ligne « Testeur ») : HSMP Guard OK, le joueur entre (`launcher/tests/integration/guard.integration.ts`). **Reste** : refaire avec un vrai compte Microsoft (Client ID Azure) sur le vrai serveur. |
| 2 | Joueur avec le launcher Minecraft normal → **refusé** (« utilise le launcher officiel ») | ✅ | Vrai jeu sans HSMP Guard → « Connexion refusée : utilise le launcher officiel HARDCORE SMP » (même test, scénario 1). |
| 3 | Mod non autorisé ajouté à la main dans `mods/` → **mis en quarantaine** par le launcher | ✅ | Freecam 26.2 copié dans `mods/` → déplacé dans `quarantaine/` avec « « Freecam » n'est pas autorisé sur le serveur », le joueur entre. |
| 3b | … et s'il passe quand même → **refusé** par le serveur | ✅ | Même mod avec la quarantaine désactivée → « Mod non autorisé : freecam-fabric-1.5.0+mc26.2.jar ». Idem pour un pack de ressources interdit (Better Leaves). |
| 4 | Pseudo écrit dans `#whitelist` → **whitelisté + rôle donné** | 🟡 | Logique testée (tests du plugin, MockBukkit) ; plugin + JDA démarrés sur un vrai Paper 26.2. **Reste** : test avec le vrai bot (token, identifiants des salons et du rôle). |
| 5 | Le joueur quitte le Discord (ou est banni) → **retiré de la whitelist et kick** | 🟡 | Logique testée (tests du plugin : départ, bannissement, expulsion, réconciliation, kick sur le thread principal). **Reste** : test avec le vrai bot. |
| 6 | Nouvelle version du règlement → **refusé** jusqu'à ré-acceptation dans le launcher | ✅ | Vrai serveur : règlement v0 < v1 → « Le règlement a changé » ; le launcher bloque JOUER tant que la nouvelle version n'est pas acceptée (tests du launcher). |
| 7 | Nouvelle version du launcher publiée → **mise à jour proposée** automatiquement | 🟡 | Vrai launcher + flux de mise à jour local : version 0.2.0 trouvée, téléchargée, empreinte vérifiée, bandeau « Redémarrer maintenant » ; avec `minLauncherVersion` 0.2.0 → « Mise à jour obligatoire ». **Reste** : une vraie release GitHub (section 9.4 du guide admin). |

## Autres vérifications faites

| Vérification | Résultat |
|---|---|
| Installation réelle (Java 25, Minecraft 26.2, Fabric, mods) et démarrage du jeu | ✅ ~700 Mo, le jeu s'ouvre |
| Pack + shader autorisés (Faithful, Complementary + Iris) activés en jeu | ✅ acceptés par le serveur (« 9 mods, 1 pack, shader Complementary ») |
| Catalogue Modrinth réel (recherche 26.2, dépendances, mises à jour, quarantaine) | ✅ `launcher/tests/integration/mods.integration.ts` |
| Statut du vrai serveur `hardcore-smp.mine.fun` (SRV → hébergeur) | ✅ joueurs, ping, version, MOTD, icône |
| Discord Rich Presence avec le vrai Discord | 🟡 dialogue avec Discord OK, aucun plantage ; **reste** : Application ID (guide admin, section 7) |
| Installateur Windows construit sur un vrai PC, app lancée en mode « installé » | ✅ interface servie par `app://`, pas de panneau Démo, options de débogage refusées |
| Installateurs macOS et Linux | ⬜ construits par GitHub Actions à la première release |
| Connexion Microsoft réelle | ⬜ attend le Client ID Azure (guide admin, section 1) |

## Refaire le test final (quand tout est renseigné)

1. Publie une version (`v0.2.0`, guide admin 9.4) et installe-la sur un PC « joueur ».
2. Connecte un **vrai** compte Microsoft, accepte le règlement, écris ton pseudo dans `#whitelist` → rôle donné (4).
3. **JOUER** → tu entres sur le serveur (1).
4. Lance Minecraft avec le launcher normal → refusé (2).
5. Copie un mod interdit dans le dossier `mods` du jeu (bouton **Paramètres → Ouvrir le dossier du jeu**) → au lancement,
   il part en quarantaine (3).
6. Change le règlement (version +1, guide admin 6.3) → relance le jeu sans passer par le launcher → refusé ; relance le
   launcher → nouveau règlement à accepter (6).
7. Publie `v0.2.1` → le launcher de l'étape 1 propose la mise à jour (7).
8. Avec un compte de test : quitte le Discord → retiré de la whitelist et kick (5).
