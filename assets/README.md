# assets/

Fichiers graphiques officiels du serveur. **À déposer ici par le propriétaire du serveur :**

| Fichier | Utilisation | Format conseillé |
|---|---|---|
| `logo.png` | Logo affiché dans le launcher (accueil, onboarding, barre de titre) | PNG transparent, au moins 1200 px de large |
| `icon-1024.png` | Icône de l'application (`.ico`, `.icns`, `.png` générés automatiquement) | PNG carré 1024 × 1024 |

Tant que ces fichiers sont absents, le launcher affiche un logo typographique de remplacement
et l'icône provisoire `launcher/resources/placeholder-icon.svg`.

Après avoir ajouté ou changé une image : relance `npm run dev` (le logo) ou `npm run icons` (l'icône) dans `launcher/`.
