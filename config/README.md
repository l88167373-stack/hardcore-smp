# config/ — la configuration publique du serveur

Ces 4 fichiers sont **publics** (lus en ligne par le launcher et par le plugin, toutes les 10 minutes). N'y mets jamais de secret.
Ils sont validés ensemble : si l'un d'eux est invalide, la version précédente reste utilisée.

| Fichier | Contenu | Qui le lit |
|---|---|---|
| `launcher.json` | Version de Minecraft, de Fabric, versions minimales, adresse du serveur, liens | launcher + plugin |
| `news.json` | Actus affichées dans le launcher (Markdown) | launcher |
| `rules.json` | Règlement (Markdown) et son numéro de version | launcher + plugin |
| `allowlist.json` | Mods, packs de ressources et shaders autorisés (identifiants Modrinth) | launcher + plugin |

## État actuel

- Les valeurs `TODO_…` attendent tes infos (lien Discord, dépôt GitHub…).
- `news.json` contient 2 actus d'exemple.
- `rules.json` est un **premier jet à relire** (points à confirmer : PvP, griefing, pillage des tombes).
- `allowlist.json` contient uniquement les mods « sûrs » proposés en phase 0. Les mods « à trancher » n'y sont pas encore.

## `allowlist.json` en bref

```json
{ "projectId": "AANobbMI", "name": "Sodium", "recommended": true }
```

- `projectId` : l'identifiant Modrinth (8 caractères), **jamais** le nom : un nom peut être copié par un faux mod.
- Chaque projet va dans **sa** liste : `mods`, `resourcepacks` ou `shaders` (un shader autorisé n'autorise pas un mod).
- `recommended: true` : affiché dans l'onglet « Recommandés » et installé à la première installation.
- `required: true` : installé d'office, impossible à retirer (Fabric API).
- Les **dépendances obligatoires** d'un projet autorisé sont acceptées automatiquement (launcher et serveur) :
  inutile de les ajouter (ex. Placeholder API pour Mod Menu).
- Les shaders ont besoin du mod **Iris** : garde-le dans `mods` si tu autorises des shaders.

Le guide pas à pas (trouver l'identifiant, ajouter, retirer) est dans [`docs/INSTALL-ADMIN.md`](../docs/INSTALL-ADMIN.md#5-autoriser-ou-retirer-un-mod-un-pack-ou-un-shader).
Ajouter une actu, changer le règlement : [`docs/INSTALL-ADMIN.md`, section 6](../docs/INSTALL-ADMIN.md#6-actus-règlement-et-config-en-ligne).
Chaque fichier est vérifié automatiquement par les tests du launcher (`npm test` dans `launcher/`).
