# Workbench D2R 3.2.92777

Ce workbench est le point de depart obligatoire pour tout nouveau memory patch
ou plugin natif visant `D2R.exe 3.2.92777`. Il evite de redumper, reimporter et
rescanner le meme binaire a chaque conversation.

## Demarrage rapide

Depuis la racine du depot :

```powershell
npm run re:d2r32 -- status
npm run re:d2r32 -- self-test
npm run re:d2r32 -- known tome
npm run re:d2r32 -- function 0x5817BD
npm run re:d2r32 -- xrefs 0x46F090
npm run re:d2r32 -- bytes "41 B9 ?? ?? ?? ??"
```

`function` desassemble uniquement la fonction concernee a partir de la table
d'exception x64; il repond en quelques secondes et produit une sortie compacte.
`xrefs` utilise un index SQLite construit une seule fois. `known` interroge les
RVA gouvernes, les patches D2RLoader et les missions existantes.

Pour une decompilation plus riche :

```powershell
npm run re:d2r32:ghidra -- status
npm run re:d2r32:ghidra -- function 0x441B10 180
```

Le projet Ghidra importe une seule fois le `.text` brut a sa vraie base. Chaque
commande `function` desassemble et decompile uniquement la fonction demandee,
puis conserve ce travail dans le projet. Utiliser l'index compact `xrefs` pour
les references globales; les xrefs Ghidra ne couvrent que les fonctions deja
analysees paresseusement.

## Initialisation ou nouveau poste

```powershell
npm run re:d2r32:init -- -ImagePath "C:\chemin\D2R-3.2.92777-decrypted.exe"
npm run re:d2r32:ghidra-import
```

L'initialiseur refuse toute image dont la taille ou le SHA-256 differe du
manifeste. Pour un futur build D2R, creer un nouveau dossier et un nouveau
manifeste; ne jamais remplacer silencieusement l'image 92777.

## Contenu local non versionne

`analysis-cache/` contient :

- `images/` : reconstruction PE canonique et dechiffree;
- `index/d2r32.sqlite` : fonctions, xrefs, chaines, patches et references JSON;
- `ghidra/` : projet analyse persistant;
- `corpus/` : resultats intermediaires des recherches precedentes;
- `references/` : snapshots locaux des sources SDK/plugins utiles.

Le fichier [workbench.json](workbench.json) epingle le build, les hashes de
sections et les noms de projet. [known-rvas.json](known-rvas.json) ne contient
que des identifications suffisamment prouvees; les hypotheses doivent rester
marquees `low` tant qu'elles ne sont pas validees.

[findings.md](findings.md) est le relais humain compact entre les sessions : il
resume les preuves deja acquises, les hypotheses rejetees ou encore ouvertes et
la prochaine requete utile. Le consulter avant les corpus bruts evite de payer
a nouveau leur lecture complete.

Deux images locales sont volontairement conservees. L'image `decrypted` garde
le SHA-256 exact deja cite par la mission de portage. L'image `analysis` en est
une derivee deterministe : son `.text` canonique est inchange, tandis que
`.pdata`, `_RDATA` et `.rodata` sont rehydrates depuis le `D2R.exe` installe du
meme build. Cette derivee fournit 105 850 bornes de fonctions x64 exploitables
par l'index. Ghidra recoit ensuite uniquement le `.text` brut et ces bornes de
fonctions, ce qui contourne les imports/TLS volontairement invalides du binaire
protege et evite une analyse globale couteuse.

## Discipline

- Ne jamais committer une image D2R, un projet Ghidra ou la base SQLite.
- Ne jamais reutiliser un RVA sur un autre build sans nouvelle preuve.
- Commencer par `status`, puis consulter `known` et `xrefs` avant tout nouveau
  scan global.
- Ajouter les nouvelles identifications stables a `known-rvas.json` avec leur
  source et leur niveau de confiance.
- Conserver des octets `expected` stricts et valider le comportement en jeu.
