# Mercenary Command — D2RLAN 2.4

Intégration runtime locale de la compétence `Command` pour `D2R.exe 1.2.69270.0`.

- `MercenaryCommand.dll` implémente `srvdofunc 155` et déplace uniquement le mercenaire vivant contrôlé par le joueur.
- `D2RHUD-Loader.exe` charge le D2RHUD officiel, ignore proprement les modules optionnels absents, puis charge `MercenaryCommand.dll` et `RejuvenationAutoPickup.dll` lorsqu'ils sont présents.
- Le module refuse de s'activer si la version ou les signatures attendues du binaire ne correspondent pas.
- Le pointeur original de la table des fonctions serveur est restauré au déchargement.

Déploiement actif : `C:\Games\D2RLAN\Launcher`.

Le `D2RHUD.dll` officiel n'est pas remplacé par ce paquet.

SHA-256 :

- `D2RHUD-Loader.exe` : `D23D350515A3EA2BD7F3B3E664B39B16CD667E6B25F6C8510B71895BF7305D3A`
- `MercenaryCommand.dll` : `AA2D4BBBF860A04974358CFC035AA92B74B124A5D567E9F16CF045783CDA85B6`
