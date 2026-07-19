# Mission — interdire l’éthéré par famille d’item types sous D2R 3.2

## Intention

Permettre à BKVince de déclarer des codes de `itemtypes.txt` qui ne doivent
jamais devenir éthérés. La politique doit être configurable sans recompilation,
comprendre l’héritage natif des types et ne modifier aucun type non sélectionné.

## Contrat fonctionnel

- configuration mod-locale dans
  `d2rloader/config/no-ethereal-item-types.toml` ;
- liste de codes de la colonne `Code` de `itemtypes.txt` ;
- un parent tel que `armo` couvre ses descendants selon la LUT d’équivalence du
  jeu, tandis qu’un type précis tel que `belt` ne couvre que sa famille ;
- l’interdiction est absolue : jet naturel, set autorisé par le patch BKVince,
  sortie Cube forcée éthérée et autre drapeau `ALWAYSETH` ;
- les types absents ou invalides ne doivent jamais être interprétés comme un
  autre type ; le statut runtime expose les résolutions manquantes ;
- refus sûr sur tout build autre que `D2R.exe 3.2.92777` ou toute signature
  incompatible.

## Implantation prouvée

La routine éthérée 92777 teste successivement `ITEMTYPE_WEAPON` puis
`ITEMTYPE_ANY_ARMOR` par `ITEMS_CheckItemTypeId` avant le jet et avant les
drapeaux forcés. Les deux appels reviennent aux RVA `0x004432DA` et
`0x004432E9`. Le helper partagé se trouve au RVA `0x00373890` avec la signature
initiale stricte :

```text
48 89 5C 24 10 48 89 6C 24 18 48 89 74 24 20
```

Le plugin n’altère le résultat du helper qu’à ces deux retours. Les codes sont
résolus dans le conteneur runtime `itemtypes` (`data tables + 0x1348`, compteur
`+0x1350`, stride `0xE8`) puis testés avec le helper original, ce qui conserve
exactement les équivalences du jeu.

## État technique au 19 juillet 2026

- `NoEtherealItemTypes.dll` 1.0.0 compilée en Release x64, taille 36 864 octets,
  SHA-256 `3034D37C2E4D9F3E4BC98B2CDE0E198AD75B6ECBF1A77244E05696E05F4F059B` ;
- tests unitaires de normalisation, padding, résolution et bornes réussis ;
- exports `D2RLoaderGetPluginInfo`, `D2RLoaderLoadPlugin` et
  `D2RLoaderUnloadPlugin` présents, manifeste v2 accepté ;
- DLL et TOML source/runtime byte-identiques ;
- archive partageable `addons/NoEtherealItemTypes/NoEtherealItemTypes.zip`,
  SHA-256 `3A6E46EC8D0ADC9EAAF6BAC915BFAF66E4D789E21976EC613F385D8789371B12`,
  vérifiée avec exactement la DLL et le TOML à la racine, sans README ni
  sources ; les commentaires du TOML public sont intégralement en anglais ;
- cold start sous D2RLoader 1.0.1-beta et build 92777 : hook installé à
  `0x373890`, `20/20 patches`, `8/8 plugins`, `24/24` étapes de démarrage ;
- l’assertion RapidJSON tardive déjà connue se reproduit après le frontend et
  reste indépendante de ce plugin ;
- liste `item_types` volontairement vide tant que Vincent n’a pas choisi les
  familles à activer : le plugin est chargé mais ne change encore aucun drop.

## Validation requise

1. Choisir au moins un code précis et, séparément, un parent pour la validation.
2. Matrice en jeu : type précis, parent, descendant non ciblé, normal/magic/
   rare/set/unique/crafted, drop naturel, vendeur, gamble, Cube forcé éthéré,
   `ALWAYSETH`, solo, hôte/joiner, sauvegarde et rechargement.
3. Vérifier que le taux BKVince de 6 % et les sets éthérés restent actifs pour
   les familles non exclues.
