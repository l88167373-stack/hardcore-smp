/**
 * DONNÉES FACTICES pour l'aperçu de l'interface dans un navigateur (`npm run dev:web`), sans Electron.
 * Le vrai launcher n'utilise plus rien d'ici : statut serveur, catalogue et config viennent du process principal.
 */
import type { CatalogProject } from '@shared/mods'
import { parseDescription } from '@shared/motd'
import type { ServerStatus } from '@shared/server-status'

/** Statut d'exemple (même MOTD que le vrai serveur). */
export function mockServerStatus(): ServerStatus {
  return {
    online: true,
    players: 23,
    maxPlayers: 100,
    pingMs: 34 + Math.round(Math.random() * 22),
    version: 'Paper 26.2',
    motd: parseDescription({ text: '', extra: [{ text: 'HARDCORE SMP\n', color: 'gold' }, { text: 'Rejoins nous sans mourir !', color: 'dark_red' }] }),
    favicon: null,
    checkedAt: new Date().toISOString()
  }
}

/** Projet du catalogue factice : l'accès (autorisé ou non) est calculé selon l'allowlist. */
export type MockProject = Omit<CatalogProject, 'access' | 'iconUrl'>

/** Projets existants sur Modrinth (téléchargements relevés le 16/10/2026). */
export const MOCK_CATALOG: MockProject[] = [
  { projectId: 'P7dR8mSH', slug: 'fabric-api', kind: 'mod', title: 'Fabric API', author: 'modmuss50', summary: 'Bibliothèque indispensable à la plupart des mods Fabric.', downloads: 280_060_987 },
  { projectId: 'AANobbMI', slug: 'sodium', kind: 'mod', title: 'Sodium', author: 'jellysquid3', summary: 'Moteur de rendu ultra rapide : beaucoup plus de FPS.', downloads: 246_385_010 },
  { projectId: 'gvQqBUqZ', slug: 'lithium', kind: 'mod', title: 'Lithium', author: 'jellysquid3', summary: 'Optimise la logique du jeu sans rien changer au gameplay.', downloads: 138_075_879 },
  { projectId: 'uXXizFIs', slug: 'ferrite-core', kind: 'mod', title: 'FerriteCore', author: 'malte0811', summary: 'Réduit fortement la mémoire utilisée par le jeu.', downloads: 162_145_716 },
  { projectId: 'NNAgCjsB', slug: 'entityculling', kind: 'mod', title: 'Entity Culling', author: 'tr7zw', summary: "N'affiche pas les entités cachées derrière des blocs.", downloads: 183_507_137 },
  { projectId: '5ZwdcRci', slug: 'immediatelyfast', kind: 'mod', title: 'ImmediatelyFast', author: 'RaphiMC', summary: "Accélère l'affichage des entités, du texte et de l'interface.", downloads: 133_676_521 },
  { projectId: 'mOgUt4GM', slug: 'modmenu', kind: 'mod', title: 'Mod Menu', author: 'Prospector', summary: 'Ajoute la liste des mods installés au menu du jeu.', downloads: 156_549_813 },
  { projectId: 'YL57xq9U', slug: 'iris', kind: 'mod', title: 'Iris Shaders', author: 'coderbot', summary: 'Permet d’utiliser des shaders avec Sodium.', downloads: 191_274_455 },
  { projectId: 'LQ3K71Q1', slug: 'dynamic-fps', kind: 'mod', title: 'Dynamic FPS', author: 'juliand665', summary: 'Baisse les FPS quand le jeu est en arrière-plan.', downloads: 70_243_865 },
  { projectId: '1IjD5062', slug: 'continuity', kind: 'mod', title: 'Continuity', author: 'PepperCode1', summary: 'Textures connectées pour le verre et d’autres blocs.', downloads: 78_074_724 },
  { projectId: 'aC3cM3Vq', slug: 'mouse-tweaks', kind: 'mod', title: 'Mouse Tweaks', author: 'YaLTeR', summary: 'Gestion de l’inventaire plus confortable à la souris.', downloads: 62_821_823 },
  { projectId: '1bokaNcj', slug: 'xaeros-minimap', kind: 'mod', title: "Xaero's Minimap", author: 'thexaero', summary: 'Mini-carte avec radar des entités et mode grotte.', downloads: 118_208_208 },
  { projectId: 'XeEZ3fK2', slug: 'freecam', kind: 'mod', title: 'Freecam', author: 'hashalite', summary: 'Caméra libre détachée du joueur.', downloads: 22_529_045 },
  { projectId: 'w7ThoJFB', slug: 'zoomify', kind: 'mod', title: 'Zoomify', author: 'isXander', summary: 'Zoom configurable façon OptiFine.', downloads: 70_829_072 },
  { projectId: 'w0TnApzs', slug: 'faithful-32x', kind: 'resourcepack', title: 'Faithful 32x', author: 'Faithful Resource Pack', summary: 'Les textures de Minecraft, en deux fois plus détaillé.', downloads: 5_181_074 },
  { projectId: '50dA9Sha', slug: 'fresh-animations', kind: 'resourcepack', title: 'Fresh Animations', author: 'FreshLX', summary: 'Animations des mobs plus vivantes (nécessite ETF + EMF).', downloads: 50_316_216 },
  { projectId: 'HVnmMxH1', slug: 'complementary-reimagined', kind: 'shader', title: 'Complementary Reimagined', author: 'EminGT', summary: 'Shader complet et fidèle au style de Minecraft.', downloads: 70_973_066 },
  { projectId: 'Q1vvjJYV', slug: 'bsl-shaders', kind: 'shader', title: 'BSL Shaders', author: 'capttatsu', summary: 'Shader lumineux et coloré, très personnalisable.', downloads: 31_132_204 },
  { projectId: 'izsIPI7a', slug: 'makeup-ultra-fast-shaders', kind: 'shader', title: 'MakeUp - Ultra Fast', author: 'XavierFST', summary: 'Shader léger pour les PC modestes.', downloads: 13_771_810 },
  { projectId: 'lLqFfGNs', slug: 'photon-shader', kind: 'shader', title: 'Photon Shaders', author: 'SixthSurge', summary: 'Shader réaliste aux ciels spectaculaires.', downloads: 28_673_414 }
]

/** Mods installés au départ dans l'aperçu navigateur. */
export const MOCK_INSTALLED = ['P7dR8mSH', 'AANobbMI', 'gvQqBUqZ', 'uXXizFIs', 'NNAgCjsB', '5ZwdcRci', 'mOgUt4GM']
