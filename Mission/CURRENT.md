# Mission courante

Dernière mise à jour : 24 juillet 2026

## Priorité active

[Configurable Larzuk Sockets — D2R 3.2.92777](configurable-larzuk-sockets-3.2.md)

État : l’instruction explicite `start` de Vincent remplace le séquencement
Option B antérieur. Le chemin serveur Larzuk, la difficulté, les qualités, les
plafonds et le setter de sockets sont prouvés. Le prototype autonome
`LarzukSockets 0.1.0` compile en Release x64, son test de politique passe et son
JSON conserve le comportement vanilla par défaut. Il n’est pas encore déployé
ni validé en jeu, et aucune archive publique n’existe.

## Prochain gate

Fixer les valeurs réelles `minSockets`/`maxSockets` des 15 combinaisons
difficulté × qualité, activer un témoin, puis exécuter la matrice runtime Larzuk
avec logs frais et contrôles de consommation de quête, plafond légal et
coexistence.

Gates suivants :

- valider Normal, Nightmare et Hell pour magic, rare, set, unique et crafted;
- tester valeur exacte et plage inclusive sur plusieurs bases et `ilvl`;
- valider Infinite Larzuk, solo/hôte/joiner et les portées globale/mod-locale;
- ne préparer aucun ZIP avant absence prouvée de valeur illégale, perte,
  duplication, crash ou désynchronisation.

## Frontière Git

Le lot Larzuk comprend sa mission, `LarzukSockets-src`, la DLL autonome, son
JSON, les preuves RVA gouvernées, le registre de workstreams, le cadastre et les
fragments associés de la ROADMAP. Il ne doit intégrer aucun fichier d’une DLL
d’eezstreet; `plugin-quests.dll` demeure seulement la destination du merge
futur.

Ne pas mélanger sans checkpoint explicite les chantiers concurrents suivants :

- Extended Item Stats;
- Advanced Item Tooltips;
- Qty Display Issue;
- Ground Item Label Limit;
- toute évolution indépendante de `Transmogrify`.

Ce fichier est un pointeur opérationnel. Les preuves, décisions et gates
détaillés demeurent dans la mission liée et dans `ROADMAP.html`.
