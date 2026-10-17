# Guide administrateur — HARDCORE SMP

> Tout ce que tu dois faire **toi-même**, étape par étape. Ordre conseillé pour démarrer :
> **9.1–9.3** (GitHub) → **1** (Microsoft/Azure) → **2** et **3** (bot Discord et plugin) → **4** (clé du Guard)
> → **7** (Rich Presence) → **9.4** (première version publiée) → **6** (actus, règlement) → **10** (anti-triche serveur).
> Checklist de test final : [`CHECKLIST-E2E.md`](CHECKLIST-E2E.md). Guide à donner aux joueurs : [`GUIDE-JOUEUR.md`](GUIDE-JOUEUR.md).

---

## 1. Créer l'application Microsoft (Azure)

Le launcher a besoin d'un « Client ID » : c'est l'identifiant de **ton** application auprès de Microsoft.
Ce n'est pas un secret (il est visible dans le launcher), mais sans lui la connexion est impossible.

### 1.1 Créer l'application

1. Ouvre <https://portal.azure.com> et connecte-toi avec ton compte Microsoft.
2. Dans la barre de recherche en haut, tape **Inscriptions d'applications** (en anglais : *App registrations*) et ouvre ce service.
   - Si Azure affiche qu'il est impossible de créer une application « en dehors d'un annuaire » :
     crée d'abord un compte Azure gratuit sur <https://azure.microsoft.com/free>. Microsoft demande une carte bancaire
     et un numéro de téléphone **pour vérifier ton identité** ; l'inscription d'une application ne coûte rien.
3. Clique sur **+ Nouvelle inscription**.
4. Remplis :
   - **Nom** : `HARDCORE SMP Launcher`
   - **Types de comptes pris en charge** : **Comptes Microsoft personnels uniquement**
   - **URI de redirection** : dans la liste déroulante, choisis **Client public/natif (mobile et bureau)**, puis colle :
     `https://login.microsoftonline.com/common/oauth2/nativeclient`
5. Clique sur **Inscrire**.

### 1.2 Récupérer le Client ID

Sur la page de l'application qui s'ouvre, copie la valeur **ID d'application (client)**.
Elle ressemble à `1a2b3c4d-1234-5678-9abc-1a2b3c4d5e6f`. C'est ce qu'il faut me donner (ou mettre dans le launcher, voir 1.5).

### 1.3 Autoriser les « clients publics »

1. Dans le menu de gauche de l'application, clique sur **Authentification**.
2. Vérifie que l'URI `https://login.microsoftonline.com/common/oauth2/nativeclient` est bien listée sous
   **Applications mobiles et de bureau** (coche-la si Azure la propose dans une liste).
3. Tout en bas, à **Autoriser les flux de clients publics**, mets **Oui**.
4. Clique sur **Enregistrer**.

Ne crée **pas** de « secret client » : un launcher installé chez les joueurs ne doit pas en avoir.

### 1.4 Demander l'accès à l'API Minecraft (obligatoire)

Une application Azure toute neuve est refusée par Minecraft tant que Mojang ne l'a pas validée
(le launcher affiche alors « Connexion pas encore ouverte »).

1. Ouvre le formulaire officiel : <https://aka.ms/mce-reviewappid>
2. Remplis-le avec :
   - ton **Client ID** (étape 1.2) ;
   - le nom `HARDCORE SMP Launcher` ;
   - une description, par exemple : *« Launcher privé et gratuit pour notre serveur Minecraft Java HARDCORE SMP.
     Il utilise la connexion Microsoft officielle pour lancer le jeu avec le compte du joueur. »*
   - ton adresse e-mail de contact.
3. Envoie le formulaire. La réponse arrive par e-mail ; le délai n'est pas garanti (souvent plusieurs jours).

Si un champ du formulaire te pose question, fais une capture d'écran et envoie-la-moi.

### 1.5 Mettre le Client ID dans le launcher

Le plus simple : **envoie-moi le Client ID**, je le mets à jour.

Pour le faire toi-même : ouvre le fichier `launcher/app-config.json` avec le Bloc-notes et remplace
`TODO_AZURE_CLIENT_ID` par ton Client ID, entre les guillemets :

```json
{
  "azureClientId": "1a2b3c4d-1234-5678-9abc-1a2b3c4d5e6f"
}
```

Puis relance le launcher (`npm run dev` dans le dossier `launcher/`).

### 1.6 Tester

1. Dans le launcher, va dans **Comptes** et clique sur **Ajouter un compte**.
2. Une fenêtre Microsoft s'ouvre : connecte-toi avec le compte qui possède Minecraft.
3. À la première connexion, Microsoft demande d'autoriser « HARDCORE SMP Launcher » : clique sur **Accepter**.
4. La fenêtre se ferme et ton compte apparaît avec ta tête de skin.

| Message affiché | Cause | Que faire |
|---|---|---|
| Connexion pas encore configurée | Client ID absent | Étape 1.5 |
| Connexion pas encore ouverte | Mojang n'a pas encore validé l'application | Attendre la réponse au formulaire (1.4) |
| Configuration Microsoft incorrecte | Client ID faux, URI de redirection absente, ou clients publics non autorisés | Refaire 1.2 et 1.3 |
| Pas de profil Xbox / Compte enfant / Jeu non acheté | Problème du compte du joueur | Suivre le bouton d'aide affiché |

Le journal du launcher (`logs/launcher.log` dans le dossier de l'application) donne le détail technique de chaque échec,
**sans jamais contenir de mot de passe ni de jeton**.

---

## 2. Créer le bot Discord « HSMP Gatekeeper »

C'est un bot **séparé** de celui du pont chat déjà installé (les deux tournent en même temps sans se gêner).

### 2.1 Créer l'application et le bot

1. Ouvre <https://discord.com/developers/applications> et connecte-toi avec ton compte Discord.
2. Clique sur **New Application**, nomme-la `HSMP Gatekeeper`, coche l'acceptation des conditions de Discord, puis **Create**.
3. (Facultatif) Dans **General Information**, mets le logo du serveur comme icône.

### 2.2 Récupérer le token (secret !)

1. Menu de gauche → **Bot**.
2. Clique sur **Reset Token**, confirme, puis **Copy**.
3. Garde-le pour l'étape 3.3. ⚠ **Ne l'envoie à personne** (pas même à moi) et ne le publie jamais :
   quelqu'un qui l'a peut contrôler le bot. Si tu crois qu'il a fuité, refais **Reset Token**.

### 2.3 Activer les « intentions privilégiées »

Toujours dans **Bot**, section **Privileged Gateway Intents** :

- active **SERVER MEMBERS INTENT** (sinon le bot ne voit pas qui quitte le Discord) ;
- active **MESSAGE CONTENT INTENT** (sinon le bot ne peut pas lire les pseudos dans `#whitelist`) ;
- clique sur **Save Changes**.

Sans ces deux options, le serveur affiche « Bot Discord refusé : active Server Members Intent… ».

### 2.4 Inviter le bot sur ton serveur Discord

1. Menu de gauche → **OAuth2** → **URL Generator**.
2. **Scopes** : coche `bot` et `applications.commands`.
3. **Bot Permissions** : coche
   `View Channels`, `Send Messages`, `Embed Links`, `Attach Files`, `Add Reactions`,
   `Read Message History`, `Manage Messages`, `Manage Roles`.
4. Copie l'adresse générée en bas, ouvre-la dans ton navigateur, choisis ton serveur Discord, **Autoriser**.

### 2.5 Préparer les salons et les rôles

1. Crée (si besoin) les salons `#whitelist`, `#logs-anticheat` (visible **uniquement par le staff**),
   `#suggestions-mods` et `#annonces`, et le rôle **Whitelisté**.
2. Dans `#whitelist`, laisse les membres écrire, et donne au bot les permissions du salon
   (voir, écrire, ajouter des réactions, gérer les messages).
3. **Paramètres du serveur → Rôles** : fais glisser le rôle du bot (« HSMP Gatekeeper ») **au-dessus** du rôle
   « Whitelisté ». Sinon le bot ne peut pas donner ce rôle.
4. Choisis le rôle du staff qui pourra utiliser `/wl` (les administrateurs le peuvent toujours).

### 2.6 Copier les identifiants

1. Discord → **Paramètres utilisateur** → **Avancés** → active **Mode développeur**.
2. Clic droit sur… → **Copier l'identifiant** :
   - le **serveur** (sur son icône) → `discord.guild-id`
   - le salon **#whitelist** → `discord.channels.whitelist`
   - le salon **#logs-anticheat** → `discord.channels.logs`
   - le rôle **Whitelisté** (Paramètres du serveur → Rôles) → `discord.roles.whitelisted`
   - le rôle du **staff** → `discord.roles.admin`

Ces identifiants ne sont pas secrets : tu peux me les envoyer pour que je prépare la config.

---

## 3. Installer le plugin sur le serveur Minecraft

### 3.1 Copier le plugin

1. Arrête le serveur (ou fais-le depuis le panneau de ton hébergeur).
2. Copie `HSMPGatekeeper-<version>.jar` dans le dossier `plugins/` (FTP ou gestionnaire de fichiers de l'hébergeur).
3. Démarre le serveur. Le dossier `plugins/HSMPGatekeeper/` est créé avec `config.yml`.

### 3.2 Vérifier `server.properties`

```
online-mode=true
white-list=true
enforce-whitelist=true
```

Le plugin ajoute et retire lui-même les joueurs de la whitelist.

### 3.3 Remplir `config.yml`

Ouvre `plugins/HSMPGatekeeper/config.yml`. Chaque ligne est expliquée. Remplace :

| Clé | Valeur |
|---|---|
| `discord.token` | le token copié en 2.2, entre guillemets |
| `discord.guild-id`, `discord.channels.*`, `discord.roles.*` | les identifiants de 2.6 |
| `links.discord-invite` | ton lien d'invitation Discord permanent |

Puis tape `/gatekeeper reload` dans la console. Tu dois voir :
« Bot Discord prêt sur « … » (N membres) » et « Commandes Discord /whitelist et /wl enregistrées ».

### 3.4 Tester

1. Avec un compte Discord de plus de 7 jours, écris ton pseudo Minecraft dans `#whitelist`.
   → réaction ✅, réponse « Bienvenue … », rôle « Whitelisté », message effacé après 15 secondes.
2. `/wl info pseudo:TonPseudo` (Discord) ou `/gatekeeper info TonPseudo` (en jeu) affichent le lien.
3. Avec un compte de test : quitter le Discord → le joueur est retiré de la whitelist (et kické s'il est en jeu),
   un message apparaît dans `#logs-anticheat`.

### Commandes

| Où | Commande | Effet |
|---|---|---|
| Discord | `/whitelist pseudo:` | Se whitelister (comme écrire dans `#whitelist`) |
| Discord (staff) | `/wl info membre:` ou `pseudo:` | Voir le lien Discord ↔ Minecraft |
| Discord (staff) | `/wl list` | Liste de tous les whitelistés (fichier CSV si la liste est longue) |
| Discord (staff) | `/wl remove membre:` ou `pseudo:` | Retirer de la whitelist (+ kick) |
| Discord (staff) | `/wl force membre: pseudo:` | Lier de force (ignore l'âge du compte, remplace les anciens liens) |
| En jeu / console | `/gatekeeper reload` | Recharger `config.yml` et reconnecter le bot |
| En jeu / console | `/gatekeeper info <joueur>` | Compte Discord lié, présence, bypass |
| En jeu / console | `/gatekeeper bypass <joueur>` | Activer / retirer le bypass (staff, comptes de test) |

### En cas de problème

| Message dans la console | Solution |
|---|---|
| `Bot Discord : le token est invalide` | Refaire **Reset Token** (2.2) et le recoller |
| `Bot Discord refusé : active « Server Members Intent »…` | Étape 2.3 |
| `Rôle « Whitelisté » introuvable` | Vérifier `discord.roles.whitelisted` |
| `Rôle Discord non modifié (le rôle du bot doit être AU-DESSUS…)` | Étape 2.5, point 3 |
| `Réconciliation annulée par sécurité` | Le bot voit trop peu de membres : vérifier l'intention « Server Members » et `guild-id` |

---

## 4. HSMP Guard : clé de signature et mises à jour

Le **HSMP Guard** est le petit mod que le launcher installe tout seul. À chaque connexion, le serveur lui envoie
un défi ; le Guard répond avec la liste des mods, packs et shaders chargés, **signée avec une clé secrète**.
Le plugin connaît la même clé : une réponse fabriquée à la main (sans la clé) est refusée.

| Où est la clé ? | Qui la voit ? |
|---|---|
| Secret GitHub `HSMP_GUARD_KEY` | Toi seul (sert à compiler le Guard publié) |
| `plugins/HSMPGatekeeper/config.yml` → `guard.keys` | Toi et ton hébergeur |
| Dans le jar du Guard, découpée et obscurcie | Personne en clair |

**Ne la mets jamais** dans le dépôt, sur Discord ou dans une capture d'écran.

### 4.1 Créer une clé

Dans PowerShell (Windows), copie-colle cette ligne puis appuie sur Entrée :

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

Une ligne du genre `q3V…=` s'affiche (44 caractères) : c'est ta clé. Garde-la dans ton gestionnaire de mots de passe.

### 4.2 La donner à GitHub (pour les versions publiées)

1. Sur GitHub, ouvre ton dépôt → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret** → Name : `HSMP_GUARD_KEY` → Secret : la clé → **Add secret**.

La publication automatique du Guard (section 9.5) utilise ce secret. Pour compiler le Guard sur ton PC
avec cette clé (dans le dossier `guard-mod`) :

```powershell
$env:HSMP_GUARD_KEY = "ta-clé"; .\gradlew.bat build
```

Sans `HSMP_GUARD_KEY`, chaque compilation crée une clé de test aléatoire dans `build/guard-key.txt`.

### 4.3 La donner au plugin

1. Ouvre `plugins/HSMPGatekeeper/config.yml`, section `guard:`.
2. Remplace `"TODO_GUARD_KEY"` par ta clé, **entre guillemets** :

   ```yaml
   guard:
     enabled: true
     timeout-seconds: 5
     keys:
       - "ta-clé"
     fail-closed: true
   ```

3. Tape `/gatekeeper reload`. La console affiche « vérification HSMP Guard active ».

Tant qu'il reste `TODO_GUARD_KEY`, la vérification du Guard est **désactivée** (seule la whitelist Discord s'applique).

### 4.4 Indiquer l'adresse de la configuration publique

Le plugin lit les versions minimales, la version du règlement et la liste des mods autorisés dans le dossier
`config/` du dépôt GitHub (le même que le launcher). Dans `config.yml` :

```yaml
public-config:
  url: "https://raw.githubusercontent.com/<ton-compte>/<ton-dépôt>/main/config/"
```

Ainsi, une modification de `config/allowlist.json` ou de `config/rules.json` sur GitHub est prise en compte
en 10 minutes, **sans redémarrer** le serveur. Sans adresse (ou si GitHub ne répond pas), le plugin utilise
la dernière copie téléchargée, sinon celle fournie avec le plugin. Le launcher lit la même adresse (section 6.1).

### 4.5 Publier une nouvelle version du Guard (rotation de la clé)

On change de clé à chaque nouvelle version du Guard : si une clé fuite, elle ne sert plus longtemps.

1. Crée une **nouvelle** clé (4.1) et mets-la dans le secret GitHub (4.2, bouton **Update**).
2. Dans `config.yml`, ajoute-la **en premier** et garde l'ancienne en dessous, puis `/gatekeeper reload` :

   ```yaml
     keys:
       - "nouvelle-clé"
       - "ancienne-clé"
   ```

3. Compile et publie le Guard (release GitHub), puis mets à jour `config/launcher.json` :
   `guard.version`, `guard.url` (lien du jar `-protege.jar`) et `guard.sha512`.
   Pour obtenir l'empreinte sous Windows :

   ```powershell
   (Get-FileHash -Algorithm SHA512 .\hsmp-guard-1.1.0-protege.jar).Hash.ToLower()
   ```

4. Les launchers installent la nouvelle version au prochain lancement. Les joueurs encore en jeu avec l'ancienne
   peuvent se reconnecter tant que l'ancienne clé est dans la liste.
5. Après quelques jours, retire l'ancienne clé et fais `/gatekeeper reload`.
   Pour **obliger** tout le monde à passer à la nouvelle version tout de suite (faille corrigée…),
   mets aussi `minGuardVersion` à la nouvelle version dans `config/launcher.json`.

### 4.6 Ce que voit un joueur refusé

| Message en jeu | Cause | Que faire |
|---|---|---|
| « Connexion refusée : utilise le launcher officiel » | Pas de Guard, ou jeu lancé par un autre launcher | Utiliser le launcher officiel |
| « Client modifié ou launcher abîmé » | Signature fausse, Guard modifié, ancienne clé retirée | Paramètres → Vérifier et réparer les fichiers |
| « Mise à jour nécessaire » | Guard ou launcher trop ancien | Relancer le launcher |
| « Le règlement a changé » | Nouvelle version du règlement pas encore acceptée | Relancer le launcher et accepter |
| « Mod non autorisé : … » (ou pack, shader) | Fichier hors de l'allowlist | Le retirer, ou le proposer au staff |
| « Vérification des mods momentanément impossible » | Modrinth ne répond pas et `fail-closed: true` | Réessayer plus tard |

Chaque refus est écrit dans la console, dans `#logs-anticheat` et dans l'historique (`audit_log`, type `GUARD_DENIED`).
Les comptes du staff et de test peuvent passer toutes les vérifications avec `/gatekeeper bypass <joueur>`.

### 4.7 Ce que le Guard envoie

Uniquement : versions du Guard et du launcher, version du règlement acceptée, jeton de lancement, et pour chaque
mod / pack / shader chargé son **nom de fichier** et son **empreinte SHA-512**. Rien d'autre (pas de programmes
ouverts, pas de fichiers hors du dossier du jeu). Le serveur garde la preuve d'acceptation du règlement
(UUID, version, date) dans `rules_acceptance`.

> **Limite honnête** : aucun anti-triche côté client n'est inviolable. Le Guard rend la triche nettement plus
> difficile ; la surveillance du staff reste indispensable.

---

## 5. Autoriser (ou retirer) un mod, un pack ou un shader

La liste est dans `config/allowlist.json`, sur GitHub. Le launcher **et** le plugin la lisent : une seule modification suffit.

### 5.1 Trouver l'identifiant Modrinth

1. Ouvre la page du projet sur [modrinth.com](https://modrinth.com) (ex. `https://modrinth.com/mod/sodium`).
2. Vérifie qu'il existe une version **Fabric** pour **Minecraft 26.2** (onglet *Versions*).
3. Clique sur le bouton **⋮** (« plus d'options ») à côté de *Follow*, puis **Copy ID**.
   Tu obtiens 8 caractères, par exemple `AANobbMI`.

Autre méthode : ouvre `https://api.modrinth.com/v2/project/sodium` dans ton navigateur et copie la valeur de `"id"`.

> Utilise toujours l'**identifiant**, jamais le nom : n'importe qui peut publier un faux mod qui porte le même nom.

### 5.2 Ajouter le projet

1. Sur GitHub, ouvre `config/allowlist.json` puis clique sur le crayon ✏️ (*Edit this file*).
2. Ajoute une ligne dans la bonne liste (`mods`, `resourcepacks` ou `shaders`) :

   ```json
   { "projectId": "AANobbMI", "name": "Sodium" },
   ```

   - Ajoute `"recommended": true` pour le proposer dans l'onglet « Recommandés » (et l'installer aux nouveaux joueurs).
   - Attention aux virgules : chaque ligne finit par `,` **sauf la dernière** de la liste.
3. En bas, **Commit changes**. Les vérifications GitHub (section 9.2) contrôlent que le fichier est valide.
4. Le plugin relit la liste en ligne toutes les 10 minutes (si `public-config.url` est renseignée, voir 4.4) ;
   le launcher la lira en ligne à partir de la phase 7.

Les **dépendances obligatoires** d'un projet autorisé sont acceptées automatiquement : pas besoin de les ajouter.
Pour autoriser des **shaders**, garde le mod **Iris** (`YL57xq9U`) dans `mods`.

### 5.3 Retirer un projet

Supprime sa ligne et **Commit**. Ensuite :

- le serveur refuse les joueurs qui l'ont encore (« Mod non autorisé : … ») ;
- au lancement suivant, le launcher du joueur le retire et le range dans `quarantaine/` avec la raison.

### 5.4 Mods « à trancher »

Certains mods donnent un avantage selon leurs réglages (mini-cartes avec radar ou mode grotte, Freecam, zoom…).
Ils ne sont pas dans la liste de départ : c'est à toi de décider. En cas de doute, ne les autorise pas.

---

## 6. Actus, règlement et config en ligne

Le launcher et le plugin lisent le dossier `config/` **en ligne**, sur GitHub, toutes les 10 minutes :
une actu, un nouveau règlement ou un mod autorisé apparaissent **sans publier de nouvelle version du launcher**.
Sans Internet, chacun garde la dernière copie téléchargée.

### 6.1 Donner l'adresse au launcher

Dans `launcher/app-config.json`, remplace `TODO_PUBLIC_CONFIG_URL` par la même adresse que dans le plugin (4.4) :

```json
"publicConfigUrl": "https://raw.githubusercontent.com/<ton-compte>/<ton-dépôt>/main/config/"
```

Elle doit finir par `/`. Cette adresse est **dans** le launcher (pas dans la config en ligne) : personne ne peut
la détourner en modifiant les fichiers de GitHub.

> Si un fichier publié est invalide (virgule oubliée, date mal écrite…), launcher et plugin l'**ignorent** et
> gardent la version précédente. Le journal du launcher (`logs/launcher.log`) et la console du serveur disent pourquoi.

### 6.2 Ajouter une actu

1. Sur GitHub, ouvre `config/news.json` → crayon ✏️.
2. Ajoute un bloc **en haut** de la liste (n'oublie pas la virgule après `}`) :

   ```json
   {
     "id": "soiree-pvp-novembre",
     "title": "Soirée PvP le 15 novembre",
     "date": "2026-11-08",
     "tag": "Événement",
     "image": "https://raw.githubusercontent.com/<ton-compte>/<ton-dépôt>/main/assets/news/pvp.png",
     "body": "Rendez-vous **à 21 h** au spawn.\n\n- Équipes de 3\n- Récompense : une tête de Warden",
     "link": "https://discord.gg/<invitation>"
   },
   ```

   | Champ | Règle |
   |---|---|
   | `id` | unique, en minuscules, chiffres et tirets |
   | `title` | 90 caractères maximum |
   | `date` | format `AAAA-MM-JJ` (les actus sont triées par date) |
   | `tag` | court (24 caractères max) : « Info », « Événement », « Maintenance »… |
   | `image` | facultatif. Mets l'image dans le dossier `assets/news/` du dépôt et utilise son lien `raw.githubusercontent.com` (les autres sites sont bloqués par sécurité). |
   | `body` | texte en Markdown (`**gras**`, listes, liens). `\n` = retour à la ligne. Le HTML est ignoré. |
   | `link` | facultatif : bouton « En savoir plus » |
3. **Commit changes**. L'actu apparaît dans les launchers en 10 minutes environ.

### 6.3 Changer le règlement

1. Modifie le texte dans `config/rules.json` (`content`) et la date `updatedAt`.
2. **Augmente `version` de 1** dans `rules.json` **et** `rulesVersion` dans `config/launcher.json` (les deux doivent être égaux,
   sinon la modification est ignorée).
3. Commit. Au prochain lancement, chaque joueur doit relire et accepter le nouveau règlement ; le serveur refuse
   (« Le règlement a changé ») ceux qui ne l'ont pas encore fait. L'acceptation est enregistrée par le serveur (`rules_acceptance`).

### 6.4 Statut du serveur

L'accueil du launcher interroge le serveur toutes les 30 secondes (comme la liste des serveurs du jeu) :
joueurs connectés, ping, version, MOTD et icône du serveur. `hardcore-smp.mine.fun` pointe vers l'hébergeur par un
enregistrement DNS « SRV » : le launcher le suit automatiquement, comme Minecraft. Rien à configurer.

---

## 7. Discord Rich Presence (« Joue à HARDCORE SMP »)

Quand un joueur a Discord ouvert, son profil affiche « Dans le launcher » ou « En jeu sur HARDCORE SMP — Saison 2 »,
le temps écoulé, le logo et deux boutons (« Rejoindre le Discord », « Télécharger le launcher »).
Il faut une **application Discord** dédiée (son nom est affiché : « Joue à **HARDCORE SMP** »).

1. Va sur [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**.
2. Nom : **HARDCORE SMP** → accepte les conditions → **Create**.
3. Dans **General Information**, copie l'**Application ID** (17 à 20 chiffres). Ce n'est pas un secret.
4. Dans **Rich Presence → Art Assets** → **Add Image(s)** : envoie le logo (carré, 512×512 minimum) et nomme-le
   exactement `logo`. **Save Changes**. (Discord peut mettre quelques minutes à l'afficher.)
5. Dans `launcher/app-config.json`, remplace `TODO_DISCORD_APPLICATION_ID` par l'Application ID.

Les boutons utilisent `discordInvite` et `links.download` de `config/launcher.json` (ils n'apparaissent que si ces liens
sont renseignés). Chaque joueur peut désactiver la Rich Presence dans **Paramètres**. Si Discord n'est pas ouvert,
il ne se passe rien (aucune erreur).

> N'utilise pas l'application du bot « HSMP Gatekeeper » : on garde des rôles séparés.

---

## 8. Mises à jour du launcher

Le launcher vérifie les nouvelles versions au démarrage puis toutes les 4 heures sur **GitHub Releases**, les télécharge
en arrière-plan et les installe au prochain redémarrage (bandeau « La version X est prête — Redémarrer maintenant »).

### 8.1 Indiquer le dépôt GitHub

- `launcher/app-config.json` : remplace `TODO_GITHUB_REPOSITORY` par `ton-compte/ton-dépôt` (ex. `hardcoresmp/hardcore-smp`).
- `launcher/electron-builder.yml`, section `publish` : remplace `TODO_GITHUB_OWNER` par `ton-compte` (et `repo` si besoin).

Tant que ce n'est pas fait, les mises à jour automatiques sont désactivées (le launcher fonctionne normalement).

### 8.2 Publier une nouvelle version

Voir la section 9.4 : un « tag » `v0.2.0` suffit, GitHub construit et publie les 3 installateurs. Les launchers
déjà installés la trouvent tout seuls (sur Mac, ils proposent de la télécharger).

### 8.3 Forcer la mise à jour

Pour obliger tout le monde à passer à une version (faille corrigée, changement côté serveur…), mets
`minLauncherVersion` à cette version dans `config/launcher.json`. Les launchers plus anciens affichent
« Mise à jour obligatoire » et ne peuvent plus lancer le jeu tant qu'ils ne sont pas à jour (bouton « Installer et redémarrer » ;
si la mise à jour automatique échoue : bouton « Télécharger le launcher »).

> Publie toujours la nouvelle version **avant** d'augmenter `minLauncherVersion`.

---

## 9. GitHub : dépôt, vérifications et publication des versions

### 9.1 Créer le dépôt

1. Crée un compte sur [github.com](https://github.com) si tu n'en as pas.
2. En haut à droite : **+** → **New repository**. Nom : `hardcore-smp` ; **Public** ; ne coche rien d'autre → **Create repository**.
3. Installe [GitHub Desktop](https://desktop.github.com) (le plus simple), connecte-toi, puis
   **File → Add local repository** → choisis le dossier du projet → s'il te propose de créer un dépôt, accepte
   → **Publish repository** (décoche « Keep this code private » : le dépôt doit être public).

Le fichier `.gitignore` empêche l'envoi des secrets (`.env`, clés, `guard-key.txt`) et des fichiers générés.
Avant le premier envoi, vérifie quand même dans GitHub Desktop qu'aucun `config.yml` de serveur ni aucun token n'apparaît.

### 9.2 Ce que GitHub vérifie tout seul

À chaque envoi (**Push origin**), l'onglet **Actions** du dépôt lance « Vérifications » : fichiers de `config/`, launcher
(types, qualité du code, tests, compilation), plugin Paper et mod HSMP Guard. Un ✅ vert : tout va bien. Une ❌ rouge :
clique dessus pour lire l'erreur. Pour une erreur dans `config/`, le message dit quel fichier et quelle ligne corriger.

### 9.3 Renseigner les liens publics

Dans `config/launcher.json` :

| Clé | Valeur |
|---|---|
| `discordInvite` | ton invitation Discord permanente (`https://discord.gg/...`) |
| `links.download` | `https://github.com/<ton-compte>/hardcore-smp/releases/latest` |
| `links.suggestions` | le lien du salon `#suggestions-mods` (clic droit sur le salon → **Copier le lien**) |

`publicConfigUrl` et `updateRepository` (dans `launcher/app-config.json`) sont remplis **automatiquement** par GitHub
au moment de construire une version publiée. Tu peux aussi les écrire toi-même (sections 6.1 et 8.1).

### 9.4 Publier une version du launcher

1. Vérifie que la dernière exécution de « Vérifications » est ✅.
2. Dans GitHub Desktop : onglet **History** → clic droit sur le dernier commit → **Create Tag…**
   → nom : `v0.2.0` (toujours `v` + 3 nombres, plus grand que la version précédente) → **Create Tag**.
3. Clique sur **Push origin** (le tag est envoyé avec).
4. Onglet **Actions** du dépôt → « Release du launcher » : environ 10 à 15 minutes. GitHub construit l'installateur
   Windows (`.exe`), macOS (`.dmg`) et Linux (`.AppImage`, `.deb`), puis publie la release d'un coup.
5. Les launchers installés la détectent dans les 4 heures (ou à leur prochain démarrage).

Si une étape échoue, la release reste en **brouillon** (invisible pour les joueurs) : corrige, supprime le tag
(onglet **Releases**/**Tags** sur GitHub) et recommence.

### 9.5 Publier une version du HSMP Guard

1. Dans `guard-mod/build.gradle.kts`, augmente `version = "1.0.0"` (ex. `1.1.0`).
2. Nouvelle clé : section 4.5 (secret GitHub `HSMP_GUARD_KEY` mis à jour **et** clé ajoutée en premier dans `guard.keys` du plugin).
3. Commit, puis tag **`guard-v1.1.0`** (même numéro) → **Push origin**.
4. Onglet **Actions** → « Release du HSMP Guard » → ouvre l'exécution : le résumé affiche le bloc `guard` à coller
   dans `config/launcher.json`. Colle-le, commit, push. Les launchers installent le nouveau Guard au prochain lancement.

> Les releases du Guard ne deviennent jamais la « dernière version » du dépôt : c'est voulu, pour que les mises à jour
> du launcher continuent de fonctionner.

### 9.6 Signature du code (facultatif, payant)

Sans signature, Windows affiche « Windows a protégé votre ordinateur » et macOS bloque le premier lancement :
le [guide joueur](GUIDE-JOUEUR.md#2-télécharger-et-installer) explique comment passer ces avertissements.

- **Windows** : un certificat de signature de code (quelques centaines d'euros par an). Une fois acheté, ajoute dans
  GitHub (**Settings → Secrets and variables → Actions**) les secrets `CSC_LINK` (certificat `.pfx` encodé en base64) et
  `CSC_KEY_PASSWORD` : la release les utilise automatiquement.
- **macOS** : l'[Apple Developer Program](https://developer.apple.com/programs/) (99 $/an) permet la signature et la
  notarisation. Elle supprime l'avertissement et rend possible la mise à jour automatique sur Mac. À mettre en place plus tard
  si besoin (il faudra alors adapter `electron-builder.yml`).

---

## 10. Anti-triche côté serveur et limites

### 10.1 Ce que le système bloque

- Les clients non officiels (launcher Minecraft normal, clients de triche « tout-en-un ») : pas de HSMP Guard → refusés.
- Les mods, packs et shaders hors de la liste autorisée : identifiés par leur empreinte → refusés.
- Les comptes non whitelistés, partis du Discord, ou qui n'ont pas accepté le règlement.

### 10.2 Limites (à connaître honnêtement)

Le HSMP Guard tourne **sur le PC du joueur**. Un tricheur très motivé et compétent peut le modifier (désassembler le jar,
retrouver la clé, faire une fausse réponse). L'obscurcissement, la clé qui change à chaque version, le jeton du launcher et
la vérification des empreintes rendent cela **long et difficile**, et bloquent la très grande majorité des tricheurs,
mais **aucun anti-triche côté client n'est inviolable**. Il faut donc aussi un anti-triche **côté serveur**, et l'œil du staff.

### 10.3 Installer GrimAC (recommandé)

[Grim Anticheat](https://modrinth.com/plugin/grimac) détecte les triches de **mouvement et de combat** (fly, speed,
reach, killaura…) directement sur le serveur, quel que soit le client. Des versions pour **Paper 26.2** sont publiées
sur Modrinth (vérifié le 17/10/2026 ; elles sont marquées « alpha », c'est le canal habituel de Grim).

1. Télécharge le fichier « paper » le plus récent pour 26.2 sur la page Modrinth de Grim.
2. Teste-le d'abord sur une **copie** du serveur avec tes plugins (tombes, têtes, œufs, HUD, pont Discord) :
   Grim ne touche pas à leur fonctionnement, mais vérifie qu'aucun joueur n'est expulsé à tort (latence, élytres…).
3. Copie-le dans `plugins/`, redémarre, et règle les sanctions dans `plugins/GrimAC/` (commence par de simples alertes au staff).

HSMP Gatekeeper et Grim sont complémentaires : l'un contrôle **ce que le joueur charge**, l'autre **ce qu'il fait** en jeu.

---

## Où sont stockées les connexions des joueurs ?

- Les jetons Microsoft/Minecraft sont **chiffrés par le système** (DPAPI sur Windows, Trousseau sur macOS,
  libsecret/KWallet sur Linux) dans `accounts.json`, dans le dossier de l'application du launcher.
- Le launcher ne voit jamais le mot de passe : il est saisi sur la page Microsoft.
- Sous Linux sans trousseau, rien n'est enregistré : le joueur se reconnecte à chaque ouverture.
- « Se déconnecter » supprime le compte et ses jetons du PC.
