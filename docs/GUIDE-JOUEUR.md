# Guide du joueur — HARDCORE SMP (Saison 2)

Le serveur **HARDCORE SMP** (`hardcore-smp.mine.fun`) n'accepte que les joueurs qui passent par le **launcher officiel**.
Il installe tout tout seul (Java, Minecraft 26.2, Fabric, les mods autorisés) et te connecte directement au serveur.

---

## 1. Ce qu'il te faut

- **Minecraft : Java Edition**, acheté sur un compte Microsoft (la version Bedrock ne marche pas).
- Un compte **Discord** et être membre du serveur Discord HARDCORE SMP.
- Un ordinateur sous **Windows 10/11 (64 bits)**, **macOS 12 ou plus récent** (Intel ou Apple Silicon) ou **Linux 64 bits**.
- Environ **2 Go** d'espace libre et **4 Go de RAM** au minimum (8 Go conseillés).

## 2. Télécharger et installer

Télécharge le launcher ici : **TODO_LIEN_TELECHARGEMENT** (page « Releases » du GitHub officiel).
Ne le prends **jamais** ailleurs : un faux launcher pourrait voler ton compte.

### Windows

1. Télécharge `HARDCORE-SMP-Setup-X.Y.Z.exe` et ouvre-le. L'installation est automatique (pas besoin d'être administrateur).
2. Si Windows affiche **« Windows a protégé votre ordinateur »** : clique sur **Informations complémentaires**, puis
   **Exécuter quand même**. Ce message apparaît parce que le launcher n'est pas signé par un certificat payant ;
   il est sans danger s'il vient du lien officiel.
3. Un raccourci **HARDCORE SMP** est créé sur le Bureau et dans le menu Démarrer.

### macOS

1. Télécharge `HARDCORE-SMP-X.Y.Z-mac.dmg`, ouvre-le et glisse **HARDCORE SMP** dans **Applications**.
2. Au premier lancement, macOS refuse d'ouvrir l'app (« Apple n'a pas pu vérifier… ») car elle n'est pas notarisée
   (cela demande un abonnement Apple payant). Pour l'autoriser :
   1. Clique sur **OK** / **Terminé** dans le message.
   2. Ouvre **Réglages Système** → **Confidentialité et sécurité**.
   3. Tout en bas, à côté de « HARDCORE SMP a été bloqué », clique sur **Ouvrir quand même**, puis confirme avec ton mot de passe.
   (Sur les anciennes versions de macOS : **clic droit** sur l'app → **Ouvrir** → **Ouvrir**.)
3. Sur Mac, le launcher ne peut pas se mettre à jour tout seul : quand une nouvelle version sort, il te le dit et
   un bouton **Télécharger** ouvre la page. Installe-la par-dessus, tes réglages sont conservés.

### Linux

- **Ubuntu, Debian, Mint** : télécharge le `.deb`, puis `sudo apt install ./HARDCORE-SMP-X.Y.Z.deb`.
- **Autres distributions** : télécharge le `.AppImage`, rends-le exécutable (`chmod +x HARDCORE-SMP-X.Y.Z.AppImage`)
  puis lance-le. S'il ne démarre pas, installe `libfuse2` (ou `libfuse2t64` sur Ubuntu 24.04).

## 3. Première ouverture (5 étapes)

1. **Connexion Microsoft** : une fenêtre Microsoft s'ouvre. Ton mot de passe est saisi chez Microsoft, jamais dans le launcher.
2. **Règlement** : lis-le jusqu'en bas, puis coche « J'ai lu et j'accepte ».
3. **Discord** : rejoins le serveur Discord et écris **ton pseudo Minecraft** dans le salon `#whitelist`.
   Le bot répond ✅ et te donne le rôle « Whitelisté ». (Ton compte Discord doit avoir au moins 7 jours.)
4. **Installation** : Java, Minecraft, Fabric, le mod HSMP Guard et les mods recommandés (environ 700 Mo la première fois).
5. **JOUER** : le jeu s'ouvre et se connecte directement au serveur.

## 4. Mods, packs de ressources et shaders

- Onglet **Mods** : seuls les projets **autorisés par le serveur** peuvent être installés. Les autres sont visibles avec
  « Non autorisé sur le serveur » et un bouton **Proposer ce mod**.
- Les dépendances s'installent toutes seules. Un shader installe aussi **Iris**.
- Active un pack de ressources en jeu : **Options → Packs de ressources**. Un shader : **Options → Vidéo → Packs de shaders**.
- **N'ajoute rien à la main** dans les dossiers du jeu : avant chaque lancement, le launcher met de côté tout fichier
  non autorisé dans le dossier `quarantaine` (rien n'est supprimé) et te dit pourquoi.

## 5. Ce que le launcher et le mod HSMP Guard vérifient

À chaque connexion, le petit mod **HSMP Guard** (installé automatiquement) envoie au serveur : la liste des mods,
packs et shader chargés (nom de fichier et empreinte), la version du règlement acceptée et une preuve que le jeu a été
lancé par le launcher officiel. **Rien d'autre** : pas de liste de programmes, pas de fichiers en dehors du dossier du jeu.
Tes identifiants Microsoft sont chiffrés sur ton PC et ne sont envoyés qu'à Microsoft et Mojang.

## 6. Problèmes fréquents

| Message | Que faire |
|---|---|
| « Pas de profil Xbox » | Va sur [xbox.com](https://www.xbox.com), connecte-toi une fois avec ce compte pour créer ton profil, puis réessaie. |
| « Compte enfant » | Un parent doit autoriser le jeu en ligne dans les paramètres familiaux Microsoft. |
| « Minecraft Java non acheté » | Connecte le compte qui possède Minecraft : Java Edition. |
| « Pas encore de pseudo » | Lance une fois le launcher Minecraft officiel pour choisir ton pseudo, puis reviens. |
| « Tu n'es pas whitelisté » | Écris ton pseudo exact dans `#whitelist` sur le Discord. |
| « Tu n'es plus sur le Discord » | Reviens sur le Discord : l'accès est réservé à ses membres. |
| « Connexion refusée : utilise le launcher officiel » | Lance le jeu **depuis le launcher** (pas depuis le launcher Minecraft habituel). |
| « Le règlement a changé » | Relance le launcher : il t'affiche le nouveau règlement à accepter. |
| « Mod non autorisé : … » | Retire-le dans l'onglet Mods (ou il partira en quarantaine au prochain lancement). |
| « Mise à jour obligatoire » | Clique sur **Installer et redémarrer** (sur Mac : **Télécharger**). |
| « Pas assez de mémoire » | Baisse la RAM dans **Paramètres** et ferme les programmes inutiles. |
| Le jeu plante ou ne démarre pas | **Paramètres → Vérifier et réparer les fichiers**. Si ça continue : **Support → Copier les derniers logs** et envoie-les au staff sur le Discord. |
| Mon antivirus bloque le launcher | Autorise « HARDCORE SMP » dans ton antivirus (le launcher n'est pas signé, certains antivirus s'en méfient). |

Tu bloques encore ? Demande de l'aide sur le Discord, le staff répond vite.

---

## Message à poster sur le Discord (#annonces)

> 🔥 **LE LAUNCHER OFFICIEL HARDCORE SMP EST LÀ** 🔥
>
> Pour la **Saison 2**, on ne rejoint le serveur **que** par le launcher officiel. Il fait tout à ta place :
> ☕ installe Java, Minecraft 26.2, Fabric et les mods de performance
> 🚀 te connecte directement au serveur en un clic sur **JOUER**
> 🧩 te propose les mods, packs et shaders **autorisés** (Sodium, Iris, Complementary…)
> 📊 affiche le statut du serveur et les actus en direct
>
> **Pour jouer :**
> 1️⃣ Télécharge le launcher : TODO_LIEN_TELECHARGEMENT
> 2️⃣ Connecte ton compte Microsoft (Minecraft Java acheté)
> 3️⃣ Accepte le règlement
> 4️⃣ Écris ton pseudo Minecraft dans #whitelist
> 5️⃣ Clique sur **JOUER** !
>
> 🚫 Les clients de triche et les mods non autorisés sont refusés automatiquement.
> ❓ Un souci ? Le guide complet et l'aide sont dans #support.
>
> **SURVIS. MEURS. REVIENS.** ☠️
