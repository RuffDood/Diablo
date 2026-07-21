# Attribution groupée des points de compétence — D2RLoader 3.2

## Décision gameplay

Option A retenue par Vincent le 21 juillet 2026 : livrer
`BulkSkillPointAllocation` avant le prochain chantier de plugin natif.

Le comportement est le suivant :

- clic normal : un point de compétence, sans confirmation;
- `Ctrl + clic` : jusqu'à `skill_points_per_ctrl_click` points de compétence,
  5 par défaut, sans
  confirmation;
- `Shift + clic` : tous les points de compétence encore utilisables, après confirmation;
- `Ctrl + Shift + clic` : `Shift` prend la priorité et conserve la confirmation.

Le lot Ctrl est configurable de 1 à 1000. Aucun plafond 20 n'est codé en dur :
la capacité du lot provient du `MaxLvl` effectif de la compétence dans les
tables runtime du mod actif. Les plafonds 25, 30 et les autres valeurs valides
sont donc admis sans recompilation.

## Référence D2MOO, sémantique seulement

La référence gouvernée D2MOO est épinglée au commit
`19019806df7f3e877fa105b05395d1e3597e2316` et cible Diablo II 1.10f. Elle
fournit uniquement une preuve sémantique; aucune adresse, structure ou ABI
32 bits n'a été transposée dans D2R 3.2.

- `D2MOO@19019806df7f3e877fa105b05395d1e3597e2316:source/D2CommonDefinitions/include/D2PacketDef.h:341-345`
  définit le paquet client `0x3B` historique sur 3 octets : un opcode et un
  identifiant de compétence 16 bits, sans compteur de rangs;
- `D2MOO@19019806df7f3e877fa105b05395d1e3597e2316:source/D2Net/src/Server.cpp:482-484`
  enregistre cette taille dans la table réseau;
- `D2MOO@19019806df7f3e877fa105b05395d1e3597e2316:source/D2Game/src/PLAYER/PlrMsg.cpp:2951-2994`
  montre que le serveur valide un rang à la fois : taille, identifiant, classe,
  prérequis, attributs, niveau courant, maximum et dépense.

Le paquet D2R 3.2 observé n'est pas copié sur cette structure historique : son
builder client écrit 5 octets. La propriété importante conservée est qu'une
requête `0x3B` représente toujours un seul rang et n'offre aucun champ de lot.

## Preuve D2R.exe 3.2.92777

Le workbench persistant vérifié porte l'image canonique SHA-256
`CC59119DC2A6C7D43D088098FC162EAFA4AE1299B2079126AEF43C1ACA914715`.
Les chemins suivants ont été reconstruits directement dans cette image :

- `0x014C69D6` : branche du clic d'investissement dans l'arbre de compétences;
- `0x014C6A07` : appel au builder de paquet après validation client;
- `0x0120A100` : wrapper natif de l'état asynchrone d'une touche virtuelle. Le
  chemin skill l'appelle avec `VK_SHIFT` avant de construire le paquet; la
  version 1.0.2 réutilise exactement ce chemin pour Shift et Ctrl;
- `0x014C3DA0` : validation native du prochain rang. La fonction obtient le
  joueur local, lit la stat 5 des points disponibles, résout le record
  `SkillsTxt`, le skill courant et son niveau, applique le calcul de coût
  personnalisé, lit le maximum runtime, puis contrôle l'état bloquant;
- `0x00214220` : helper du maximum runtime de la compétence;
- `0x000EC700` : builder client d'une commande de 5 octets. Pour l'opcode
  `0x3B`, les deux octets de valeur contiennent le skill id; les deux derniers
  octets ne constituent pas un compteur de rangs;
- `0x000EE2A0` : file réseau client appelée par le builder;
- `0x014E9DC0` : gestionnaire comparable des points de statistiques. Son
  résolveur assigne 1 au clic normal, 5 à Ctrl et `0xFFFF` à Shift; cela prouve
  la priorité de Shift dans le comportement de référence, mais le paquet stats
  `0x3A` possède une sémantique différente et n'est pas réutilisé.

Les getters strictement signés utilisés pour observer la progression sont
`0x0008B2D0` (contexte local), `0x0009A480` (joueur local), `0x0034A0E0`
(contexte data de l'unité), `0x0033DCD0` (skill par id) et `0x0033D1E0`
(niveau de base).

## Implantation livrée

`BulkSkillPointAllocation 1.0.2` est un plugin D2RLoader hybride, attribué à
`RuffnecKk`, sans `ModScopedOnly`. Il peut être installé globalement ou sous un
mod. Il intercepte le builder à `0x000EC700` avec son prologue strict de 29
octets et ne modifie que l'opcode `0x3B`; tous les autres paquets traversent le
trampoline intact.

Le premier rang utilise immédiatement le builder natif. Pour chaque rang
supplémentaire, une file bornée attend que le niveau de base observé change,
preuve que le rang précédent a été traité, puis rappelle la validation native
`0x014C3DA0` avant d'envoyer une nouvelle requête mono-rang. La file s'arrête au
premier refus ou après une sécurité interne fixe de 2000 ms sans confirmation.
Cette valeur n'est pas un délai entre deux points et n'est plus exposée dans le
TOML. Ce modèle
laisse les règles runtime et le serveur autoritaires pour les coûts `SkPoints`,
la classe, les prérequis, les attributs, le niveau requis, les points restants
et le plafond effectif.

La confirmation Shift utilise une boîte Windows possédée par la fenêtre du jeu.
D2RLoader n'expose pas actuellement d'API stable permettant de construire une
confirmation native en jeu. Refuser la boîte n'envoie aucun paquet. Ctrl ne
demande aucune confirmation.

La version 1.0.2 corrige la détection de Ctrl : `GetKeyState` pouvait perdre
l'état Ctrl entre le clic UI et la construction du paquet, ce qui classait le
clic comme un clic normal. Le plugin appelle désormais le wrapper asynchrone
natif `0x0120A100`, comme le fait déjà D2R pour Shift. Cette correction ne
change pas le comportement des clics répétés et n'ajoute aucun verrou anti-spam.

Configuration :
`data-BKVince/d2rloader/config/bulk-skill-point-allocation.toml`.
Sources :
`data-BKVince/d2rloader/plugins/BulkSkillPointAllocation-src/`.
Archive publique :
`addons/BulkSkillPointAllocation/BulkSkillPointAllocation.zip`, avec la DLL et
le TOML seulement.

La commande console `bulk-skill-points` affiche la configuration active, l'état
de la file et les compteurs clic normal, lots Ctrl, Shift acceptés/annulés,
rangs envoyés, lots terminés, arrêts par règle et timeouts de synchronisation.

## Validation technique du 21 juillet 2026

- compilation Release x64 réussie;
- test unitaire de politique réussi, incluant Ctrl 1/5, priorité Shift et
  plafonds 20/25/30;
- exports vérifiés : `D2RLoaderGetPluginInfo`, `D2RLoaderLoadPlugin` et
  `D2RLoaderUnloadPlugin`;
- DLL source et runtime identiques, SHA-256
  `49EE34F7AFDA685D201FA0E2B249FB618EF0BB442DC3ED54ED36079A022437FC`;
- TOML SHA-256
  `6CC52A50CE66CD44C6E40FD889D00C8C215458242ABBBD42C9CBC92EBDF6F59F`;
- ZIP SHA-256
  `59DB4C9D8C8DD105289ACB50749DC5E66602E367E94BC4E9A4664BBF1BACB3BE`;
- cold-start réussi : hook accepté à `0x000EC700`, 20/20 patches, 14/14
  plugins actifs sans rejet ni échec et 24/24 étapes de démarrage;
- cold-start global 1.0.2 réussi sans mod actif : détection asynchrone signée,
  plugin chargé, 20/20 patches et 24/24 étapes; les trois autres échecs parmi
  les 16 plugins globaux sont indépendants de BulkSkillPointAllocation;
- l'assertion RapidJSON tardive au caller RVA `0x0007600A` a été capturée et
  ignorée par D2RLoader; elle est déjà connue dans ce runtime et n'est pas
  attribuée à ce plugin.

## Gate fonctionnel restant

La livraison technique ne remplace pas l'essai gameplay. Il reste à vérifier en
jeu : clic normal; Ctrl avec lots 1/5/10 et moins de points que le lot; Shift
accepté et annulé; Ctrl+Shift; plafonds 20/25/30; coûts `SkPoints` supérieurs à
1; classe, prérequis, niveau requis et attributs invalides; souris/clavier;
solo, hôte et joiner; sauvegarde/rechargement; absence de dépense excédentaire,
duplication, rafale, crash ou désynchronisation.
