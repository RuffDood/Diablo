# Charm inventory auras — portage D2R 3.2

## État

Implémenté pour `D2R.exe 3.2.92777` sous forme de plugin natif D2RLoader.
Compilation, tests unitaires, signatures statiques et synchronisation runtime
validés. Le maintien de l'aura et du `oskill` sélectionné pendant les
transitions de zone a été validé en jeu par le testeur. La réactivation après
récupération du cadavre par le simple rattachement 1.4.0 a échoué en jeu. La
version 1.5.0 emploie maintenant la séquence native complète
expiration/rattachement et reste à valider en jeu.

## Source 2.4

- Fichier fourni : `C:/Users/Vincent Barrière/Downloads/charm_auras.json`
- SHA-256 : `FFB9FDCE3E8CF813929A27A3E46D87A102000ED0084565133A1D1E35A91DD963`
- Build source vérifié : `D2R.exe 1.2.69270`
- Hook : appel à `0x2EC080` au RVA `0x2A041F`, retour `0x2A0424`
- Cave : `0x149B2B1`, 253 octets

La cave appelle d'abord la routine vanilla, parcourt l'inventaire, conserve au
maximum 32 charms identifiés dont `ItemData[0xB8] == 3`, remet à zéro le
propriétaire de leur liste de stats, puis appelle `STATLIST_MergeStatLists` avec
le joueur et le mode `1`.

Le byte `ItemData[0xB8]` est la position de grille interne `nNodePos`, pas
`InvPage`. La valeur `3` désigne la grille d'inventaire visée par le patch 2.4 ;
les valeurs historiques `6` et `7` excluent notamment cube et coffre. Le champ
est toujours à `ItemData + 0xB8` dans le build 92777.

## Correspondances prouvées en 3.2.92777

| Rôle | 2.4 | 3.2 | Preuve |
|---|---:|---:|---|
| appel de transition ciblé | `0x2A041F` | `0x486AE0` | même préparation `game/player/acts`, appel unique `E8 1B C2 07 00` |
| routine de transition | `0x2EC080` | `0x502D00` | contrôle de flux et constantes de changement d'acte équivalents |
| obtenir l'inventaire | `0x208330` | `0x34A360` | résolution de pointeur identique, champs `+A0/+98/+90` |
| premier item | lecture `inventory+0x10` | `0x388C10` | validation de l'en-tête `0x01020304`, puis lecture `+0x10` |
| item suivant | lecture `ItemData+0xB0` | `0x38ABA0` | type item, `GetItemData`, puis lecture `+0xB0` |
| données item | lecture `item+0x10` | `0x34A500` | accesseur qui retourne `item+0x10` |
| type charm `0x0D` | `0x1FE680` | `0x373890` | LUT native d'héritage `itemtypes`; ligne 13 = `Charm/char` |
| liste de stats | lecture `item+0x88` | `0x34B870` | accesseur qui retourne `item+0x88` |
| fusion de listes | `0x1E5EA0` | `0x2F81A0` | propriétaire en `StatList[0]`, flag `0x40000000`, même branche de rattachement |
| liste de compétences | — | `0x34B6E0` | compétences actives gauche/droite à `+0x08/+0x10` |
| restaurer compétence gauche | — | `0x33EC70` | résolution canonique par `(skillId, ownerGUID)` puis stockage à `+0x08` |
| restaurer compétence droite | — | `0x33EF10` | résolution canonique par `(skillId, ownerGUID)` puis stockage à `+0x10` |
| obtenir propriétaire statlist | — | `0x2F8120` | retourne le propriétaire étendu et le mode de rattachement d'un item |
| expirer une statlist d'item | — | `0x2F8290` | étape canonique appelée avec `(player, item)` avant chaque nouvelle fusion |
| rafraîchir les statlists du joueur | — | `0x46F220` | sauvegarde ressources/compétences, expire et fusionne les items possédés, puis restaure l'état |
| succès de récupération du cadavre | — | `0x4B3594` | séquence unique après transfert et suppression du corps, retour `0x4B35A6` |
| attacher le son de succès | — | `0x491960` | hook filtré par retour `0x4B35A6` et son `0x64` |

Le site `0x486AE0` retourne à `0x486AE5`. La routine `0x502D00` possède un
second appelant (`0x488228`) qui n'appartient pas au chemin du patch 2.4 ; le
plugin filtre donc explicitement l'adresse de retour `0x486AE5`.

## Implémentation

- Source : `data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/`
- Runtime : `data-BKVince/d2rloader/plugins/CharmInventoryAuras.dll`
- Archive publique sans guide : `addons/CharmInventoryAuras/CharmInventoryAuras.zip`
- ID : `charm-inventory-auras`
- Commande : `charm-inventory-auras`
- Version : `1.5.0`
- Auteur : `RuffnecKk`
- Flags : `0x2` (`NativeHooks` uniquement, sans `ModScopedOnly`)
- SHA-256 DLL Release x64 : `3B3ECBA1C7F5C6A9BC9345E2452BEAA1D95208D6F718F2F0C3B163B614D82041`
- SHA-256 ZIP : `727CF1DED8979A8FD7497E4BA2BD8E4A8CF833E210346C69F3D0DA1322172B6F`

Le plugin hooke l'entrée de `0x502D00` pour les transitions et `0x491960` pour
la reprise du cadavre. Il appelle toujours les routines originales en premier,
puis reproduit le parcours et la limite de 32 charms du patch 2.4 lors des
transitions. Le second hook ne déclenche le rafraîchissement natif complet des
statlists du joueur qu'après la séquence de succès unique qui retourne à
`0x4B35A6`; un clic échoué ne fait donc rien. Le plugin refuse l'installation si
le build déclaré n'est pas 92777 ou si une signature de fonction, de séquence
expiration/fusion, de slot de compétence ou de call-site ne correspond pas.

## Validation effectuée

- workbench persistant : image et index vérifiés ; aucun redump ni réimport ;
- compilation MSVC Release x64 réussie ;
- test `charm-inventory-auras-policy` réussi ;
- `itemtypes.txt` BKVince : ID `13` confirmé comme `Charm` / code `char` ;
- appel 3.2 `0x486AE0` : signature `E8 1B C2 07 00` unique ;
- runtime BKVince démarré à froid le 2026-07-19 ;
- journal `charm-inventory-auras.log` : hook natif installé à `0x502D00`, puis
  `CharmInventoryAuras 1.0.0 active for D2R 3.2.92777` ;
- DLL source et runtime : SHA-256 identiques ;
- aucune réutilisation aveugle des RVA 2.4.

## Distribution hybride 1.1.0 (20 juillet 2026)

La DLL ne declare plus `PluginFlags::ModScopedOnly` et conserve
`PluginFlags::NativeHooks`. Le meme binaire peut donc etre charge depuis le
dossier global `d2rloader/plugins` ou depuis le dossier local d'un mod. La
configuration et les journaux suivent le contexte fourni par D2RLoader.

- SHA-256 DLL Release x64 : `88369499AAE32EA008162FF4DB45D6E37D098B4029070ABBA1A3639958CB8325`
- SHA-256 ZIP : `374471FF207E9D755AA66DF094ABFC92B181A84FD13327C64E2D3C8710137F0B`
- archive : DLL seule, sans README ni sources
- compilation Release, test de politique et exports D2RLoader valides

## Correctif oskill 1.2.0 retiré (20 juillet 2026)

Une preuve vidéo fournie par Vincent montre qu'un `oskill` sélectionné devient
le X rouge immédiatement après une transition de zone. La cause est le
rattachement intégral de la liste de stats de tous les charms identifiés : il
rejoue `item_nonclassskill` alors que le plugin ne voulait réactiver que
`item_aura`.

La version 1.2.0 inspecte les stats de base compilées du charm, dont le tableau
se trouve à `StatList + 0x30` sur le build 92777 avec des records de 8 octets.
Elle ne rattache que les charms contenant réellement la stat 151 `item_aura`.
Les charms sans aura restent intacts. Un charm combinant `item_aura` et la stat
97 `item_nonclassskill` est ignoré par sécurité afin de ne pas invalider
l'oskill sélectionné ; son aura demeure donc un cas limite à valider ou à
traiter ultérieurement par une routine encore plus ciblée. Cette exclusion
était un contournement incomplet et a été supprimée dès la version 1.3.0.

- version embarquée vérifiée par `D2RLoaderGetPluginInfo` : `1.2.0`
- flags embarqués : `0x2` (`NativeHooks` uniquement, sans `ModScopedOnly`)
- SHA-256 DLL Release x64 : `53E0C0B3912FF53276570F6DDEED42B59CFF90AB7A18618157AAB23133DC627C`
- SHA-256 ZIP : `0322464A9E26298431B474241B3C191768DA9A3943CC53D147DDAA2D9873B0A8`
- archive vérifiée : DLL seule, byte-identique au runtime
- compilation Release et test de politique réussis

## Préservation complète aura + oskill 1.3.0 (20 juillet 2026)

La version 1.3.0 ne saute plus aucun charm combinant `item_aura` et `oskill`.
Avant le rattachement, elle capture les compétences actives gauche et droite
sous forme de couples `(skillId, ownerGUID)`. Après la fusion, elle utilise les
routines canoniques `0x33EC70` et `0x33EF10` pour retrouver les nouvelles
instances et restaurer les deux slots.

Le testeur a confirmé en jeu que l'aura demeure active et que le `oskill`
sélectionné reste équipé pendant les transitions de zone.

## Réactivation après récupération du cadavre 1.4.0 (20 juillet 2026)

Le chemin serveur de récupération du cadavre est intégré dans le grand
dispatcher d'interaction du joueur. La branche de succès transfère les objets,
retire le corps de la liste, le supprime du monde et appelle ensuite
`SUNIT_AttachSound` avec le son `0x64`. Cette séquence de 18 octets est unique à
`0x4B3594` et retourne à `0x4B35A6`.

La version 1.4.0 hooke `SUNIT_AttachSound` à `0x491960`, laisse la routine
vanilla terminer, puis rafraîchit les auras seulement lorsque l'adresse de
retour, le son et les deux pointeurs joueur correspondent au succès de reprise.
Elle réutilise exactement la logique aura/+oskill validée en 1.3.0.

- compilation MSVC Release x64 réussie ;
- test `charm-inventory-auras-policy` réussi ;
- version/flags vérifiés : `1.4.0`, `0x2` ;
- auteur embarqué : `RuffnecKk` ;
- ZIP : DLL seule, byte-identique au runtime ;
- validation gameplay : échec, l'aura demeure inactive jusqu'au retrait/remise
  manuel du charm. Le point d'accroche est conservé, mais le rattachement
  partiel ne reproduit pas l'expiration de la statlist étendue.

## Expiration et fusion natives après cadavre 1.5.0 (20 juillet 2026)

L'analyse du chemin canonique D2R à `0x46F220` a isolé l'étape absente de la
version 1.4.0. Le moteur appelle `STATLIST_GetOwner` (`0x2F8120`), puis
`STATLIST_ExpireUnitStatlist` (`0x2F8290`) et enfin
`STATLIST_MergeStatLists` (`0x2F81A0`) pour chaque item possédé. Il encadre cette
boucle par une sauvegarde/restauration des ressources et compétences actives.

La version 1.5.0 appelle cette routine native complète après le succès confirmé
de récupération du cadavre. Cela reproduit le détachement/rattachement réel que
le retrait et la remise manuels du charm provoquaient. Le chemin de transition
validé en 1.3.0 reste inchangé.

- compilation MSVC Release x64 réussie ;
- test `charm-inventory-auras-policy` réussi ;
- version/flags vérifiés : `1.5.0`, `0x2` ;
- auteur embarqué : `RuffnecKk` ;
- ZIP : DLL seule, byte-identique au runtime ;
- validation gameplay : en attente.

## Validation en jeu restante

1. Mourir avec un charm identifié portant `item_aura` dans l'inventaire
   principal, puis reprendre le cadavre.
2. Confirmer que l'aura revient sans retirer/remettre le charm.
3. Avec un charm combinant aura + `oskill`, confirmer aussi que la compétence
   sélectionnée demeure valide.
4. Vérifier que la commande `charm-inventory-auras` incrémente
   `corpse recoveries` et `native corpse refreshes` une seule fois.
5. Confirmer qu'un clic de reprise échoué n'incrémente pas le compteur.
