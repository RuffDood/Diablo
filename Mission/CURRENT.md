# Mission courante

Dernière mise à jour : 23 juillet 2026

## Priorité active

[Extended Item Stats — D2R 3.2.92777](extended-item-stats-3.2.md)

État : prototype `0.3.0` validé dans le personal stash à la souris. Le transport
atteint le plafond configuré de 4096 octets et 1019 stats. La scrollbar, le mode
épinglé et le dernier segment du tooltip ont été confirmés en jeu. Le chantier
n'est pas livré et aucune archive publique n'existe.

## Prochain gate

Mesurer l'overflow depuis la hauteur réellement disponible dans l'interface,
selon la résolution et l'échelle UI, puis prouver que le tooltip vanilla reste
inchangé lorsqu'il tient et que le mode étendu s'active seulement lorsqu'il
déborde.

Gates suivants :

- valider les commandes à la manette;
- valider le renderer DirectX 12 autonome sans `FloatingDamage`;
- poursuivre la matrice de cycle de vie et les tests solo/hôte/joiner;
- valider la portée globale avant toute livraison.

## Frontière Git

Le lot Extended Item Stats comprend sa mission, ses sources, sa DLL, son JSON,
ses fixtures et preuves gouvernées, ainsi que les fragments associés de la
ROADMAP, du cadastre et du registre RVA. `FloatingDamage` et `Transmogrify` ne
doivent y entrer que pour leurs changements de coexistence directement requis
par ce prototype.

Ne pas mélanger sans checkpoint explicite les chantiers concurrents suivants :

- Advanced Item Tooltips;
- Qty Display Issue;
- Ground Item Label Limit;
- toute autre évolution indépendante de `FloatingDamage` ou `Transmogrify`.

Ce fichier est un pointeur opérationnel. Les preuves, décisions et gates
détaillés demeurent dans la mission liée et dans `ROADMAP.html`.
