# FAQ de Roulez Jeunesse Pro

Ce dépôt contient les questions et les réponses de la page d'aide de l'application. Chaque question est un petit fichier texte dans le dossier `questions/`. Quand vous envoyez vos changements sur `main`, GitHub vérifie tout, puis publie. Si une seule vérification échoue, rien n'est publié : la FAQ en ligne reste telle qu'elle était.

## Ajouter une question

Ouvrez ce dossier avec Claude et dites ce que vous voulez : « ajoute une question sur la facture qui ne part pas ». Claude lit `CLAUDE.md`, écrit la réponse selon nos règles (court, vouvoiement, un seul geste), crée le fichier dans `questions/` et lance la vérification.

Relisez le texte qu'il propose. S'il vous convient, demandez-lui de l'envoyer sur `main`. La page d'aide est à jour quelques minutes plus tard.

## Modifier ou supprimer une question

Même chose : « corrige la réponse de la question sur les rendez-vous introuvables », ou « supprime la question sur les factures ».

Le nom d'un fichier ne change jamais, même quand on réécrit la question. Il sert d'ancre dans l'adresse de l'application (`/aide#nom-du-fichier`) : un lien déjà partagé doit continuer de marcher. Pour changer complètement de sujet, créez une nouvelle question.

## Ajouter une capture

Mettez l'image dans le dossier `images/` et dites à Claude dans quelle réponse elle va. Quelques règles :

- png, jpg, jpeg ou webp, 400 Ko au maximum ;
- un nom en minuscules avec des tirets (`agenda-rendez-vous.png`), sans espace ni accent ;
- aucune donnée d'un vrai client sur l'image : nom, téléphone, adresse, courriel ;
- un texte alternatif qui décrit ce que l'on voit, pour les personnes qui ne voient pas l'image.

Une image que personne n'utilise n'est pas publiée. La vérification vous le signale par un avertissement, sans bloquer.

## Voir ce que ça donne

Dans un terminal, depuis ce dossier (Node 22 est nécessaire) :

    node scripts/build.mjs

La commande vérifie tout et écrit `dist/faq.json`, le fichier que l'application lira. Pour essayer les exemples sans rien publier : `node scripts/build.mjs --dir exemples`. Le dossier `exemples/` ne part jamais en ligne, et le gabarit à copier pour une nouvelle question s'y trouve.

Pour la voir dans l'application, sur votre machine : `node scripts/servir.mjs` sert `dist/` sur `http://localhost:4010/faq.json`, et l'application la lit en `VITE_FAQ_URL=http://localhost:4010/faq.json`.

## Quand la vérification échoue

Sur GitHub, l'onglet Actions affiche l'envoi en rouge. En local, la commande ci-dessus sort en erreur. Dans les deux cas, chaque problème est écrit en français avec le fichier, la ligne et ce qu'il faut corriger. Par exemple :

    questions/facture-ne-part-pas.md, ligne 9 : La réponse : le tiret cadratin est interdit.

Dites à Claude : « corrige les erreurs de validation et renvoie ». Pendant ce temps, la FAQ en ligne reste celle de la dernière publication réussie. Les règles ne sont pas là pour gêner : le contenu s'affiche chez les réparateurs, dans la page qui détient leur connexion, alors la vérification refuse le HTML, les liens douteux, les anciens noms et les noms de code internes et les images qui n'existent pas.

## Mise en place, une seule fois

Dans GitHub, réglage du dépôt Settings, puis Pages, puis Source : choisir « GitHub Actions ». Ensuite chaque envoi sur `main` relance la publication, et on peut aussi la lancer à la main depuis l'onglet Actions.

## Ce qu'il y a dans le dossier

- `questions/` : les questions publiées. Rien d'autre ne l'est.
- `images/` : les captures.
- `categories.json` : les rubriques, dans l'ordre d'affichage.
- `exemples/` : le gabarit et trois exemples, jamais publiés.
- `scripts/` et `.github/` : la vérification et la publication. On n'y touche pas sans le demander.
- `CLAUDE.md` : les règles de rédaction que Claude suit.
