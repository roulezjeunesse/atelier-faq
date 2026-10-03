// Tests des règles de validation. Chaque règle du brief a son test, sur des dossiers temporaires.
// Lancer : node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { construire, ecrireDist, formaterProbleme, lancer, lireEntete } from "./build.mjs";

// Les noms internes ne s'écrivent pas en clair dans ce dépôt public : on les compose.
const ANCIEN_NOM = ["Cyc", "lofix"].join("");
const NOM_DE_CODE = ["Fixer", " Lite"].join("");
const SIGLE = ["R", "J"].join("");

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DEPOT = path.resolve(ICI, "..");
const SCRIPT = path.join(ICI, "build.mjs");

// Le tiret cadratin n'est écrit nulle part dans ce dépôt : on le fabrique.
const TIRET = String.fromCharCode(0x2014);

const CATEGORIES = [
  { id: "rendez-vous", titre: "Rendez-vous" },
  { id: "demandes", titre: "Demandes" },
  { id: "clients", titre: "Clients" },
];

const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (octets = 64) => Buffer.concat([SIGNATURE_PNG, Buffer.alloc(octets - SIGNATURE_PNG.length)]);

/** Crée un dépôt temporaire (categories.json, questions/, images/). */
function depot(t, { categories = CATEGORIES, categoriesBrut, questions = {}, images = {} } = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), "faq-test-"));
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  fs.writeFileSync(path.join(racine, "categories.json"), categoriesBrut ?? JSON.stringify(categories));
  fs.mkdirSync(path.join(racine, "questions"));
  fs.mkdirSync(path.join(racine, "images"));
  for (const [nom, contenu] of Object.entries(questions)) fs.writeFileSync(path.join(racine, "questions", nom), contenu);
  for (const [nom, contenu] of Object.entries(images)) fs.writeFileSync(path.join(racine, "images", nom), contenu);
  return racine;
}

/** Contenu d'un fichier question. `entete` remplace l'en-tête complet quand on veut le casser. */
function fichier({ question = "Un client ne trouve pas son rendez-vous ?", categorie = "rendez-vous", ordre, mots, corps = "Ouvrez **Agenda**.", entete } = {}) {
  const lignes = ["---"];
  if (entete) lignes.push(entete);
  else {
    if (question !== null) lignes.push(`question: ${question}`);
    if (categorie !== null) lignes.push(`categorie: ${categorie}`);
    if (ordre !== undefined) lignes.push(`ordre: ${ordre}`);
    if (mots !== undefined) lignes.push(`mots: ${mots}`);
  }
  lignes.push("---", corps);
  return lignes.join("\n");
}

const codes = (resultat) => resultat.problemes.map((p) => p.code);

function attendreProbleme(resultat, code, fragment) {
  const trouves = resultat.problemes.filter((p) => p.code === code);
  assert.ok(trouves.length > 0, `problème « ${code} » attendu, obtenu : ${JSON.stringify(resultat.problemes)}`);
  if (fragment) {
    assert.ok(
      trouves.some((p) => p.message.includes(fragment)),
      `« ${fragment} » attendu dans : ${trouves.map((p) => p.message).join(" | ")}`,
    );
  }
  return trouves[0];
}

function construireAvec(t, questions, options = {}) {
  const racine = depot(t, { questions, ...options });
  return { racine, resultat: construire({ racine }) };
}

function unSeulFichier(t, contenu, options = {}) {
  return construireAvec(t, { "essai.md": contenu }, options).resultat;
}

function sansProbleme(resultat) {
  assert.deepEqual(resultat.problemes.map(formaterProbleme), []);
}

// ---------------------------------------------------------------------------
// Cas qui réussissent
// ---------------------------------------------------------------------------

test("une question valide produit faq.json au bon format", (t) => {
  const { resultat } = construireAvec(t, {
    "client-rendez-vous-introuvable.md": fichier({ ordre: 2, mots: "agenda, introuvable, disparu", corps: "Ouvrez **Agenda**, puis *cherchez* la date.\n\n- une puce\n- une autre\n\nVoir [Réglages](/reglages) ou [le site](https://exemple.fr)." }),
  });
  sansProbleme(resultat);
  const { faq } = resultat;
  assert.equal(faq.version, 1);
  assert.match(faq.generee, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(faq.categories, [{ id: "rendez-vous", titre: "Rendez-vous" }]);
  assert.deepEqual(faq.questions, [
    {
      id: "client-rendez-vous-introuvable",
      question: "Un client ne trouve pas son rendez-vous ?",
      categorie: "rendez-vous",
      mots: ["agenda", "introuvable", "disparu"],
      reponse: "Ouvrez **Agenda**, puis *cherchez* la date.\n\n- une puce\n- une autre\n\nVoir [Réglages](/reglages) ou [le site](https://exemple.fr).",
    },
  ]);
});

test("un dossier questions vide réussit avec zéro question", (t) => {
  const { resultat } = construireAvec(t, { ".gitkeep": "" });
  sansProbleme(resultat);
  assert.deepEqual(resultat.faq.questions, []);
  assert.deepEqual(resultat.faq.categories, []);
});

test("un dossier questions absent (Git ne garde pas les dossiers vides) réussit avec un avertissement", (t) => {
  const racine = depot(t);
  fs.rmSync(path.join(racine, "questions"), { recursive: true });
  const resultat = construire({ racine });
  sansProbleme(resultat);
  assert.equal(resultat.faq.questions.length, 0);
  assert.equal(resultat.avertissements.length, 1);
});

test("les catégories sans question sont omises, les autres gardent l'ordre de categories.json", (t) => {
  const { resultat } = construireAvec(t, {
    "a-client.md": fichier({ question: "Où est la fiche client ?", categorie: "clients" }),
    "b-demande.md": fichier({ question: "Où est la demande ?", categorie: "demandes" }),
  });
  sansProbleme(resultat);
  assert.deepEqual(resultat.faq.categories.map((c) => c.id), ["demandes", "clients"]);
});

test("tri : catégorie, puis ordre (sans ordre en dernier), puis titre alphabétique", (t) => {
  const { resultat } = construireAvec(t, {
    "q1.md": fichier({ question: "Zèbre ?", categorie: "demandes" }),
    "q2.md": fichier({ question: "Beta ?", categorie: "rendez-vous" }),
    "q3.md": fichier({ question: "Alpha ?", categorie: "rendez-vous" }),
    "q4.md": fichier({ question: "Gamma ?", categorie: "rendez-vous", ordre: 5 }),
    "q5.md": fichier({ question: "Delta ?", categorie: "rendez-vous", ordre: 1 }),
    "q6.md": fichier({ question: "Epsilon ?", categorie: "demandes", ordre: 0 }),
  });
  sansProbleme(resultat);
  assert.deepEqual(
    resultat.faq.questions.map((q) => q.question),
    ["Delta ?", "Gamma ?", "Alpha ?", "Beta ?", "Epsilon ?", "Zèbre ?"],
  );
});

test("les mots sont optionnels, nettoyés et sans doublon", (t) => {
  const { resultat } = construireAvec(t, {
    "a.md": fichier({ question: "Première ?" }),
    "b.md": fichier({ question: "Seconde ?", mots: " agenda ,, retard , agenda " }),
  });
  sansProbleme(resultat);
  assert.deepEqual(resultat.faq.questions.map((q) => q.mots), [[], ["agenda", "retard"]]);
});

test("les fichiers cachés et les autres extensions ne bloquent pas, ils sont signalés", (t) => {
  const { resultat } = construireAvec(t, { ".gitkeep": "", ".DS_Store": "x", "notes.txt": "x", "Q.MD": "x" });
  sansProbleme(resultat);
  assert.deepEqual(resultat.avertissements.map((a) => a.fichier).sort(), ["questions/Q.MD", "questions/notes.txt"]);
});

// ---------------------------------------------------------------------------
// Règle 1 : en-tête, catégorie, nom de fichier, longueurs
// ---------------------------------------------------------------------------

test("lireEntete : valeurs, commentaires # et lignes vides", () => {
  const e = lireEntete("---\n# un commentaire\n\nquestion: Où ?\nmots: a, b\n---\nCorps");
  assert.equal(e.valide, true);
  assert.deepEqual(e.valeurs, { question: "Où ?", mots: "a, b" });
  assert.equal(e.corps, "Corps");
  assert.deepEqual(e.lignes, { question: 4, mots: 5 });
  assert.equal(e.ligneCorps, 7);
});

test("lireEntete accepte les fins de ligne Windows et le BOM", () => {
  const e = lireEntete("﻿---\r\nquestion: Où ?\r\n---\r\nCorps\r\nsuite");
  assert.equal(e.valide, true);
  assert.equal(e.valeurs.question, "Où ?");
  assert.equal(e.corps, "Corps\nsuite");
});

test("en-tête absent", (t) => {
  const resultat = unSeulFichier(t, "question: Où ?\ncategorie: clients\nCorps");
  attendreProbleme(resultat, "entete-absent", "---");
});

test("en-tête jamais refermé", (t) => {
  const resultat = unSeulFichier(t, "---\nquestion: Où ?\ncategorie: clients\nCorps");
  attendreProbleme(resultat, "entete-non-ferme");
});

test("clé obligatoire manquante : question, puis categorie", (t) => {
  const sansQuestion = unSeulFichier(t, fichier({ question: null }));
  attendreProbleme(sansQuestion, "cle-manquante", "question");
  const sansCategorie = unSeulFichier(t, fichier({ categorie: null }));
  attendreProbleme(sansCategorie, "cle-manquante", "categorie");
});

test("clé obligatoire vide", (t) => {
  const resultat = unSeulFichier(t, fichier({ question: "" }));
  attendreProbleme(resultat, "cle-vide", "question");
});

test("clé inconnue : erreur, avec une proposition quand c'est une faute de frappe", (t) => {
  const accent = unSeulFichier(t, fichier({ entete: "question: Où ?\ncatégorie: clients" }));
  attendreProbleme(accent, "cle-inconnue", "« categorie »");
  const faute = unSeulFichier(t, fichier({ entete: "question: Où ?\ncategorie: clients\nmot: a, b" }));
  attendreProbleme(faute, "cle-inconnue", "« mots »");
  const autre = unSeulFichier(t, fichier({ entete: "question: Où ?\ncategorie: clients\nauteur: Camille" }));
  const p = attendreProbleme(autre, "cle-inconnue", "Clés admises");
  assert.equal(p.ligne, 4);
});

test("clé écrite deux fois, ligne sans deux-points, valeur entre guillemets", (t) => {
  attendreProbleme(unSeulFichier(t, fichier({ entete: "question: Où ?\nquestion: Quand ?\ncategorie: clients" })), "cle-dupliquee");
  attendreProbleme(unSeulFichier(t, fichier({ entete: "question: Où ?\ncategorie: clients\nune phrase" })), "entete-ligne");
  attendreProbleme(unSeulFichier(t, fichier({ entete: 'question: "Où ?"\ncategorie: clients' })), "entete-guillemets");
});

test("ordre doit être un entier", (t) => {
  sansProbleme(unSeulFichier(t, fichier({ ordre: 12 })));
  sansProbleme(unSeulFichier(t, fichier({ ordre: 0 })));
  for (const mauvais of ["2.5", "deux", "", "1e3", "2 3"]) {
    attendreProbleme(unSeulFichier(t, fichier({ ordre: mauvais })), "ordre-invalide");
  }
});

test("la catégorie doit exister dans categories.json", (t) => {
  const resultat = unSeulFichier(t, fichier({ categorie: "facturation" }));
  const p = attendreProbleme(resultat, "categorie-inconnue", "rendez-vous, demandes, clients");
  assert.equal(p.ligne, 3);
});

test("le nom de fichier est un identifiant en minuscules, chiffres et tirets", (t) => {
  for (const bon of ["a.md", "client-rendez-vous-introuvable.md", "q2.md", "2-roues.md"]) {
    sansProbleme(construireAvec(t, { [bon]: fichier() }).resultat);
  }
  for (const mauvais of ["Question.md", "mon fichier.md", "écran.md", "a_b.md", "-a.md", "a-.md", "a--b.md", "a.b.md"]) {
    attendreProbleme(construireAvec(t, { [mauvais]: fichier() }).resultat, "nom-fichier");
  }
});

test("la question fait 90 caractères au plus et se termine par ?", (t) => {
  const dans = `${"a".repeat(89)}?`;
  const trop = `${"a".repeat(90)}?`;
  assert.equal(dans.length, 90);
  sansProbleme(unSeulFichier(t, fichier({ question: dans })));
  attendreProbleme(unSeulFichier(t, fichier({ question: trop })), "question-longue", "91 caractères");
  attendreProbleme(unSeulFichier(t, fichier({ question: "Un client ne trouve pas son rendez-vous" })), "question-sans-point");
  attendreProbleme(unSeulFichier(t, fichier({ question: "Où ? Là" })), "question-sans-point");
});

test("la réponse n'est pas vide et fait 1 200 caractères au plus", (t) => {
  attendreProbleme(unSeulFichier(t, fichier({ corps: "" })), "reponse-vide");
  attendreProbleme(unSeulFichier(t, fichier({ corps: "  \n \n" })), "reponse-vide");
  const limite = "a".repeat(1200);
  sansProbleme(unSeulFichier(t, fichier({ corps: `\n${limite}\n` })));
  attendreProbleme(unSeulFichier(t, fichier({ corps: "a".repeat(1201) })), "reponse-longue", "1 caractère");
});

// ---------------------------------------------------------------------------
// Règle 2 : interdits
// ---------------------------------------------------------------------------

test("interdits dans la réponse", (t) => {
  const cas = [
    ["tiret cadratin", `Ouvrez Agenda ${TIRET} puis cliquez.`, "tiret-cadratin"],
    [ANCIEN_NOM, `Ouvrez ${ANCIEN_NOM}.`, "mot-interdit"],
    [`${ANCIEN_NOM.toLowerCase()} en minuscules`, `ouvrez ${ANCIEN_NOM.toLowerCase()}.`, "mot-interdit"],
    [NOM_DE_CODE, `Ouvrez ${NOM_DE_CODE}.`, "mot-interdit"],
    [`${NOM_DE_CODE.toUpperCase()} en capitales`, `OUVREZ ${NOM_DE_CODE.toUpperCase()}.`, "mot-interdit"],
    [SIGLE, `Ouvrez ${SIGLE}.`, "mot-interdit"],
    [`${SIGLE.toLowerCase()} en minuscules`, `ouvrez ${SIGLE.toLowerCase()} puis cliquez.`, "mot-interdit"],
    [`${SIGLE} entre parenthèses`, `L'application (${SIGLE}) est prête.`, "mot-interdit"],
    ["balise", "Ouvrez <b>Agenda</b>.", "html"],
    ["balise fermante", "Ouvrez Agenda</b>.", "html"],
    ["commentaire HTML", "Ouvrez <!-- caché --> Agenda.", "html"],
    ["autolien", "Voir <https://exemple.fr>.", "html"],
    ["script", "<script>alert(1)</script>", "html"],
    ["bloc de code", "Tapez :\n\n```\nnpm test\n```", "code"],
    ["bloc de code tilde", "Tapez :\n\n~~~\nnpm test\n~~~", "code"],
    ["code en ligne", "Tapez `npm test`.", "code"],
    ["code indenté", "Tapez :\n\n    npm test", "code"],
    ["titre", "# Un titre\n\nTexte.", "titre"],
    ["titre de niveau 3", "Texte.\n\n### Un titre", "titre"],
    ["titre souligné", "Un titre\n=====\n\nTexte.", "titre"],
    ["ligne de séparation", "Texte.\n\n---\n\nSuite.", "titre"],
    ["caractère de contrôle", "Ouvrez\u0007 Agenda.", "caractere-invisible"],
    ["espace de largeur nulle", `Ouvrez${String.fromCharCode(0x200b)} Agenda.`, "caractere-invisible"],
    ["texte bidirectionnel", `Ouvrez ${String.fromCharCode(0x202e)}ed.`, "caractere-invisible"],
  ];
  for (const [nom, corps, code] of cas) {
    const resultat = unSeulFichier(t, fichier({ corps }));
    assert.ok(codes(resultat).includes(code), `${nom} : « ${code} » attendu, obtenu ${JSON.stringify(codes(resultat))}`);
  }
});

test("textes voisins des interdits qui restent permis", (t) => {
  const permis = [
    "Marjorie et Rjan ne sont pas visés, ni arjuna.",
    "Si 3 <4 ou a < b, rien à signaler.",
    "Le sigle R.J. n'est pas visé.",
    "- une puce\n\n    - une sous-puce\n\n- une autre",
    "1. Ouvrez Agenda.\n2. Cliquez sur la date.",
    `Un tiret court - ou un tiret demi-cadratin ${String.fromCharCode(0x2013)} passent.`,
    "Texte avec 100 % de réussite, une URL nue https://exemple.fr et #hashtag au milieu.",
  ];
  for (const corps of permis) sansProbleme(unSeulFichier(t, fichier({ corps })));
});

test("les interdits valent aussi pour la question et les mots", (t) => {
  attendreProbleme(unSeulFichier(t, fichier({ question: `Où ${TIRET} quand ?` })), "tiret-cadratin", "La question");
  attendreProbleme(unSeulFichier(t, fichier({ question: `Où est ${SIGLE} ?` })), "mot-interdit");
  attendreProbleme(unSeulFichier(t, fichier({ question: `Où <b>est</b> ${NOM_DE_CODE} ?` })), "html");
  attendreProbleme(unSeulFichier(t, fichier({ mots: `agenda, ${ANCIEN_NOM.toLowerCase()}` })), "mot-interdit", "Les mots");
  attendreProbleme(unSeulFichier(t, fichier({ mots: `agenda ${TIRET} retard` })), "tiret-cadratin", "Les mots");
  attendreProbleme(unSeulFichier(t, fichier({ mots: "<i>agenda</i>" })), "html");
  attendreProbleme(unSeulFichier(t, fichier({ question: "Où voir [ceci](https://exemple.fr) ?" })), "lien-dans-question");
});

test("les messages disent la ligne du fichier", (t) => {
  const resultat = unSeulFichier(t, fichier({ corps: `Première ligne.\n\nTroisième ${TIRET} ligne.` }));
  const p = attendreProbleme(resultat, "tiret-cadratin");
  // ligne 1 ---, 2 question, 3 categorie, 4 ---, 5 première ligne, 6 vide, 7 fautive
  assert.equal(p.ligne, 7);
  assert.equal(p.fichier, "questions/essai.md");
  assert.match(formaterProbleme(p), /^questions\/essai\.md, ligne 7 : La réponse : le tiret cadratin/);
});

// ---------------------------------------------------------------------------
// Règle 3 : liens
// ---------------------------------------------------------------------------

test("liens admis : https et pages de l'application", (t) => {
  const corps = [
    "[site](https://exemple.fr)",
    "[page](https://exemple.fr/une/page?a=1#b)",
    "[Réglages](/reglages)",
    "[accueil](/)",
    "[ancre](/aide#autre-question)",
    "[parenthèses](https://fr.wikipedia.org/wiki/Foo_(bar))",
    "[**gras** dans le lien](https://exemple.fr)",
  ].join("\n\n");
  sansProbleme(unSeulFichier(t, fichier({ corps })));
});

test("liens refusés : http, javascript, data, mailto, tel, //, autres schémas", (t) => {
  const mauvais = [
    "http://exemple.fr",
    "HTTP://exemple.fr",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,AAAA",
    "mailto:contact@exemple.fr",
    "tel:+33123456789",
    "//exemple.fr",
    "///exemple.fr",
    "ftp://exemple.fr",
    "vbscript:x",
    "file:///etc/passwd",
    "exemple.fr",
    "reglages",
    "./reglages",
    "../reglages",
    "#ancre",
    "/\\exemple.fr",
    "https://",
    "https://exemple.fr@autre.fr",
    "https://exemple.fr/une page",
  ];
  for (const cible of mauvais) {
    const resultat = unSeulFichier(t, fichier({ corps: `Voir [ici](${cible}).` }));
    assert.ok(codes(resultat).includes("lien-cible"), `« ${cible} » devrait être refusé : ${JSON.stringify(codes(resultat))}`);
  }
});

test("liens : les contournements par crochets imbriqués, retour à la ligne ou titre sont refusés", (t) => {
  const mauvais = [
    "[a [b] c](javascript:alert(1))",
    "[a](\njavascript:alert(1))",
    "[a](  javascript:alert(1))",
    "[a](https://exemple.fr \"titre\")",
    "[a](/reglages\t//exemple.fr)",
    "[a](&#106;avascript:alert(1))",
  ];
  for (const corps of mauvais) {
    const resultat = unSeulFichier(t, fichier({ corps }));
    assert.ok(codes(resultat).includes("lien-cible"), `${JSON.stringify(corps)} devrait être refusé : ${JSON.stringify(codes(resultat))}`);
  }
  attendreProbleme(unSeulFichier(t, fichier({ corps: "[a](https://exemple.fr" })), "lien-cible", "fermée");
});

test("liens : texte vide refusé, cible vide refusée", (t) => {
  attendreProbleme(unSeulFichier(t, fichier({ corps: "Voir [](https://exemple.fr)." })), "lien-texte");
  attendreProbleme(unSeulFichier(t, fichier({ corps: "Voir [ici]()." })), "lien-cible", "vide");
});

test("liens de type référence refusés", (t) => {
  attendreProbleme(unSeulFichier(t, fichier({ corps: "Voir [texte][nom].\n\n[nom]: https://exemple.fr" })), "lien-reference");
  attendreProbleme(unSeulFichier(t, fichier({ corps: "Voir [texte] [nom]." })), "lien-reference");
  attendreProbleme(unSeulFichier(t, fichier({ corps: "Voir [texte][]." })), "lien-reference");
  attendreProbleme(unSeulFichier(t, fichier({ corps: "Voir ![alt][nom]." })), "lien-reference");
  attendreProbleme(unSeulFichier(t, fichier({ corps: "Voir.\n\n[nom]: https://exemple.fr" })), "lien-reference");
});

test("une URL nue est tolérée", (t) => {
  sansProbleme(unSeulFichier(t, fichier({ corps: "Allez sur https://exemple.fr ou http://exemple.fr." })));
});

// ---------------------------------------------------------------------------
// Règle 4 : images
// ---------------------------------------------------------------------------

test("image valide : copiée dans dist/images, alt obligatoire", (t) => {
  const racine = depot(t, {
    questions: { "a.md": fichier({ corps: "Voir.\n\n![Agenda de la semaine](images/agenda-rendez-vous.png)" }) },
    images: { "agenda-rendez-vous.png": png(2000), ".gitkeep": "" },
  });
  const resultat = construire({ racine });
  sansProbleme(resultat);
  assert.deepEqual(resultat.avertissements, []);
  assert.deepEqual(resultat.images.map((i) => i.nom), ["agenda-rendez-vous.png"]);
  const dist = ecrireDist({ racine, faq: resultat.faq, images: resultat.images });
  assert.equal(fs.statSync(path.join(dist, "images", "agenda-rendez-vous.png")).size, 2000);
  assert.ok(fs.existsSync(path.join(dist, "faq.json")));
});

test("images acceptées : png, jpg, jpeg, webp", (t) => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
  const racine = depot(t, {
    questions: { "a.md": fichier({ corps: "![a](images/a.png)\n\n![b](images/b.jpg)\n\n![c](images/c.jpeg)\n\n![d](images/d.webp)" }) },
    images: { "a.png": png(), "b.jpg": jpg, "c.jpeg": jpg, "d.webp": webp },
  });
  sansProbleme(construire({ racine }));
});

test("image : adresse externe, chemin hors images/, .. et extension non admise sont refusés", (t) => {
  const mauvais = [
    "https://exemple.fr/a.png",
    "http://exemple.fr/a.png",
    "//exemple.fr/a.png",
    "data:image/png;base64,AAAA",
    "/images/a.png",
    "images/../a.png",
    "images/../../etc/a.png",
    "images/sous/a.png",
    "../images/a.png",
    "a.png",
    "images/a.gif",
    "images/a.svg",
    "images/a.PNG",
    "images/A.png",
    "images/a b.png",
    "images/a.png.exe",
    "images/",
    "images/a",
  ];
  for (const cible of mauvais) {
    const racine = depot(t, { questions: { "a.md": fichier({ corps: `![Capture](${cible})` }) }, images: { "a.png": png() } });
    const resultat = construire({ racine });
    assert.ok(codes(resultat).includes("image-cible"), `« ${cible} » devrait être refusé : ${JSON.stringify(codes(resultat))}`);
  }
});

test("image : le fichier doit exister (casse comprise)", (t) => {
  const absente = construireAvec(t, { "a.md": fichier({ corps: "![Capture](images/absente.png)" }) }).resultat;
  attendreProbleme(absente, "image-absente", "absente.png");
  const racine = depot(t, { questions: { "a.md": fichier({ corps: "![Capture](images/agenda.png)" }) }, images: { "Agenda.png": png() } });
  attendreProbleme(construire({ racine }), "image-absente");
});

test("image : 400 Ko au maximum", (t) => {
  const limite = 400 * 1024;
  const dans = depot(t, { questions: { "a.md": fichier({ corps: "![Capture](images/a.png)" }) }, images: { "a.png": png(limite) } });
  sansProbleme(construire({ racine: dans }));
  const trop = depot(t, { questions: { "a.md": fichier({ corps: "![Capture](images/a.png)" }) }, images: { "a.png": png(limite + 1) } });
  attendreProbleme(construire({ racine: trop }), "image-lourde", "401 Ko");
});

test("image : texte alternatif non vide", (t) => {
  for (const corps of ["![](images/a.png)", "![   ](images/a.png)"]) {
    const racine = depot(t, { questions: { "a.md": fichier({ corps }) }, images: { "a.png": png() } });
    attendreProbleme(construire({ racine }), "image-alt");
  }
});

test("image : un fichier qui n'est pas une vraie image est refusé", (t) => {
  const racine = depot(t, {
    questions: { "a.md": fichier({ corps: "![Capture](images/a.png)" }) },
    images: { "a.png": "<svg onload=alert(1)></svg>" },
  });
  attendreProbleme(construire({ racine }), "image-invalide");
});

test("image : un lien symbolique est refusé", (t) => {
  const racine = depot(t, { questions: { "a.md": fichier({ corps: "![Capture](images/a.png)" }) } });
  const cible = path.join(racine, "secret.png");
  fs.writeFileSync(cible, png());
  fs.symlinkSync(cible, path.join(racine, "images", "a.png"));
  attendreProbleme(construire({ racine }), "image-invalide", "ordinaire");
});

test("image inutilisée : avertissement, pas erreur, et elle n'est pas publiée", (t) => {
  const racine = depot(t, {
    questions: { "a.md": fichier({ corps: "![Capture](images/utile.png)" }) },
    images: { "utile.png": png(), "orpheline.png": png(), "schema.svg": "<svg/>", ".gitkeep": "" },
  });
  const resultat = construire({ racine });
  sansProbleme(resultat);
  assert.deepEqual(resultat.images.map((i) => i.nom), ["utile.png"]);
  assert.deepEqual(
    resultat.avertissements.map((a) => a.fichier),
    ["images/orpheline.png", "images/schema.svg"],
  );
  assert.match(resultat.avertissements[0].message, /aucune question n'utilise/);
});

test("une image est comptée une fois même si deux questions l'utilisent", (t) => {
  const racine = depot(t, {
    questions: {
      "a.md": fichier({ question: "A ?", corps: "![Capture](images/a.png)" }),
      "b.md": fichier({ question: "B ?", corps: "![Capture](images/a.png)" }),
    },
    images: { "a.png": png() },
  });
  const resultat = construire({ racine });
  sansProbleme(resultat);
  assert.equal(resultat.images.length, 1);
});

// ---------------------------------------------------------------------------
// Règle 5 : doublons
// ---------------------------------------------------------------------------

test("deux questions avec le même texte exact sont refusées, pas deux textes proches", (t) => {
  const doublon = construireAvec(t, {
    "a.md": fichier({ question: "Où est la fiche ?" }),
    "b.md": fichier({ question: "Où est la fiche ?" }),
  }).resultat;
  const p = attendreProbleme(doublon, "doublon-question", "questions/a.md");
  assert.equal(p.fichier, "questions/b.md");
  const proches = construireAvec(t, {
    "a.md": fichier({ question: "Où est la fiche ?" }),
    "b.md": fichier({ question: "Où est la fiche client ?" }),
  }).resultat;
  sansProbleme(proches);
});

// ---------------------------------------------------------------------------
// Règle 6 : categories.json
// ---------------------------------------------------------------------------

test("categories.json : absent", (t) => {
  const racine = depot(t);
  fs.rmSync(path.join(racine, "categories.json"));
  attendreProbleme(construire({ racine }), "categories-absent");
});

test("categories.json : JSON invalide", (t) => {
  const racine = depot(t, { categoriesBrut: '[{ "id": "a", "titre": "A" },]' });
  const p = attendreProbleme(construire({ racine }), "categories-json");
  assert.equal(p.fichier, "categories.json");
});

test("categories.json : ce doit être un tableau d'objets", (t) => {
  attendreProbleme(construire({ racine: depot(t, { categoriesBrut: '{ "id": "a", "titre": "A" }' }) }), "categories-forme", "tableau");
  attendreProbleme(construire({ racine: depot(t, { categoriesBrut: '["a", "b"]' }) }), "categories-forme");
  attendreProbleme(construire({ racine: depot(t, { categoriesBrut: "[null]" }) }), "categories-forme");
});

test("categories.json : identifiants uniques et bien formés", (t) => {
  const doubles = construire({ racine: depot(t, { categories: [{ id: "a", titre: "A" }, { id: "a", titre: "Autre" }] }) });
  attendreProbleme(doubles, "categories-id-double", "« a »");
  for (const id of ["Rendez-vous", "rendez vous", "é", "-a", "a-", "a--b", "a_b", ""]) {
    attendreProbleme(construire({ racine: depot(t, { categories: [{ id, titre: "T" }] }) }), "categories-id");
  }
  attendreProbleme(construire({ racine: depot(t, { categories: [{ titre: "T" }] }) }), "categories-id");
  sansProbleme(construire({ racine: depot(t, { categories: [{ id: "rendez-vous-2", titre: "T" }] }) }));
});

test("categories.json : titres non vides", (t) => {
  for (const titre of ["", "   ", undefined, 3]) {
    attendreProbleme(construire({ racine: depot(t, { categories: [{ id: "a", titre }] }) }), "categories-titre");
  }
});

test("categories.json : mêmes interdits que les questions", (t) => {
  attendreProbleme(construire({ racine: depot(t, { categories: [{ id: "a", titre: `A ${TIRET} B` }] }) }), "tiret-cadratin");
  attendreProbleme(construire({ racine: depot(t, { categories: [{ id: "a", titre: ANCIEN_NOM }] }) }), "mot-interdit");
  attendreProbleme(construire({ racine: depot(t, { categories: [{ id: "a", titre: `Vos ${SIGLE}` }] }) }), "mot-interdit");
  attendreProbleme(construire({ racine: depot(t, { categories: [{ id: "a", titre: "<b>Gras</b>" }] }) }), "html");
  attendreProbleme(construire({ racine: depot(t, { categories: [{ id: "a", titre: "# Titre" }] }) }), "titre");
  attendreProbleme(construire({ racine: depot(t, { categories: [{ id: `${SIGLE.toLowerCase()}`, titre: "Titre" }] }) }), "mot-interdit");
});

// ---------------------------------------------------------------------------
// Exemples, marque d'exemple, dossier --dir
// ---------------------------------------------------------------------------

test("une réponse qui porte encore la mention EXEMPLE est refusée dans questions/", (t) => {
  const resultat = unSeulFichier(t, fichier({ corps: "EXEMPLE, à ne pas publier.\n\nOuvrez Agenda." }));
  attendreProbleme(resultat, "marque-exemple");
  attendreProbleme(unSeulFichier(t, fichier({ corps: "exemple à ne pas publier. Ouvrez Agenda." })), "marque-exemple");
});

test("avec --dir, la mention EXEMPLE est permise et les images sont dans <dossier>/images/", (t) => {
  const racine = depot(t);
  const essai = path.join(racine, "essai");
  fs.mkdirSync(path.join(essai, "images"), { recursive: true });
  fs.writeFileSync(path.join(essai, "images", "a.png"), png());
  fs.writeFileSync(path.join(essai, "q.md"), fichier({ corps: "EXEMPLE, à ne pas publier.\n\n![Capture](images/a.png)" }));
  const resultat = construire({ racine, dossier: essai });
  sansProbleme(resultat);
  assert.equal(resultat.essai, true);
  assert.deepEqual(resultat.images.map((i) => i.nom), ["a.png"]);
  // Les images de la racine ne sont pas cherchées en mode essai.
  fs.writeFileSync(path.join(racine, "images", "b.png"), png());
  fs.writeFileSync(path.join(essai, "r.md"), fichier({ question: "Autre ?", corps: "![Capture](images/b.png)" }));
  attendreProbleme(construire({ racine, dossier: essai }), "image-absente");
});

test("--dir vers un dossier inexistant est une erreur", (t) => {
  const racine = depot(t);
  attendreProbleme(construire({ racine, dossier: path.join(racine, "nulle-part") }), "dossier-absent");
});

test("les exemples fournis passent la validation (--dir exemples)", () => {
  const resultat = construire({ racine: DEPOT, dossier: path.join(DEPOT, "exemples") });
  sansProbleme(resultat);
  assert.deepEqual(resultat.avertissements, []);
  assert.ok(resultat.faq.questions.length >= 3);
  assert.ok(resultat.faq.categories.length >= 2);
  assert.ok(resultat.images.length >= 1);
  for (const q of resultat.faq.questions) assert.match(q.reponse, /^EXEMPLE, à ne pas publier/);
});

test("categories.json du dépôt est valide", () => {
  const resultat = construire({ racine: DEPOT, dossier: path.join(DEPOT, "exemples") });
  assert.deepEqual(resultat.problemes.filter((p) => p.fichier === "categories.json"), []);
  const ids = JSON.parse(fs.readFileSync(path.join(DEPOT, "categories.json"), "utf8")).map((c) => c.id);
  assert.deepEqual(ids, ["rendez-vous", "demandes", "clients", "factures", "reservation", "compte"]);
});

// ---------------------------------------------------------------------------
// Ligne de commande
// ---------------------------------------------------------------------------

function sortiesDe() {
  const sortie = [];
  const erreur = [];
  return { sortie, erreur, options: { sortie: (x) => sortie.push(x), sortieErreur: (x) => erreur.push(x) } };
}

test("lancer : succès, code 0, dist écrit", (t) => {
  const racine = depot(t, { questions: { "a.md": fichier() } });
  const s = sortiesDe();
  assert.equal(lancer([], { racine, ...s.options }), 0);
  assert.match(s.sortie.join("\n"), /FAQ valide : 1 question dans 1 catégorie/);
  const faq = JSON.parse(fs.readFileSync(path.join(racine, "dist", "faq.json"), "utf8"));
  assert.equal(faq.questions[0].id, "a");
  assert.deepEqual(fs.readdirSync(path.join(racine, "dist", "images")), []);
});

test("lancer : échec, code 1, messages en français un par problème, dist intact", (t) => {
  const racine = depot(t, {
    questions: {
      "a.md": fichier({ corps: `Un ${TIRET} tiret.` }),
      "b.md": fichier({ question: "Sans point", categorie: "inconnue" }),
    },
  });
  fs.mkdirSync(path.join(racine, "dist"));
  fs.writeFileSync(path.join(racine, "dist", "faq.json"), "ancienne version");
  const s = sortiesDe();
  assert.equal(lancer([], { racine, ...s.options }), 1);
  const texte = s.erreur.join("\n");
  assert.match(texte, /La validation a échoué : 3 problèmes à corriger\. Rien n'a été écrit dans dist\//);
  assert.match(texte, /1\. questions\/a\.md, ligne 5 : La réponse : le tiret cadratin est interdit/);
  assert.match(texte, /questions\/b\.md, ligne 2 : la question doit se terminer par un point d'interrogation/);
  assert.match(texte, /questions\/b\.md, ligne 3 : la catégorie « inconnue » n'existe pas/);
  assert.equal(texte.includes(TIRET), false, "les messages n'utilisent pas le tiret cadratin");
  assert.equal(fs.readFileSync(path.join(racine, "dist", "faq.json"), "utf8"), "ancienne version");
  assert.equal(fs.existsSync(path.join(racine, "dist", "images")), false);
});

test("lancer : un seul problème au singulier, et dist n'est pas créé", (t) => {
  const racine = depot(t, { questions: { "a.md": fichier({ corps: `Ouvrez ${SIGLE}.` }) } });
  const s = sortiesDe();
  assert.equal(lancer([], { racine, ...s.options }), 1);
  assert.match(s.erreur.join("\n"), /1 problème à corriger/);
  assert.equal(fs.existsSync(path.join(racine, "dist")), false);
});

test("lancer : --dir relatif au dossier courant, et options inconnues", (t) => {
  const racine = depot(t);
  fs.mkdirSync(path.join(racine, "essai"));
  fs.writeFileSync(path.join(racine, "essai", "q.md"), fichier());
  const s = sortiesDe();
  assert.equal(lancer(["--dir", "essai"], { racine, cwd: racine, ...s.options }), 0);
  assert.match(s.sortie.join("\n"), /Essai sur un autre dossier/);
  assert.equal(lancer(["--dir=essai"], { racine, cwd: racine, ...sortiesDe().options }), 0);
  const e = sortiesDe();
  assert.equal(lancer(["--dir"], { racine, ...e.options }), 1);
  assert.match(e.erreur.join("\n"), /attend un nom de dossier/);
  const inconnue = sortiesDe();
  assert.equal(lancer(["--vite"], { racine, ...inconnue.options }), 1);
  assert.match(inconnue.erreur.join("\n"), /Option inconnue/);
});

test("lancer : les avertissements s'affichent sans bloquer", (t) => {
  const racine = depot(t, { questions: { "a.md": fichier() }, images: { "orpheline.png": png() } });
  const s = sortiesDe();
  assert.equal(lancer([], { racine, ...s.options }), 0);
  assert.match(s.sortie.join("\n"), /Avertissements :\n {2}- images\/orpheline\.png : aucune question/);
});

test("la commande elle-même : code de sortie 1 en cas d'erreur, 0 sinon, rien dans dist à l'échec", (t) => {
  const racine = depot(t, { questions: { "a.md": fichier({ corps: `Un ${TIRET} tiret.` }) } });
  fs.mkdirSync(path.join(racine, "scripts"));
  fs.copyFileSync(SCRIPT, path.join(racine, "scripts", "build.mjs"));
  const lancerCommande = (...args) =>
    spawnSync(process.execPath, [path.join(racine, "scripts", "build.mjs"), ...args], { cwd: racine, encoding: "utf8" });

  const echec = lancerCommande();
  assert.equal(echec.status, 1);
  assert.match(echec.stderr, /questions\/a\.md, ligne 5 : La réponse : le tiret cadratin/);
  assert.equal(fs.existsSync(path.join(racine, "dist")), false);

  fs.writeFileSync(path.join(racine, "questions", "a.md"), fichier());
  const succes = lancerCommande();
  assert.equal(succes.status, 0, succes.stderr);
  assert.ok(fs.existsSync(path.join(racine, "dist", "faq.json")));
});
