# Viewzo sur Cloudflare : plan de migration

Ce plan fait suite à l'étape 0 (l'essai dans `cloudflare/api`, PR #35). Il décrit comment passer viewzo.app du serveur actuel (VPS avec Docker : PostgreSQL, API NestJS, site Next.js, Caddy, sauvegarde vers R2) à Cloudflare (Workers, D1, R2, Durable Objects), sans coupure longue et avec un retour arrière possible à chaque étape.

Rien n'est déployé tant que tu n'as pas donné ton accord, étape par étape.

## 1. Ce que l'essai a prouvé

Tout est vérifié par le CI de GitHub (workflow « Cloudflare probe »), dans le moteur Workers (workerd) avec une D1 et un R2 locaux, sans compte Cloudflare.

| Sujet | Résultat |
| --- | --- |
| Prisma 7 sur D1 | Fonctionne (`@prisma/adapter-d1`). Taille du Worker mesurée à chaque CI : 1,25 Mo compressé (limite 3 Mo en gratuit, 10 Mo en payant). |
| Schéma complet | Les 32 tables du backend passent sur SQLite/D1. Les 16 listes (`String[]`, listes d'enum) deviennent du texte JSON. Le CI recrée ce schéma depuis `backend/prisma/schema.prisma` à chaque changement : un écart est vu tout de suite. |
| Données existantes | Répétition complète : PostgreSQL jetable avec les vraies migrations du backend, export, conversion (`scripts/pg-to-d1.mjs`), import dans D1, contrôle du nombre de lignes et des valeurs (dates, accents, apostrophes, listes, Json, booléens, liens paiement ↔ transaction). |
| Connexion | Mêmes règles que `backend/src/auth` : mêmes empreintes scrypt (aucun mot de passe à refaire), blocage après 5 essais même en parallèle, sessions en base. |
| Argent sans transactions interactives | Retrait en un seul lot D1, solde vérifié par un trigger dans la base (remplace `pg_advisory_xact_lock`). 20 retraits simultanés : jamais de double dépense. Le trigger marche aussi sur l'argent importé de PostgreSQL. |
| Validations du staff | Compare-and-set : 3 clics en même temps, 1 seule validation. Un paiement terminé ne peut pas être rouvert. |
| Fichiers | Captures de preuve dans R2, mêmes règles que le disque du serveur (8 Mo, type lu dans les octets, liens signés 6 h). |
| Tâches de fond | Les `setInterval` du backend sont remplacés par un Cron Trigger (`scheduled()`), testé deux fois en parallèle sans double effet. |
| Requêtes Prisma propres à PostgreSQL | `has`/`hasSome` sur les listes → `json_each` ou `contains`. `createMany` et `distinct` marchent. `mode: 'insensitive'` n'existe pas : la casse A–Z est ignorée, **pas les accents** (voir risques). |
| TikTok Live | `tiktok-live-connector` ne charge pas dans un Worker. Un Durable Object décode les messages TikTok et enregistre les commentaires. |

## 2. Ce qui n'est pas encore prouvé (demande un compte ou une clé)

1. **Connexion à un vrai live TikTok** depuis Cloudflare : il faut `EULER_API_KEY` et un live en cours. C'est le plus gros doute : TikTok peut refuser les adresses de Cloudflare.
2. **Vitesse réelle** : latence D1 depuis le Togo, temps CPU de scrypt en production (le plan gratuit, 10 ms de CPU, ne suffit pas ; le plan Workers Paid à 5 $/mois, oui).
3. **Volume réel** : taille de la base de production et durée de l'import (D1 : 10 Go maximum par base).
4. **Webhooks des paiements** (FedaPay, CinetPay, Flutterwave) reçus par un Worker : rien ne s'y oppose, mais à tester avec leurs comptes de test.
5. **Site web Next.js 16 sur Workers** (OpenNext) : pas encore essayé.

## 3. Étapes

| Étape | Contenu | Il faut | Retour arrière |
| --- | --- | --- | --- |
| 0 ✅ | Essai `cloudflare/api` (cette PR) | rien | supprimer le dossier |
| 1 | **Bêta isolée** : D1 `viewzo-beta`, R2 `viewzo-beta-files`, Worker sur une adresse de test (par ex. `api-beta.viewzo.app`). Test du vrai live TikTok et mesure de latence. Aucune donnée réelle. | ton accord, un jeton API Cloudflare (Workers, D1, R2, Durable Objects) mis par toi dans les secrets GitHub, Workers Paid, `EULER_API_KEY` | supprimer le Worker et la base bêta |
| 2 | **Portage de l'API**, module par module, de NestJS vers Hono (environ 17 000 lignes). Ordre : connexion complète (codes Didit, e-mail, rafraîchissement, staff) → utilisateurs et pays → portefeuille et paiements → créateurs, comptes, identité (photos dans R2) → campagnes, preuves, litiges → notifications, journal d'audit → live → connexions aux réseaux. Les 48 transactions interactives sont réécrites en lots D1 + gardes dans la base, chacune avec un test de concurrence. Mêmes réponses JSON que l'API actuelle : l'appli mobile et le site ne changent pas. | rien de nouveau (CI) | le serveur actuel reste en production |
| 3 | **Site web** sur Workers avec OpenNext, ou rester sur le serveur jusqu'à la fin (au choix). | ton choix | DNS |
| 4 | **Répétition avec une copie réelle** : export de la production, import dans la bêta, contrôle, mesure de la durée. | ton accord pour lire la production (lecture seule) | rien n'est modifié en production |
| 5 | **Bascule** : site en lecture seule quelques minutes, dernier export, import dans D1, gardes de l'argent posées après l'import, puis `api.viewzo.app` pointé vers le Worker (Cloudflare est déjà devant le serveur, c'est un changement de route). Tests rapides. | ton accord, un créneau calme | remettre la route vers le serveur ; il garde ses données jusqu'à l'import |
| 6 | **Après** : le serveur reste allumé 2 à 4 semaines en secours, puis arrêt. Sauvegardes : D1 Time Travel (30 jours) + export régulier vers R2. | ton accord pour l'arrêt | rallumer le serveur |

## 4. Ce qui reste sur le serveur actuel

- **Pendant les étapes 1 à 4 : tout.** viewzo.app, l'API, PostgreSQL et les sauvegardes restent sur le serveur, sans aucune modification.
- **Après la bascule** : rien en principe. Deux exceptions possibles :
  - la lecture des lives TikTok, si TikTok bloque Cloudflare à l'étape 1 (elle resterait sur un petit serveur, ou dans un conteneur Cloudflare) ;
  - le site web, si tu préfères ne pas le migrer à l'étape 3.
- La copie PostgreSQL finale est gardée en archive (R2) après l'arrêt du serveur.

## 5. Risques

| Risque | Gravité | Parade |
| --- | --- | --- |
| Erreur dans la réécriture des 48 transactions (argent compté deux fois) | haute | gardes dans la base (triggers), compare-and-set, un test de concurrence par opération d'argent, comparaison des soldes avant/après la répétition |
| TikTok refuse les connexions venant de Cloudflare | moyenne | test dès l'étape 1 ; sinon la lecture des lives reste hors Workers |
| Recherche par nom avec accents (« éloïse » ne trouve pas « Éloïse ») | basse | colonne de recherche normalisée (sans accents, en minuscules) pour les noms et e-mails |
| Limites de D1 : 10 Go par base, une seule écriture à la fois | moyenne | mesurer la taille réelle à l'étape 4 ; garder les grosses données (captures, photos) dans R2 ; séparer les commentaires de live si besoin |
| Latence depuis l'Afrique de l'Ouest | moyenne | base D1 placée en Europe de l'Ouest, lectures répliquées ; mesure à l'étape 1 |
| Durée du portage (17 000 lignes) | moyenne | module par module, le serveur actuel reste en production tout du long |
| Données sensibles (pièces d'identité) chez Cloudflare | moyenne | bucket R2 en juridiction UE, liens signés courts, même règle qu'aujourd'hui |
| Dépendance à Cloudflare | basse | Prisma et SQL standard ; l'export vers PostgreSQL reste possible |

## 6. Décisions à prendre

1. **Lancer l'étape 1 (bêta isolée)** : créer un jeton API Cloudflare et passer au plan Workers Paid (5 $/mois). C'est toi qui mets le jeton dans les secrets GitHub ; personne d'autre ne le saisit.
2. **Fournir `EULER_API_KEY`** (dans les secrets) pour tester un vrai live TikTok.
3. **Site web** : le migrer aussi (OpenNext) ou le laisser sur le serveur.
4. **Région des données** : D1 et R2 en Europe (recommandé, juridiction UE) ou ailleurs.
5. **Fusion de la PR #35** dans `main` : elle n'ajoute que `cloudflare/` et un workflow de test, ne déploie rien et ne touche ni au backend ni à viewzo.app.
6. **Branche par défaut du dépôt** : c'est `claude/project-thread-bou6pm`, alors que tout le travail est fusionné dans `main`. Passer `main` en branche par défaut éviterait des PR mal ciblées.
