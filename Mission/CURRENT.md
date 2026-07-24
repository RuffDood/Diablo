# Mission courante

Dernière mise à jour : 24 juillet 2026

## Priorité active

[RemoteStash — D2R 3.2.92777](remote-stash-3.2.md)

État : Vincent a retenu l’Option A le 24 juillet 2026. RemoteStash devient la
priorité immédiate; Configurable Larzuk Sockets reste intacte à son gate de
validation en jeu. La catégorie `misc`, la destination future `plugin-misc.dll`
et la clé `misc.remoteStash` sont confirmées. Le workbench 92777 et la référence
PluginPack épinglée sont vérifiés. Aucun chemin natif d’ouverture du panneau
stash n’est encore prouvé et aucun prototype n’existe.

## Prochain gate

Identifier dans 92777 le producteur serveur et le consommateur client de
l’événement qui ouvre réellement le stash, en partant des 38 callers de
`D2GAME_QueueServerPacket` et de l’interaction avec l’objet; prouver ensuite le
format, la fonction, les callers, l’ABI et les préconditions avant tout hook.

Gates suivants :

- distinguer l’ouverture purement client des éventuels états ou paquets serveur;
- déclencher d’abord le chemin prouvé depuis un contrôle technique minimal;
- reporter sprites, placement final et layouts personnalisés après cette preuve;
- ne préparer aucun ZIP avant validation fonctionnelle et de coexistence.

## Frontière Git

Le lot RemoteStash comprend sa mission, les futures sources/DLL/JSON autonomes,
les preuves RVA gouvernées, le registre de workstreams, le cadastre et les
fragments associés de la ROADMAP. Il ne doit intégrer aucun fichier d’une DLL
d’eezstreet; `plugin-misc.dll` demeure seulement la destination du merge futur.

Ne pas mélanger sans checkpoint explicite les chantiers concurrents suivants :

- Configurable Larzuk Sockets;
- Extended Item Stats;
- Advanced Item Tooltips;
- Qty Display Issue;
- Ground Item Label Limit;
- toute évolution indépendante de `Transmogrify`.

Ce fichier est un pointeur opérationnel. Les preuves, décisions et gates
détaillés demeurent dans la mission liée et dans `ROADMAP.html`.
