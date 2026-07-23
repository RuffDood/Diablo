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
builder client écrit 5 octets et le dernier mot possède une sémantique bulk.
La validation fonctionnelle 92777 établit que `0` demande un point total, `4`
en demande cinq et `0xFFFF` demande tout ce que les règles runtime autorisent.

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
  `0x3B`, les deux octets de valeur contiennent le skill id et les deux derniers
  encodent les rangs supplémentaires : `total - 1`, ou `0xFFFF` pour tout;
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

`BulkSkillPointAllocation 1.2.2` est un plugin D2RLoader hybride, attribué à
`RuffnecKk`, sans `ModScopedOnly`. Il peut être installé globalement ou sous un
mod. Il intercepte le builder à `0x000EC700` avec son prologue strict de 29
octets et ne modifie que l'opcode `0x3B`; tous les autres paquets traversent le
trampoline intact.

Ctrl envoie une seule requête native dont le dernier mot vaut
`skillPointsPerCtrlClick - 1`; la valeur par défaut 5 produit donc `extra = 4`.
Shift confirmé envoie une seule requête avec `extra = 0xFFFF`. Aucun timer,
worker, polling, paquet répété ni file mono-rang ne subsiste en 1.2.1. Le
gestionnaire autoritaire du jeu applique lui-même les coûts `SkPoints`, la
classe, les prérequis, les attributs, le niveau requis, les points restants et
le `MaxLvl` effectif du runtime.

Depuis la version 1.2.0, la confirmation Shift réutilise le `ConfirmationModal`
natif de Diablo. Le modal est asynchrone : le rendu et le thread client ne sont
plus bloqués pendant la décision. Refuser n'envoie aucun paquet; accepter
envoie l'unique requête native assign-all. Ctrl ne demande aucune confirmation.

La version 1.0.3 durcit la détection après l'échec fonctionnel de 1.0.2 :
`Shift` est déduit du marqueur natif `extra = 0xFFFF` produit par le chemin
skill, tandis que Ctrl interroge `VK_CONTROL`, `VK_LCONTROL` et
`VK_RCONTROL` via le wrapper D2R signé et via Win32. La commande de statut
expose le dernier masque de touches et la valeur `extra` pour distinguer sans
ambiguïté un problème de détection d'un arrêt ultérieur de la file.

Configuration :
`data-BKVince/BKVince.mpq/BulkSkillPointAllocation.json`.
Sources :
`data-BKVince/d2rloader/plugins/BulkSkillPointAllocation-src/`.
Archive publique :
`addons/BulkSkillPointAllocation/BulkSkillPointAllocation.zip`, avec la DLL,
le JSON de gameplay et le JSON de chaîne, sans README.

La commande console `bulk-skill-points` affiche la configuration active, les
dernières valeurs `extra` entrante et sortante ainsi que les compteurs clic
normal, lots Ctrl, Shift acceptés/annulés et paquets bulk natifs.

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

## Correctif 1.0.3 du 22 juillet 2026

Le retour en jeu a confirmé que 1.0.2 classait encore `Ctrl + clic` comme un
clic normal, malgré une DLL et un TOML runtime byte-identiques aux sources.
La version 1.0.3 conserve la file mono-rang et ne change que la résolution des
modificateurs : marqueur paquet natif pour Shift, puis contrôles générique,
gauche et droite pour Ctrl par les chemins D2R et Win32. Le test de politique,
la compilation Release x64 et les trois exports D2RLoader réussissent. La DLL
dépôt/runtime porte le SHA-256
`E565A4F4419AC9AFB14F334F6F7866E17751F40C9E21F0A3DFBE5E0EA4A6788A`.
Le ZIP DLL + TOML porte le SHA-256
`968909723344EDE1CEDAE65ED10CB1F123BCD1F3C0FA4232E4C6E2A9333D5554`.
Le cold-start global charge explicitement 1.0.3, accepte le hook strict et
atteint les 24/24 étapes de démarrage; l'assertion RapidJSON connue au caller
`0x0007600A` reste capturée et ignorée.
Le nouveau gate prioritaire est `Ctrl + clic = 5`; si nécessaire, la commande
`bulk-skill-points` expose `last modifiers` et `last extra` immédiatement après
le clic pour isoler le code de touche réellement observé.

## Correctif 1.0.4 du 22 juillet 2026

Le second retour en jeu a confirmé qu'un seul rang était encore envoyé en
1.0.3. La détection Ctrl n'est donc plus considérée comme cause suffisante :
la file 1.0.x exécutait ses lectures de structures client et ses rappels de
fonctions D2R depuis un `std::thread`, alors que le chemin natif démontré les
exécute sur le thread client/UI. La version 1.0.4 supprime entièrement ce
worker. Un timer Windows attaché à la fenêtre D2R est armé depuis le hook du
clic; ses callbacks observent la confirmation serveur, rappellent la validation
native puis envoient chaque paquet suivant sur le même thread que le clic.
Le délai de sécurité, les règles d'arrêt et le protocole mono-rang restent
inchangés. Tests de politique et compilation Release x64 réussis; DLL dépôt et
runtime global identiques, SHA-256
`8C8571799414D8339ACE556F0A03447EB5681220C7EFA6B3179A3E2001D98531`.
ZIP DLL + TOML, SHA-256
`3E121FC9B4E49F1A07E3596AD3761059500352BC89D005E968CA9A6CC4BBABFF`.

## Correctif diagnostique 1.0.5 du 22 juillet 2026

Le test de 1.0.4 a produit des lots instables de 1, 2, 5 et même 6 rangs pour
une cible de 5. Le dépassement prouve une réentrance possible du callback timer
pendant qu'un appel D2R repompe les messages. La version 1.0.5 ajoute un verrou
`processing` maintenu pendant toute observation, validation et émission, ainsi
qu'une génération de lot stricte pour empêcher un ancien callback de muter un
nouveau clic sur la même compétence. Une confirmation n'est acceptée que si le
niveau progresse exactement de `+1`; tout saut ou recul arrête la file. Le timer
n'est armé qu'après le retour du premier envoi natif afin d'interdire un rappel
imbriqué pendant ce premier paquet. Les diagnostics sont temporairement actifs
et journalisent `click`, `started`, chaque `send`, `completed`, `timeout`,
`native-rule-stop` ou `non-monotone-ack` avec niveau, restant et génération.
DLL dépôt/runtime global SHA-256
`944A33B0B7B08B9B818A587E4D474D4419479A12BF5424C728CC382E93586C2F`;
ZIP DLL + TOML SHA-256
`2CE709A14886ABFB30BE13C9CD00CC4EEBF124A60695E229C859E2A8920D1ED4`.

## Stabilisation temporelle 1.0.6 du 22 juillet 2026

Les diagnostics 1.0.5 prouvent un lot complet `0 → 5`, mais aussi des arrêts
après qu'un paquet envoyé environ 30 ms après l'accusé précédent n'a produit
aucun nouveau rang. Le niveau de compétence devient donc observable avant que
l'ensemble de l'état associé soit systématiquement stabilisé. La version 1.0.6
conserve l'accusé exact `+1`, puis attend 150 ms depuis l'envoi précédent avant
de rappeler la validation native et d'envoyer le rang suivant. Un lot Ctrl de
cinq rangs prend environ 600 ms. DLL dépôt/runtime global SHA-256
`B4BC803BEC9E5A2EBB2886BC76669964238320A5CD5E941573643C0DC0EE79A6`;
ZIP SHA-256
`5CB6143F80C62CA88CD4294E3F299994A6B88C6B8C34A12FED8170AC21732BFE`.

## Accélération sûre 1.0.7 du 22 juillet 2026

Huit lots successifs de 1.0.6 ont terminé exactement à cinq rangs avec un
espacement fixe de 150 ms, confirmant la stabilité mais laissant environ
600–800 ms de latence visible. La version 1.0.7 remplace ce délai arbitraire par
deux accusés natifs : le niveau de base doit progresser exactement de `+1` et
la stat 5 des points disponibles, lue par `STATLIST_GetUnitBaseStat` au RVA
`0x002F48C0`, doit réellement diminuer. Dès que les deux sont visibles, la
validation et le paquet suivants partent au prochain tick de 20 ms. Le getter
possède l'ABI prouvée `(unit, statId, uint16 layer)` et une signature stricte de
15 octets. DLL dépôt/runtime global SHA-256
`7E710703415086407AA9C43298E0DA4152ABBDB11F7A410BBF99065D8E05A1FB`;
ZIP SHA-256
`493AF0135EDD21DCF7884951904AD408846564CB25658B12C5DBDA2B1A9E83F8`.
Dans BKVince, `DurabilityResistance` intercepte déjà ce getter. La validation
accepte donc soit le prologue natif exact, soit exclusivement le trampoline
D2RLoader à deux étages — `JMP rel32` vers un relais voisin, puis
`JMP [RIP+0]` absolu — dont les dix octets natifs non remplacés restent exacts
et dont la cible finale appartient à `DurabilityResistance.dll`; tout autre
patch est refusé.

## DLL autonome compatible PluginPack 1.1.0 du 22 juillet 2026

Le plugin demeure une DLL RuffnecKk distincte. Il ne lie, ne modifie et ne
redistribue aucune DLL d'eezstreet. La destination logique d'une intégration
future est `plugin-misc`, conformément au découpage retenu pour le
CommunityPack.

La configuration TOML individuelle est remplacée par
`BulkSkillPointAllocation.json`. Comme ce fichier ne configure qu'un plugin,
ses clés `skillPointsPerCtrlClick` et `diagnostics` sont directement à la
racine, sans section artificielle `misc`. Le lecteur suit le modèle eezstreet :
JSON avec commentaires, recherche prioritaire dans le dossier du mod actif,
puis repli dans le dossier du jeu. Une configuration absente emploie les
valeurs par défaut; une configuration présente mais invalide fait refuser le
chargement. Lors d'un merge accepté, les clés pourront être intégrées au format
retenu par `plugin-misc` dans `D2RPlugins.json` sans modifier leur sémantique.

La compatibilité a été auditée contre le dernier commit officiel
D2RL-Plugins 2.0.1, `dc75b49ffbb67b887d7757ee00ee9a03bcde5d8a` : aucun
des cinq modules n'écrit les trois hooks BulkSkill. Le cold-start BKVince charge
les cinq DLL du PluginPack, puis
`BulkSkillPointAllocation.dll` en portée globale avec son JSON mod-local :
`active=17`, `rejected=0`, `failed=0` et démarrage `24/24`. Les 19 échecs de
patches globaux sont des doublons d'entrées déjà appliquées en portée mod et ne
concernent pas cette coexistence. Un second cold-start place BulkSkill en portée
mod-local dans le même dossier que les cinq DLL eezstreet; la copie globale est
neutralisée par l'identifiant du plugin, les six DLL coexistent avec
`active=17`, `rejected=0`, `failed=0` et un second démarrage `24/24`.

- test de politique : réussi;
- compilation Release x64 : réussie;
- DLL dépôt/runtime SHA-256 :
  `0C784A408D9DE8504494D70042CDDF9C8822058FDAF0A67EA836E1A8C3524440`;
- JSON dépôt/runtime SHA-256 :
  `A13FF8A6962198C29E1766D2281746C4FB05BC07030BABC725E420F16AEFC442`;
- ZIP DLL + JSON SHA-256 :
  `BB6B4F39F75EF25FC81AE22E9D4E96204D46C3BF889C0732EE956E02D2C9A2A0`.

## Confirmation Diablo native 1.2.0 du 22 juillet 2026

Le chemin Stat natif a été reconstruit dans le workbench 92777. La fonction
`0x014EF670` construit un `ConfirmationModal` avec le prompt localisé, les
libellés natifs `Yes` et `No`, puis deux messages de réponse indépendants. Le
constructeur générique appelé à `0x00847C40` reçoit le prompt, les deux libellés,
les deux charges utiles et un booléen d'affichage. Le resolveur de chaîne par
clé est `0x005F4B90`.

BulkSkillPointAllocation appelle le constructeur Stat avec un widget minimal
dont l'index porte une sentinelle privée. Pendant ce seul appel, le hook strict
du resolveur remplace `AssignAllStatPointsConfirmation` par la valeur UTF-8 de
`BulkSkillPointAllocation.strings.json`. Les boutons restent entièrement
localisés par Diablo. Le premier essai qui interceptait le gestionnaire final
des stats à `0x014E9DC0` n'a volontairement rien attribué : lorsque seul
l'arbre Skill est ouvert, aucun panneau Stat n'est abonné à ce message.

La version finale intercepte donc le dispatcher UI commun `0x00843D90`. Elle
laisse traverser tous les messages ordinaires et ne consomme que la charge utile
portant sa sentinelle. `Yes` récupère alors le skill mémorisé et envoie la
requête assign-all native; `No` ne contient pas cette sentinelle et n'envoie
aucun paquet. Cette
approche évite tout `MessageBoxW`, n'arrête pas le rendu et ne dépend pas de la
présence du panneau Stat.

Validation en jeu par Vincent : le modal Diablo s'affiche, le jeu ne gèle plus
et `Yes` attribue bien les points de compétence en bulk. Le cold-start BKVince
avec les cinq DLL du PluginPack accepte les trois hooks stricts
`0x005F4B90`, `0x00843D90` et `0x000EC700`, charge la version 1.2.0 avec
`rejected=0`, `failed=0`, puis atteint les 24/24 étapes de démarrage.

- DLL build, dépôt, globale et mod-locale identiques, SHA-256
  `596562160B56598468211B67C8DA48B7265E7EB2A6C84F7A9C23BFDF18B58B88`;
- JSON gameplay dépôt/runtime identiques, SHA-256
  `904B477B624F6A0A7B1BB34BB6AE59F0A7B746F4F59C5D1E0FB14A690166E4F3`;
- JSON de chaîne dépôt/runtime identiques, SHA-256
  `C2BD6D856DC19E67533EA622E803320588C827DADBCB964791AB772B8F8F54D0`;
- ZIP DLL + deux JSON, sans README, SHA-256
  `1A1483CBAC9F2122144BBBDA80B975F41405DE7F2B951A2ADBEF94CFC1BBEA98`.

## Bulk natif instantané 1.2.1 du 22 juillet 2026

L'observation visuelle de Vincent a révélé que Shift n'exécutait pas la file
mono-rang décrite initialement : son premier paquet `0x3B`, portant
`extra = 0xFFFF`, attribuait déjà tous les rangs en une opération. La file ne
faisait ensuite que constater un saut supérieur à `+1` et s'arrêter. Cette
preuve fonctionnelle invalide l'ancienne conclusion selon laquelle les deux
derniers octets du paquet n'avaient aucune sémantique bulk.

Le chemin Stat à `0x014E9F4D` encode lui aussi une quantité sous la forme
`total - 1`. La 1.2.1 applique ce même encodage au paquet Skill : une
configuration Ctrl de 5 envoie `extra = 4`, tandis que Shift confirmé conserve
`0xFFFF`. Vincent a validé en jeu qu'un seul Ctrl + clic attribue instantanément
exactement cinq points, sans progression visuelle 1→2→3→4→5.

Après cette validation, toute la file de secours a été retirée : plus de timer,
polling, worker, accusés client, boucle de rangs ni rafale réseau. Chaque action
bulk émet exactement un paquet natif, et le serveur reste responsable de toutes
les règles gameplay. Les signatures strictes conservées concernent uniquement
le builder `0x000EC700`, le resolveur de texte `0x005F4B90`, le dispatcher UI
`0x00843D90`, le constructeur modal appelé `0x014EF670` et la lecture Ctrl
`0x0120A100`.

- DLL build, dépôt, globale et mod-locale identiques, SHA-256
  `685BDB509B8AF0DDE0841D96C3B17051602759A9F6EE95ED7CBD9F719C233115`;
- JSON gameplay dépôt/runtime identiques, SHA-256
  `6468BD071E204477C5B06B7C85E963EDFB9D994170C6D4FBADBA237C840F062B`;
- JSON de chaîne dépôt/runtime identiques, SHA-256
  `C2BD6D856DC19E67533EA622E803320588C827DADBCB964791AB772B8F8F54D0`;
- ZIP DLL + deux JSON, sans README, SHA-256
  `603BE3C1C523630ED807AD7BCC2D7AB16A54E4EF7BF825B3523F17A010DD1933`.

## Localisation native 1.2.2 du 22 juillet 2026

Le retour du testeur coréen a démontré que la 1.2.1 ne localisait pas réellement
le prompt : `BulkSkillPointAllocation.strings.json` contenait une phrase UTF-8
littérale, donc Diablo affichait toujours cette phrase quelle que soit la langue
active. La 1.2.2 remplace ce comportement par une résolution native. Pendant la
construction du modal, le hook demande maintenant la clé configurable
`shiftConfirmation` au resolveur `LANG_GetStringByKey` à `0x005F4B90`. Diablo
sélectionne alors automatiquement `enUS`, `koKR` ou toute autre locale déclarée
dans le `data/local/lng/strings/ui.json` du mod actif.

Le fichier de chaînes expose `shiftConfirmationKey` et documente les chemins
runtime/source ainsi qu'un exemple d'entrée `ui.json`. Une phrase anglaise
`shiftConfirmationFallback` n'est utilisée que si la clé est absente, vide ou
retournée telle quelle par le resolveur. Les libellés Yes/No demeurent entièrement
natifs. Compilation Release, test de politique 1/1, trois exports, métadonnée
1.2.2 et cold-start 24/24 réussis; les trois hooks stricts sont acceptés,
`rejected=0` et `failed=0` côté plugins.

- DLL build, dépôt, globale et mod-locale identiques, SHA-256
  `3393D4EC5E35B6887E1ABB693F496276449AA0BD5833DF54AD60B7C2F8DFBBC7`;
- JSON gameplay dépôt/runtime identiques, SHA-256
  `6B205C7490CB87FA5318405D57B987C919F3719B9E7C5C8A749A01D05685B09A`;
- JSON de chaîne dépôt/runtime identiques, SHA-256
  `A47DE4EE2E4E75E247A0D0E20E04FECEE5841F413B302DB9FC5FA69EF145CDCE`;
- ZIP DLL + deux JSON, sans README, SHA-256
  `53A94D27C524D8EC025D00EEAA99317D3FAAA6FB969CE21EC0E99BEB7F5642CF`.

## Gate fonctionnel restant

La livraison technique ne remplace pas l'essai gameplay. Il reste à vérifier en
jeu : clic normal; Ctrl avec lots 1/5/10 et moins de points que le lot; Shift
accepté et annulé; Ctrl+Shift; plafonds 20/25/30; coûts `SkPoints` supérieurs à
1; classe, prérequis, niveau requis et attributs invalides; souris/clavier;
solo, hôte et joiner; sauvegarde/rechargement; absence de dépense excédentaire,
duplication, rafale, crash ou désynchronisation.
