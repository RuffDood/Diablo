# PotionAutoPickup — portage BKVince D2RLoader 3.2

## Décision

Option B retenue le 18 juillet 2026 : porter directement l’autopickup 2.4 en routeur configurable de toutes les potions pour BKVince sous `D2R.exe 3.2.92777`.

La référence fonctionnelle est le source local `C:/Workspaces/D2RHUD-2.4-TCP/rejuvenation-autopickup/dllmain.cpp`. Ses RVA, signatures et layouts 2.4 ne sont que des indices et ne doivent jamais être activés dans le runtime 3.2.

## Contrat fonctionnel

Chaque famille possède sa propre politique :

- Healing : sélection indépendante de `hp1`, `hp2`, `hp3`, `hp4`, `hp5`;
- Mana : sélection indépendante de `mp1`, `mp2`, `mp3`, `mp4`, `mp5`;
- Rejuvenation : sélection indépendante de `rvs` et `rvl`;
- colonnes de belt ordonnées et indépendantes par famille;
- overflow vers l’inventaire indépendant par famille;
- priorité configurable entre familles et entre tiers;
- distance et cadence de scan globales;
- objet laissé au sol si aucune destination autorisée n’est libre.

Le preset BKVince initial réserve la colonne 1 aux Greater/Super Healing, la colonne 2 aux Greater/Super Mana et les colonnes 3–4 aux deux Rejuvenation. Seules les Rejuvenation débordent vers l’inventaire.

## Architecture cible

1. Un cœur de routage pur associe le code d’item à une famille et à un tier, applique la politique et choisit une destination.
2. Une couche D2RLoader lit `PotionAutoPickup.toml`, journalise les refus et installe uniquement des hooks natifs prouvés pour le build 92777.
3. L’adaptateur runtime parcourt les items serveur au sol, contrôle distance/collision et appelle le chemin vanilla de pickup.
4. Le sélecteur de belt respecte la hauteur réelle de la ceinture, les colonnes autorisées et la famille déjà présente dans une colonne.

## Gate de sécurité

- plugin mod-local avec identifiant interne `potion-auto-pickup`, nom `PotionAutoPickup` et drapeaux `ModScopedOnly | NativeHooks`;
- signatures `expected` vérifiées par D2RLoader avant chaque hook;
- aucun RVA 2.4 recopié sans correspondance démontrée dans le build 92777;
- activation atomique : si une cible obligatoire manque, aucun hook gameplay ne reste actif;
- aucune écriture dans les tables `.txt` n’est nécessaire au portage.

## Matrice de validation

- chacun des 12 codes seul puis en mélange;
- activation/désactivation et ordre de priorité par famille;
- chaque combinaison de colonnes 1–4 avec ceintures de 1 à 4 rangées;
- colonne vide, compatible, incompatible et pleine;
- overflow actif/inactif par famille, inventaire libre/partiel/plein;
- distance limite, collision, plusieurs potions à distance égale;
- souris, manette, solo, hôte et joiner;
- retour menu/reconnexion/déchargement;
- absence de duplication, perte, crash et désynchronisation.
