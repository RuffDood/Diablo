# Findings persistants — D2R 3.2.92777

Ce document conserve uniquement les conclusions utiles aux prochaines sessions.
Les sorties volumineuses demeurent sous `analysis-cache/corpus/`.

## Base d'analyse

- Image canonique gouvernee : SHA-256
  `CC59119DC2A6C7D43D088098FC162EAFA4AE1299B2079126AEF43C1ACA914715`.
- Image d'analyse deterministe : SHA-256
  `673E8C0B2E89563E75525B24D137098EFD07B2DB4ED42ADEC56AA1ADDF0E63AB`.
- Le `.text` de l'image canonique est preserve. Les metadonnees PE non-code
  rehydratees rendent 105 850 fonctions x64 accessibles par `.pdata`.
- L'index compact connait actuellement plus d'un million de references code ou
  RIP, les chaines des sections de donnees et les patches BKVince actifs.

## Routine de quantite des Books

- `0x5817BD` charge le delta `-1` apres le controle du type `Book` (`0x12`).
- L'appel a `0x46F090` part de `0x5817CC`; l'index retrouve six callers directs
  de cette routine centrale.
- `0x46F090` synchronise `STAT_QUANTITY` et la quantite du skill lie au
  scroll/tome.
- `0x47145D` est un chemin Javelin (`0x29`) rejete pour les tomes;
  `0x4F5849` est egalement un faux candidat conserve vanilla.

Commandes de reprise :

```powershell
npm run re:d2r32 -- function 0x5817BD
npm run re:d2r32 -- xrefs 0x46F090
```

## pSpell et consommables a skill

- La structure officielle partagee de D2RL-Plugins place `pSpell` a l'offset
  `+0x94` de l'enregistrement item.
- La documentation D2R 3.2 expose des handlers `pSpell` fixes; elle n'expose pas
  un handler generique prenant directement un ID arbitraire de skill.
- `books.txt` associe `ScrollSkill`/`BookSkill`; le `srvdofunc 113`
  `ItemDoBookSkill` utilise le skill du Book/Scroll et met sa quantite a jour.
  Cette voie constitue le prototype data-only prioritaire.
- Le pack officiel `plugin-skills` intercepte deja la consommation native des
  charges a `0x436830` (`D2GAME_SKILLMANA_Consume`). C'est la fondation prouvee
  pour un plugin exact si le clic droit inventaire arbitraire reste requis.
- Les fonctions autour de `0x1AC881`, `0x1AC8F0` et `0x1AC932` lisent bien le
  champ `+0x94`, mais leur role de dispatcher d'utilisation n'est pas prouve.
- Les routines autour de `0x1A7660`/`0x1A77D0` testent une borne `< 16` et sont
  des candidates possibles pour une table de handlers; confiance faible tant
  que callers, arguments et effets ne sont pas etablis.

Sortie brute conservee :
`analysis-cache/corpus/pspell-2026-07-19/pspell-analysis.txt`.

Prochaine etape efficace : partir des xrefs de l'acces `D2ItemsTxt+0x94`, puis
remonter depuis l'evenement serveur d'utilisation d'objet. Ne pas relancer un
scan global du `.text` avant d'avoir epuise l'index et le projet Ghidra.

## Discipline de promotion

Une adresse n'entre dans `known-rvas.json` qu'apres preuve par structure de
controle, octets/signature, caller/callee ou validation runtime. Les simples
ressemblances et les anciennes adresses 2.4 restent dans cette page avec une
confiance explicite.
