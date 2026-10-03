#!/usr/bin/env node
// Valide les questions de la FAQ, puis écrit dist/faq.json et dist/images/.
//
//   node scripts/build.mjs                  lit questions/
//   node scripts/build.mjs --dir exemples   lit un autre dossier (pour essayer)
//
// Ce script est une barrière de sécurité : le contenu est affiché dans l'application
// des réparateurs, à l'origine qui détient leur jeton. Au moindre problème il sort avec
// le code 1 et n'écrit rien dans dist/. Les règles sont volontairement strictes.
//
// Aucune dépendance : Node 22 seul.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_QUESTION = 90;
export const MAX_REPONSE = 1200;
export const MAX_IMAGE_OCTETS = 400 * 1024;

const FORMAT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CLES_ENTETE = ["question", "categorie", "ordre", "mots"];
const CLES_OBLIGATOIRES = ["question", "categorie"];
const FORMAT_IMAGE = /^images\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(png|jpg|jpeg|webp)$/;
const EXTENSIONS_IMAGE = new Set(["png", "jpg", "jpeg", "webp"]);
// Une question copiée depuis exemples/ ne doit jamais arriver chez les réparateurs.
const MARQUE_EXEMPLE = /exemple,?\s+à\s+ne\s+pas\s+publier/i;
// Au-delà, l'analyse des liens serait inutilement lente (la réponse est déjà refusée).
const TAILLE_MAX_ANALYSE = 20000;

const USAGE =
  "Usage : node scripts/build.mjs [--dir <dossier>]\n" +
  "  sans option, les questions sont lues dans questions/\n" +
  "  --dir exemples   essaie un autre dossier (ses images sont dans <dossier>/images/)";

// ---------------------------------------------------------------------------
// Problèmes
// ---------------------------------------------------------------------------

function probleme(fichier, ligne, code, message) {
  return { fichier, ligne: ligne ?? null, code, message };
}

export function formaterProbleme(p) {
  return `${p.fichier}${p.ligne ? `, ligne ${p.ligne}` : ""} : ${p.message}`;
}

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const longueur = (texte) => [...texte].length;

// ---------------------------------------------------------------------------
// En-tête : des lignes « cle: valeur » entre deux lignes ---
// ---------------------------------------------------------------------------

function sansAccents(texte) {
  return texte.normalize("NFD").replace(/\p{M}/gu, "");
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[a.length][b.length];
}

function suggererCle(cle) {
  const simple = sansAccents(cle).toLowerCase();
  const exacte = CLES_ENTETE.find((c) => c === simple);
  if (exacte) return exacte;
  return CLES_ENTETE.find((c) => distance(c, simple) <= 2) ?? null;
}

/**
 * Lit l'en-tête d'un fichier question.
 * Renvoie { valide, valeurs, lignes, problemes, corps, ligneCorps }.
 * `valide` est faux quand l'en-tête manque ou n'est pas refermé : rien d'autre
 * n'est alors vérifiable. Les lignes vides et celles qui commencent par # sont ignorées.
 */
export function lireEntete(contenu) {
  const texte = contenu.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lignes = texte.split("\n");
  const sortie = { valide: false, valeurs: {}, lignes: {}, problemes: [], corps: "", ligneCorps: 1 };

  if (lignes[0].trim() !== "---") {
    sortie.problemes.push({
      ligne: 1,
      code: "entete-absent",
      message:
        "le fichier doit commencer par une ligne qui contient seulement --- (elle ouvre l'en-tête de la question).",
    });
    return sortie;
  }

  let fin = -1;
  for (let i = 1; i < lignes.length; i++) {
    if (lignes[i].trim() === "---") {
      fin = i;
      break;
    }
  }
  if (fin === -1) {
    sortie.problemes.push({
      ligne: 1,
      code: "entete-non-ferme",
      message:
        "l'en-tête n'est pas refermé. Ajoutez une ligne --- après la dernière clé, puis la réponse en dessous.",
    });
    return sortie;
  }

  for (let i = 1; i < fin; i++) {
    const brute = lignes[i].trim();
    if (brute === "" || brute.startsWith("#")) continue;
    const numero = i + 1;
    const m = /^([^\s:]+)\s*:(.*)$/.exec(brute);
    if (!m) {
      sortie.problemes.push({
        ligne: numero,
        code: "entete-ligne",
        message: `cette ligne de l'en-tête n'a pas la forme « cle: valeur » (« ${brute} »).`,
      });
      continue;
    }
    const cle = m[1];
    const valeur = m[2].trim();
    if (!CLES_ENTETE.includes(cle)) {
      const proposition = suggererCle(cle);
      sortie.problemes.push({
        ligne: numero,
        code: "cle-inconnue",
        message:
          `la clé « ${cle} » n'existe pas. Clés admises : ${CLES_ENTETE.join(", ")}.` +
          (proposition ? ` Vouliez-vous écrire « ${proposition} » ?` : ""),
      });
      continue;
    }
    if (cle in sortie.valeurs) {
      sortie.problemes.push({
        ligne: numero,
        code: "cle-dupliquee",
        message: `la clé « ${cle} » est écrite deux fois (voir ligne ${sortie.lignes[cle]}). Gardez-en une seule.`,
      });
      continue;
    }
    if (/^(".*"|“.*”|'.*')$/.test(valeur)) {
      sortie.problemes.push({
        ligne: numero,
        code: "entete-guillemets",
        message: `la valeur de « ${cle} » ne doit pas être entourée de guillemets. Écrivez simplement le texte.`,
      });
    }
    sortie.valeurs[cle] = valeur;
    sortie.lignes[cle] = numero;
  }

  sortie.valide = true;
  sortie.corps = lignes.slice(fin + 1).join("\n");
  sortie.ligneCorps = fin + 2;
  return sortie;
}

// ---------------------------------------------------------------------------
// Interdits (question, mots, réponse, catégories)
// ---------------------------------------------------------------------------

const CARACTERES_INVISIBLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\uFFFD]/;

/*
 * Les noms internes ne s'écrivent nulle part en clair dans ce dépôt, qui est
 * public : on les compose. La vérification les refuse toujours, et le message
 * dit à l'éditeur lequel il a écrit.
 */
const ANCIEN_NOM = ["Cyc", "lofix"].join("");
const NOM_DE_CODE = ["Fixer", " Lite"].join("");
const SIGLE = ["R", "J"].join("");

const REGLES_LIGNE = [
  {
    code: "tiret-cadratin",
    motif: /\u2014/,
    message: () => "le tiret cadratin est interdit. Remplacez-le par une virgule, deux points ou un point.",
  },
  {
    code: "mot-interdit",
    motif: new RegExp(ANCIEN_NOM, "i"),
    message: () => `le nom « ${ANCIEN_NOM} » est interdit. Le produit s'appelle « Roulez Jeunesse Pro ».`,
  },
  {
    code: "mot-interdit",
    motif: new RegExp(["fix", "er[\\s_-]*l(?:ite|ight)"].join(""), "i"),
    message: () => `le nom « ${NOM_DE_CODE} » est interdit. Le produit s'appelle « Roulez Jeunesse Pro ».`,
  },
  {
    code: "mot-interdit",
    motif: new RegExp(["(?<![\\p{L}\\p{N}_])", SIGLE, "(?![\\p{L}\\p{N}_])"].join(""), "iu"),
    message: () => `le sigle « ${SIGLE} » est interdit. Le produit s'appelle « Roulez Jeunesse Pro ».`,
  },
  {
    code: "html",
    motif: /<[A-Za-z/!]/,
    message: () =>
      "le HTML est interdit (une balise commence par <). Écrivez du texte simple, avec du **gras**, de l'*italique*, des listes et des liens.",
  },
  {
    code: "code",
    motif: /`|^\s{0,3}~{3,}/,
    message: () => "le code est interdit (accents graves ou ~~~). Écrivez le texte tel qu'il s'affiche à l'écran.",
  },
  {
    code: "titre",
    motif: /^\s*#/,
    message: () =>
      "les titres sont interdits : une ligne ne doit pas commencer par #. Écrivez une phrase, ou mettez un mot en **gras**.",
  },
  {
    code: "titre",
    motif: /^\s{0,3}(?:=+|-+|\*{3,}|_{3,})\s*$/,
    message: () =>
      "les titres soulignés et les lignes de séparation sont interdits (une ligne faite seulement de ---, === ou ***).",
  },
  {
    code: "caractere-invisible",
    motif: CARACTERES_INVISIBLES,
    message: (ligne) => {
      const c = ligne.match(CARACTERES_INVISIBLES)[0];
      const code = c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      return `caractère invisible, de contrôle ou illisible (U+${code}). Supprimez-le et retapez le texte.`;
    },
  },
];

/** Applique les interdits ligne par ligne. `ligneDebut` est le numéro de la première ligne (ou null). */
function verifierInterdits(texte, ligneDebut, zone, fichier, problemes) {
  texte.split("\n").forEach((ligne, i) => {
    const numero = ligneDebut == null ? null : ligneDebut + i;
    for (const regle of REGLES_LIGNE) {
      if (regle.motif.test(ligne)) {
        problemes.push(probleme(fichier, numero, regle.code, `${zone} : ${regle.message(ligne)}`));
      }
    }
  });
}

/** Une ligne indentée de 4 espaces (ou d'une tabulation) après une ligne vide, hors liste, est un bloc de code. */
function verifierCodeIndente(corps, ligneCorps, fichier, problemes) {
  let precedenteVide = true;
  let dansListe = false;
  corps.split("\n").forEach((ligne, i) => {
    if (ligne.trim() === "") {
      precedenteVide = true;
      return;
    }
    const indentee = /^( {4,}|\t)/.test(ligne);
    if (indentee && precedenteVide && !dansListe) {
      problemes.push(
        probleme(
          fichier,
          ligneCorps + i,
          "code",
          "La réponse : le code est interdit (ligne décalée de quatre espaces). Écrivez le texte sans décalage.",
        ),
      );
    }
    if (/^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s/.test(ligne)) dansListe = true;
    else if (!indentee && !/^\s/.test(ligne)) dansListe = false;
    precedenteVide = false;
  });
}

// ---------------------------------------------------------------------------
// Liens et images
// ---------------------------------------------------------------------------

/**
 * Repère chaque construction « ](cible) » et remonte au « [ » qui l'ouvre.
 * On part de « ]( » plutôt que d'une expression « [texte](cible) » : des crochets
 * imbriqués dans le texte du lien ne doivent pas permettre d'échapper à la vérification.
 */
function trouverLiens(texte) {
  const liens = [];
  let position = 0;
  while ((position = texte.indexOf("](", position)) !== -1) {
    let profondeur = 0;
    let debut = -1;
    for (let i = position; i >= 0; i--) {
      if (texte[i] === "]") profondeur++;
      else if (texte[i] === "[") {
        profondeur--;
        if (profondeur === 0) {
          debut = i;
          break;
        }
      }
    }
    if (debut === -1) {
      position += 2;
      continue;
    }
    let niveau = 1;
    let i = position + 2;
    for (; i < texte.length && niveau > 0; i++) {
      if (texte[i] === "(") niveau++;
      else if (texte[i] === ")") niveau--;
    }
    const ferme = niveau === 0;
    liens.push({
      debut,
      image: debut > 0 && texte[debut - 1] === "!",
      texte: texte.slice(debut + 1, position),
      cible: texte.slice(position + 2, ferme ? i - 1 : i).trim(),
      ferme,
    });
    position += 2;
  }
  return liens;
}

const CARACTERES_INTERDITS_CIBLE = /[\s\u0000-\u001F\u007F-\u009F\\]/;

/** Renvoie un message d'erreur, ou null si la cible du lien est admise. */
function verifierCibleLien(cible) {
  if (cible === "") return "la cible du lien est vide. Écrivez l'adresse entre parenthèses : [texte](https://exemple.fr).";
  if (CARACTERES_INTERDITS_CIBLE.test(cible)) {
    return `la cible « ${cible} » contient un espace, un retour à la ligne ou une barre oblique inverse. Écrivez seulement l'adresse, sans titre.`;
  }
  if (cible.startsWith("https://")) {
    const hote = /^https:\/\/([^/?#]*)/.exec(cible)[1];
    if (hote === "" || hote.includes("@")) {
      return `l'adresse « ${cible} » n'est pas admise (nom de site manquant ou identifiant devant le nom de site).`;
    }
    return null;
  }
  if (cible.startsWith("/") && !cible.startsWith("//")) return null;
  if (/^http:/i.test(cible)) return `le lien « ${cible} » doit commencer par https:// et non http://.`;
  return `la cible « ${cible} » n'est pas admise. Un lien commence par https:// ou, pour une page de l'application, par une seule barre oblique (par exemple /reglages).`;
}

function signatureValide(octets, extension) {
  if (extension === "png") {
    return octets.length >= 8 && octets.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (extension === "jpg" || extension === "jpeg") {
    return octets.length >= 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff;
  }
  return (
    octets.length >= 12 &&
    octets.subarray(0, 4).toString("latin1") === "RIFF" &&
    octets.subarray(8, 12).toString("latin1") === "WEBP"
  );
}

/** Contrôle un fichier image du dossier images. Renvoie { code, message } ou null. */
function examinerImage(nomFichier, extension, images) {
  if (images.cache.has(nomFichier)) return images.cache.get(nomFichier);
  let resultat = null;
  if (!images.noms.has(nomFichier)) {
    resultat = {
      code: "image-absente",
      message: `le fichier « ${nomFichier} » est introuvable dans ${images.affichage}. Ajoutez-le (le nom doit correspondre lettre pour lettre, majuscules comprises).`,
    };
  } else {
    const chemin = path.join(images.dossier, nomFichier);
    const infos = fs.lstatSync(chemin);
    if (!infos.isFile()) {
      resultat = {
        code: "image-invalide",
        message: `« ${nomFichier} » n'est pas un fichier ordinaire (lien symbolique ?). Copiez l'image elle-même.`,
      };
    } else if (infos.size > MAX_IMAGE_OCTETS) {
      resultat = {
        code: "image-lourde",
        message: `l'image « ${nomFichier} » pèse ${Math.ceil(infos.size / 1024)} Ko, le maximum est 400 Ko. Réduisez ses dimensions ou enregistrez-la en webp ou en jpg.`,
      };
    } else {
      const debut = Buffer.alloc(12);
      const fd = fs.openSync(chemin, "r");
      const lus = fs.readSync(fd, debut, 0, 12, 0);
      fs.closeSync(fd);
      if (!signatureValide(debut.subarray(0, lus), extension)) {
        resultat = {
          code: "image-invalide",
          message: `« ${nomFichier} » n'est pas une vraie image ${extension}. Enregistrez-la de nouveau dans ce format au lieu de changer l'extension.`,
        };
      }
    }
  }
  images.cache.set(nomFichier, resultat);
  return resultat;
}

function verifierLiensEtImages({ corps, ligneCorps, fichier, images, utilisees, problemes }) {
  const ligneDe = (index) => ligneCorps + (corps.slice(0, index).match(/\n/g) ?? []).length;

  for (const lien of trouverLiens(corps)) {
    const ligne = ligneDe(lien.debut);
    if (!lien.ferme) {
      problemes.push(
        probleme(fichier, ligne, lien.image ? "image-cible" : "lien-cible", "la parenthèse qui suit le crochet n'est jamais fermée. Vérifiez [texte](adresse)."),
      );
      continue;
    }
    if (lien.image) {
      if (lien.texte.trim() === "") {
        problemes.push(
          probleme(fichier, ligne, "image-alt", "la capture n'a pas de texte alternatif. Décrivez-la entre les crochets : ![Agenda de la semaine](images/nom.png)."),
        );
      }
      const m = FORMAT_IMAGE.exec(lien.cible);
      if (!m) {
        problemes.push(
          probleme(
            fichier,
            ligne,
            "image-cible",
            `la cible « ${lien.cible} » n'est pas admise pour une capture. Écrivez images/nom.png : le fichier est dans le dossier images/, son nom s'écrit en minuscules, chiffres et tirets, et l'extension est png, jpg, jpeg ou webp (pas d'adresse externe).`,
          ),
        );
        continue;
      }
      const nomFichier = `${m[1]}.${m[2]}`;
      const defaut = examinerImage(nomFichier, m[2], images);
      if (defaut) problemes.push(probleme(fichier, ligne, defaut.code, defaut.message));
      else utilisees.add(nomFichier);
      continue;
    }
    if (lien.texte.trim() === "") {
      problemes.push(
        probleme(fichier, ligne, "lien-texte", "le texte du lien est vide. Écrivez-le entre crochets : [texte du lien](https://exemple.fr)."),
      );
    }
    const message = verifierCibleLien(lien.cible);
    if (message) problemes.push(probleme(fichier, ligne, "lien-cible", message));
  }

  for (const m of corps.matchAll(/\]\s?\[/g)) {
    problemes.push(
      probleme(fichier, ligneDe(m.index), "lien-reference", "les liens de type référence ([texte][nom]) sont interdits. Écrivez [texte](adresse)."),
    );
  }
  for (const m of corps.matchAll(/^\s{0,3}\[[^\]\n]+\]:/gm)) {
    problemes.push(
      probleme(fichier, ligneDe(m.index), "lien-reference", "les définitions de lien ([nom]: adresse) sont interdites. Écrivez [texte](adresse) dans la phrase."),
    );
  }
}

// ---------------------------------------------------------------------------
// categories.json
// ---------------------------------------------------------------------------

function lireCategories(chemin, fichier, problemes) {
  let brut;
  try {
    brut = fs.readFileSync(chemin, "utf8");
  } catch {
    problemes.push(probleme(fichier, null, "categories-absent", "fichier introuvable. Il doit se trouver à la racine du dépôt."));
    return [];
  }
  let donnees;
  try {
    donnees = JSON.parse(brut.replace(/^﻿/, ""));
  } catch (e) {
    problemes.push(
      probleme(fichier, null, "categories-json", `ce n'est pas du JSON valide. Vérifiez les virgules, les guillemets et les crochets. Détail technique : ${e.message}`),
    );
    return [];
  }
  if (!Array.isArray(donnees)) {
    problemes.push(
      probleme(fichier, null, "categories-forme", 'le fichier doit contenir un tableau, c\'est-à-dire une liste entre crochets d\'éléments {"id": "...", "titre": "..."}.'),
    );
    return [];
  }
  const vues = [];
  donnees.forEach((entree, i) => {
    const repere = `catégorie n° ${i + 1}`;
    if (entree === null || typeof entree !== "object" || Array.isArray(entree)) {
      problemes.push(probleme(fichier, null, "categories-forme", `${repere} : chaque élément doit être de la forme {"id": "...", "titre": "..."}.`));
      return;
    }
    const { id, titre } = entree;
    if (typeof id !== "string" || id === "") {
      problemes.push(probleme(fichier, null, "categories-id", `${repere} : l'identifiant (« id ») manque.`));
    } else if (!FORMAT_ID.test(id)) {
      problemes.push(
        probleme(fichier, null, "categories-id", `${repere} : l'identifiant « ${id} » n'est pas admis (minuscules sans accent, chiffres et tirets, sans espace).`),
      );
    } else if (vues.includes(id)) {
      problemes.push(probleme(fichier, null, "categories-id-double", `${repere} : l'identifiant « ${id} » est déjà utilisé plus haut. Chaque catégorie a le sien.`));
    }
    if (typeof titre !== "string" || titre.trim() === "") {
      problemes.push(probleme(fichier, null, "categories-titre", `${repere} (« ${id ?? "?"} ») : le titre (« titre ») manque ou est vide.`));
    } else {
      verifierInterdits(titre, null, `${repere}, titre`, fichier, problemes);
    }
    if (typeof id === "string") {
      verifierInterdits(id, null, `${repere}, identifiant`, fichier, problemes);
      vues.push(id);
    }
  });
  return donnees
    .filter((c) => c && typeof c === "object" && typeof c.id === "string" && typeof c.titre === "string")
    .map((c) => ({ id: c.id, titre: c.titre.trim() }));
}

// ---------------------------------------------------------------------------
// Un fichier question
// ---------------------------------------------------------------------------

const INDICE_CLE = {
  question: "Par exemple : question: Un client ne trouve pas son rendez-vous ?",
  categorie: "Par exemple : categorie: rendez-vous",
};

function validerFichier({ nom, fichier, contenu, categories, images, essai }) {
  const problemes = [];
  const utilisees = new Set();
  const id = nom.slice(0, -3);
  const resultat = { problemes, utilisees, id, texte: null, ligneTexte: null, entree: null };

  if (!FORMAT_ID.test(id)) {
    problemes.push(
      probleme(
        fichier,
        null,
        "nom-fichier",
        `le nom « ${id} » n'est pas admis. Il sert d'identifiant dans l'adresse /aide#nom-du-fichier : minuscules sans accent, chiffres et tirets, sans espace ni tiret au début ou à la fin (par exemple client-rendez-vous-introuvable.md).`,
      ),
    );
  }

  const entete = lireEntete(contenu);
  for (const p of entete.problemes) problemes.push(probleme(fichier, p.ligne, p.code, p.message));
  if (!entete.valide) return resultat;

  const { valeurs, lignes } = entete;

  for (const cle of CLES_OBLIGATOIRES) {
    if (!(cle in valeurs)) {
      problemes.push(probleme(fichier, 1, "cle-manquante", `la clé « ${cle} » manque dans l'en-tête. ${INDICE_CLE[cle]}`));
    } else if (valeurs[cle] === "") {
      problemes.push(probleme(fichier, lignes[cle], "cle-vide", `la clé « ${cle} » est vide. ${INDICE_CLE[cle]}`));
    }
  }

  // Question
  const question = valeurs.question ?? "";
  if (question !== "") {
    resultat.texte = question;
    resultat.ligneTexte = lignes.question;
    const n = longueur(question);
    if (n > MAX_QUESTION) {
      problemes.push(
        probleme(fichier, lignes.question, "question-longue", `la question fait ${n} caractères, le maximum est ${MAX_QUESTION}. Raccourcissez-la de ${n - MAX_QUESTION}.`),
      );
    }
    if (!question.endsWith("?")) {
      problemes.push(probleme(fichier, lignes.question, "question-sans-point", "la question doit se terminer par un point d'interrogation."));
    }
    verifierInterdits(question, lignes.question, "La question", fichier, problemes);
    if (question.includes("](")) {
      problemes.push(probleme(fichier, lignes.question, "lien-dans-question", "la question ne doit contenir ni lien ni image. Mettez-les dans la réponse."));
    }
  }

  // Catégorie
  const categorie = valeurs.categorie ?? "";
  if (categorie !== "" && !categories.some((c) => c.id === categorie)) {
    const admises = categories.map((c) => c.id);
    problemes.push(
      probleme(
        fichier,
        lignes.categorie,
        "categorie-inconnue",
        admises.length
          ? `la catégorie « ${categorie} » n'existe pas dans categories.json. Catégories admises : ${admises.join(", ")}.`
          : `la catégorie « ${categorie} » n'existe pas : categories.json ne contient aucune catégorie.`,
      ),
    );
  }

  // Ordre
  let ordre = null;
  if ("ordre" in valeurs) {
    if (/^-?\d+$/.test(valeurs.ordre) && Number.isSafeInteger(Number(valeurs.ordre))) ordre = Number(valeurs.ordre);
    else {
      problemes.push(
        probleme(fichier, lignes.ordre, "ordre-invalide", `« ordre » doit être un nombre entier (par exemple ordre: 2). Retirez la ligne pour passer en dernier.`),
      );
    }
  }

  // Mots
  let mots = [];
  if ("mots" in valeurs) {
    mots = [...new Set(valeurs.mots.split(",").map((m) => m.trim()).filter(Boolean))];
    verifierInterdits(valeurs.mots, lignes.mots, "Les mots", fichier, problemes);
    if (valeurs.mots.includes("](")) {
      problemes.push(probleme(fichier, lignes.mots, "lien-dans-question", "les mots ne doivent contenir ni lien ni image."));
    }
  }

  // Réponse
  const corps = entete.corps;
  const reponse = corps.trim();
  if (reponse === "") {
    problemes.push(probleme(fichier, entete.ligneCorps - 1, "reponse-vide", "la réponse est vide. Écrivez-la sous la ligne --- qui ferme l'en-tête."));
  } else {
    const n = longueur(reponse);
    if (n > MAX_REPONSE) {
      problemes.push(
        probleme(fichier, entete.ligneCorps, "reponse-longue", `la réponse fait ${n} caractères, le maximum est 1 200. Raccourcissez-la de ${n - MAX_REPONSE}, ou gardez un seul geste par réponse.`),
      );
    }
    if (!essai && MARQUE_EXEMPLE.test(reponse)) {
      problemes.push(
        probleme(fichier, entete.ligneCorps, "marque-exemple", "la réponse porte encore la mention « EXEMPLE, à ne pas publier ». Remplacez le texte de l'exemple par la vraie réponse."),
      );
    }
  }
  verifierInterdits(corps, entete.ligneCorps, "La réponse", fichier, problemes);
  verifierCodeIndente(corps, entete.ligneCorps, fichier, problemes);
  if (corps.length <= TAILLE_MAX_ANALYSE) {
    verifierLiensEtImages({ corps, ligneCorps: entete.ligneCorps, fichier, images, utilisees, problemes });
  }

  if (problemes.length === 0) {
    resultat.entree = { id, question, categorie, ordre, mots, reponse: reponse.replace(/\r\n?/g, "\n") };
  }
  return resultat;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Lit, valide et assemble la FAQ. N'écrit rien.
 * `racine` : dossier du dépôt (categories.json, questions/, images/).
 * `dossier` : autre dossier de questions (ses images sont dans <dossier>/images/).
 */
export function construire({ racine, dossier, maintenant = new Date() }) {
  const racineAbs = path.resolve(racine);
  const dossierDefaut = path.join(racineAbs, "questions");
  const dossierQuestions = dossier ? path.resolve(dossier) : dossierDefaut;
  const essai = dossierQuestions !== dossierDefaut;
  const dossierImages = essai ? path.join(dossierQuestions, "images") : path.join(racineAbs, "images");

  const affiche = (chemin) => {
    const relatif = path.relative(racineAbs, chemin).split(path.sep).join("/");
    return relatif.startsWith("..") || path.isAbsolute(relatif) ? chemin : relatif || ".";
  };

  const problemes = [];
  const avertissements = [];
  const avertir = (fichier, message) => avertissements.push({ fichier, message });

  const categories = lireCategories(path.join(racineAbs, "categories.json"), "categories.json", problemes);

  // Images disponibles
  const images = { dossier: dossierImages, affichage: `${affiche(dossierImages)}/`, noms: new Set(), cache: new Map() };
  if (fs.existsSync(dossierImages)) {
    for (const entree of fs.readdirSync(dossierImages, { withFileTypes: true })) images.noms.add(entree.name);
  }

  // Fichiers de questions
  let entrees = [];
  if (!fs.existsSync(dossierQuestions)) {
    if (essai) {
      problemes.push(probleme(affiche(dossierQuestions), null, "dossier-absent", "ce dossier est introuvable."));
    } else {
      // Git ne conserve pas un dossier vide : sans question, le dossier peut avoir disparu.
      avertir("questions/", "le dossier n'existe pas, la FAQ publiée sera vide.");
    }
  } else {
    try {
      entrees = fs.readdirSync(dossierQuestions, { withFileTypes: true });
    } catch {
      problemes.push(probleme(affiche(dossierQuestions), null, "dossier-absent", "ce n'est pas un dossier lisible."));
    }
    entrees.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  const lues = [];
  const utilisees = new Set();
  for (const entree of entrees) {
    const nom = entree.name;
    if (nom.startsWith(".")) continue;
    const chemin = path.join(dossierQuestions, nom);
    const fichier = affiche(chemin);
    if (entree.isSymbolicLink()) {
      problemes.push(probleme(fichier, null, "lien-symbolique", "les liens symboliques ne sont pas admis. Copiez le fichier lui-même."));
      continue;
    }
    if (entree.isDirectory()) {
      if (!(essai && nom === "images")) avertir(fichier, "sous-dossier ignoré : seuls les fichiers .md placés directement dans le dossier sont lus.");
      continue;
    }
    if (!nom.endsWith(".md")) {
      avertir(fichier, "fichier ignoré : seuls les fichiers dont le nom se termine par .md sont lus.");
      continue;
    }
    const lu = validerFichier({ nom, fichier, contenu: fs.readFileSync(chemin, "utf8"), categories, images, essai });
    lu.fichier = fichier;
    problemes.push(...lu.problemes);
    for (const image of lu.utilisees) utilisees.add(image);
    lues.push(lu);
  }

  // Deux questions identiques
  const premiere = new Map();
  for (const lu of lues) {
    if (lu.texte === null) continue;
    if (premiere.has(lu.texte)) {
      problemes.push(
        probleme(lu.fichier, lu.ligneTexte, "doublon-question", `la même question existe déjà dans ${premiere.get(lu.texte)}. Gardez-en une seule.`),
      );
    } else {
      premiere.set(lu.texte, lu.fichier);
    }
  }

  // Images jamais utilisées
  for (const nom of [...images.noms].sort()) {
    if (nom.startsWith(".")) continue;
    const fichier = `${images.affichage}${nom}`;
    const ext = nom.includes(".") ? nom.slice(nom.lastIndexOf(".") + 1) : "";
    if (!utilisees.has(nom)) {
      avertir(
        fichier,
        EXTENSIONS_IMAGE.has(ext)
          ? "aucune question n'utilise cette image, elle ne sera pas publiée. Supprimez-la ou ajoutez-la à une réponse."
          : "fichier ignoré : seules les images png, jpg, jpeg et webp sont publiées.",
      );
    }
  }

  // Assemblage
  const ordreCategories = new Map(categories.map((c, i) => [c.id, i]));
  const entreesValides = lues.map((lu) => lu.entree).filter(Boolean);
  entreesValides.sort((a, b) => {
    const parCategorie = ordreCategories.get(a.categorie) - ordreCategories.get(b.categorie);
    if (parCategorie) return parCategorie;
    const ordreA = a.ordre ?? Infinity;
    const ordreB = b.ordre ?? Infinity;
    if (ordreA !== ordreB) return ordreA < ordreB ? -1 : 1;
    return a.question.localeCompare(b.question, "fr") || (a.id < b.id ? -1 : 1);
  });
  const categoriesUtiles = categories.filter((c) => entreesValides.some((q) => q.categorie === c.id));

  const faq = {
    version: 1,
    generee: maintenant.toISOString(),
    categories: categoriesUtiles.map((c) => ({ id: c.id, titre: c.titre })),
    questions: entreesValides.map((q) => ({
      id: q.id,
      question: q.question,
      categorie: q.categorie,
      mots: q.mots,
      reponse: q.reponse,
    })),
  };

  problemes.sort(
    (a, b) => (a.fichier < b.fichier ? -1 : a.fichier > b.fichier ? 1 : 0) || (a.ligne ?? 0) - (b.ligne ?? 0),
  );

  return {
    problemes,
    avertissements,
    faq,
    images: [...utilisees].sort().map((nom) => ({ nom, source: path.join(dossierImages, nom) })),
    essai,
  };
}

/** Écrit dist/faq.json et dist/images/. À n'appeler que si la validation n'a trouvé aucun problème. */
export function ecrireDist({ racine, faq, images }) {
  const dist = path.join(path.resolve(racine), "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(path.join(dist, "images"), { recursive: true });
  fs.writeFileSync(path.join(dist, "faq.json"), `${JSON.stringify(faq, null, 2)}\n`);
  for (const image of images) fs.copyFileSync(image.source, path.join(dist, "images", image.nom));
  return dist;
}

// ---------------------------------------------------------------------------
// Ligne de commande
// ---------------------------------------------------------------------------

export function lancer(
  args,
  { racine, cwd = process.cwd(), maintenant = new Date(), sortie = (t) => console.log(t), sortieErreur = (t) => console.error(t) } = {},
) {
  let dossier;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--aide" || arg === "--help" || arg === "-h") {
      sortie(USAGE);
      return 0;
    }
    if (arg === "--dir" || arg.startsWith("--dir=")) {
      dossier = arg === "--dir" ? args[++i] : arg.slice("--dir=".length);
      if (!dossier || dossier.startsWith("--")) {
        sortieErreur(`L'option --dir attend un nom de dossier.\n${USAGE}`);
        return 1;
      }
      continue;
    }
    sortieErreur(`Option inconnue : « ${arg} ».\n${USAGE}`);
    return 1;
  }

  const resultat = construire({ racine, dossier: dossier ? path.resolve(cwd, dossier) : undefined, maintenant });

  if (resultat.problemes.length > 0) {
    const n = resultat.problemes.length;
    const lignes = [
      `La validation a échoué : ${pluriel(n, "problème", "problèmes")} à corriger. Rien n'a été écrit dans dist/.`,
      "",
      ...resultat.problemes.map((p, i) => `  ${i + 1}. ${formaterProbleme(p)}`),
    ];
    if (resultat.avertissements.length > 0) {
      lignes.push("", "Avertissements :", ...resultat.avertissements.map((a) => `  - ${a.fichier} : ${a.message}`));
    }
    lignes.push("", "Corrigez ces points, puis relancez la commande.");
    sortieErreur(lignes.join("\n"));
    return 1;
  }

  ecrireDist({ racine, faq: resultat.faq, images: resultat.images });

  const q = resultat.faq.questions.length;
  const c = resultat.faq.categories.length;
  const lignes = [];
  if (resultat.avertissements.length > 0) {
    lignes.push("Avertissements :", ...resultat.avertissements.map((a) => `  - ${a.fichier} : ${a.message}`), "");
  }
  lignes.push(
    q === 0
      ? "FAQ valide : aucune question pour l'instant. dist/faq.json est écrit, avec une liste vide."
      : `FAQ valide : ${pluriel(q, "question", "questions")} dans ${pluriel(c, "catégorie", "catégories")}, ${pluriel(resultat.images.length, "image", "images")}. dist/faq.json est écrit.`,
  );
  if (resultat.essai) lignes.push("Essai sur un autre dossier : dist/ contient ce contenu d'essai. Ne le publiez pas.");
  sortie(lignes.join("\n"));
  return 0;
}

const estLance = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (estLance) {
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.exitCode = lancer(process.argv.slice(2), { racine });
}
