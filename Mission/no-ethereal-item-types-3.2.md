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

## Validation requise

1. Tests unitaires : normalisation, padding des codes courts, résolution par
   stride, limites et codes absents.
2. Validation statique : signature 92777, exports et manifeste DLL.
3. Cold start D2RLoader : plugin accepté, autres patches/plugins inchangés,
   zéro assertion ou crash.
4. Matrice en jeu : type précis, parent, descendant non ciblé, normal/magic/
   rare/set/unique/crafted, drop naturel, vendeur, gamble, Cube forcé éthéré,
   `ALWAYSETH`, solo, hôte/joiner, sauvegarde et rechargement.
5. Vérifier que le taux BKVince de 6 % et les sets éthérés restent actifs pour
   les familles non exclues.
