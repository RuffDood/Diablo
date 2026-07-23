---
name: d2rloader-plugin-incubation
description: Concevoir, auditer, implanter et emballer un nouveau plugin D2RLoader autonome destiné à une future intégration compatible avec le PluginPack eezstreet. Utiliser ce skill dès qu'une nouvelle DLL native est envisagée, avant toute modification de code, configuration ou archive, puis pour l'audit des ABI/hooks, le JSON autonome, les crédits RuffnecKk et le contenu strict du ZIP public.
---

# Incubation de plugin D2RLoader

## Appliquer le gate de catégorie

1. Classer la fonctionnalité avant toute implantation : `items`, `levels`, `misc`, `quests` ou `skills`.
2. Présenter à Vincent la catégorie et sa DLL propriétaire future, puis attendre sa confirmation explicite.
3. Tant que la confirmation manque, ne modifier ni code, ni configuration, ni archive. Ce gate est bloquant.
4. Après confirmation, consigner dans la mission la catégorie, la DLL future et la clé prévue `categorie.nomFonctionnalite`.

## Auditer avant de coder

1. Pour le build 92777, exécuter le skill `d2r32-reverse-engineering` et franchir son gate `status`.
2. Vérifier la référence PluginPack épinglée, puis inventorier le module propriétaire : fichiers internes, structures partagées, champs, config, callbacks, RVA et plages de hooks.
3. Identifier chaque collision potentielle et désigner un propriétaire unique pour tout hook ou structure canonique.
4. Si une incompatibilité avec le PluginPack est envisagée, avertir explicitement Vincent que le prochain plugin devrait être autonome.
5. Refuser une implantation fondée sur une ABI, une signature ou un build non prouvé.

## Incuber de façon autonome

1. Conserver une DLL autonome attribuée exactement à `RuffnecKk`. Ne pas modifier, lier ni redistribuer une DLL d'eezstreet.
2. Rendre la DLL hybride : installation globale ou mod-locale, sans `ModScopedOnly`, avec les mêmes gardes strictes de build, signatures et ABI dans les deux portées.
3. Rédiger la description du plugin en anglais, en une phrase courte orientée effet joueur, sans build, RVA, hook ni ABI.
4. Utiliser un JSON autonome compatible avec le lecteur du PluginPack, commentaires et contenu en anglais, recherché d'abord dans le mod actif puis dans le dossier global du jeu.
5. Ne créer aucun TOML pour un nouveau plugin incubé.
6. Documenter dès maintenant le merge futur dans la DLL propriétaire et l'unique `D2RPlugins.json`. Après le merge, supprimer la DLL et le JSON autonomes de cette fonctionnalité.

## Valider et publier

1. Tester la politique, compiler en Release x64, vérifier la version, les exports D2RLoader et les hashes entre build, dépôt et runtime.
2. Valider séparément les portées globale et mod-locale, le repli de configuration, la coexistence avec les cinq DLL eezstreet et l'absence de plugins rejetés ou en échec.
3. Produire le ZIP public avec uniquement la DLL autonome et son ou ses JSON autonomes requis. Exclure README, sources, TOML, logs et fichiers de preuve.
4. Inspecter la liste réelle des entrées du ZIP et calculer son SHA-256 avant de déclarer la livraison prête.
5. Préserver les métadonnées et crédits du propriétaire eezstreet lors du merge; créditer exactement `RuffnecKk` dans les sources, logs et documentation de la fonctionnalité.

Lire [references/incubation-checklist.md](references/incubation-checklist.md) pour la cartographie des propriétaires et les gates d'audit, de runtime et d'archive.
