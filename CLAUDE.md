# Consignes pour Claude : la FAQ de Roulez Jeunesse Pro

Ce dépôt contient la page d'aide de « Roulez Jeunesse Pro », l'application des réparateurs de vélo. Chaque question est un fichier Markdown dans `questions/`. Après un envoi sur `main`, une Action GitHub valide le contenu puis le publie. L'application l'affiche aux vrais réparateurs, dans la page qui détient leur jeton de connexion : la validation est une barrière de sécurité, jamais un obstacle à contourner.

La personne qui vous parle n'est pas développeuse. Parlez-lui simplement, sans jargon Git, et dites ce que vous avez changé en deux ou trois lignes.

## Écrire une réponse

- Français, vouvoiement, accents corrects (é, è, à, ç, œ) y compris sur les majuscules.
- Court : 5 phrases environ, 1 200 caractères au maximum. La question tient en 90 caractères et se termine par « ? ».
- Un seul geste par réponse. Si deux gestes se présentent, écrivez deux questions.
- Les mots du métier, ceux de l'application : rendez-vous, demande, facture, client, **Réglages**, **Agenda**. Les noms d'écrans et de boutons se mettent en gras, avec leur majuscule. Pas de jargon technique (API, jeton, back-office).
- Le produit s'appelle « Roulez Jeunesse Pro », écrit en toutes lettres : jamais un sigle, jamais un ancien nom ni un nom de code interne. La vérification refuse ces mots et dit lequel.
- Aucun tiret cadratin. Virgule, deux points ou point à la place.
- Phrases de longueurs variées, une courte de temps en temps. Pas d'ouverture de politesse (« Bonne question »), pas de récapitulatif final, pas de liste de trois éléments par réflexe.
- Markdown simple seulement : paragraphes, **gras**, *italique*, listes à puces ou numérotées, liens, captures. Rien d'autre : pas de HTML, pas de titre (`#`), pas de ligne `---` dans la réponse, pas de code.
- Liens : `[texte](https://...)` pour un site extérieur, `[Réglages](/reglages)` pour une page de l'application. Jamais `http://`, `mailto:` ni `tel:`.

## Un fichier question

Copiez `exemples/gabarit.md` dans `questions/`. L'en-tête a quatre clés, rien d'autre :

```
---
question: Un client ne trouve pas son rendez-vous ?
categorie: rendez-vous
ordre: 2
mots: agenda, introuvable, disparu
---
La réponse, en Markdown.
```

- `categorie` : un `id` de `categories.json` (compte, rendez-vous, reservation, activite, clients, factures, depannage). Ajoutez une catégorie seulement si on vous le demande, et ne changez jamais l'`id` d'une catégorie existante.
- `ordre` et `mots` sont facultatifs. `mots` aide la recherche : ce qu'un réparateur taperait.
- Le nom du fichier, sans `.md`, est l'identifiant de la question : minuscules sans accent, chiffres et tirets (`client-rendez-vous-introuvable.md`). Il sert d'ancre dans l'adresse `/aide#nom-du-fichier`. Ne renommez jamais un fichier existant. Pour changer de sujet, créez une nouvelle question et supprimez l'ancienne.
- Rien de ce qui est dans `exemples/` n'est publié. Une réponse qui porte encore « EXEMPLE, à ne pas publier » est refusée par la validation.

## Captures

- Le fichier va dans `images/`, nommé en minuscules avec des tirets (`agenda-rendez-vous.png`), en png, jpg, jpeg ou webp, 400 Ko au maximum. Renommez les captures d'écran du Mac, qui ont des espaces et des accents.
- Dans la réponse : `![Agenda de la semaine avec un rendez-vous](images/agenda-rendez-vous.png)`. Le texte alternatif décrit ce que l'on voit, en une phrase. Il n'est jamais vide.
- Jamais de donnée d'un vrai client sur une capture : nom, téléphone, adresse, courriel, plaque, numéro de série. Floutez ou utilisez un compte de démonstration. En cas de doute, demandez avant d'ajouter l'image.

## Avant d'envoyer

1. Lancez `node scripts/build.mjs` (Node 22). Chaque problème est dit en français, avec le fichier et la ligne.
2. Corrigez le contenu, pas la règle. N'envoyez rien tant que la commande échoue.
3. Quand on vous demande d'envoyer ou de publier : un commit au message court en français, puis un push sur `main`. Pas de pull request.

Ne modifiez jamais `scripts/` ni `.github/` sans qu'on vous le demande explicitement. Si une règle de validation gêne, dites-le à la personne au lieu de la changer.
