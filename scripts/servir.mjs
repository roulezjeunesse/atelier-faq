// Sert dist/ sur http://localhost:4010 pour essayer la FAQ dans l'application, en local.
// L'application la lit depuis une autre adresse : le serveur autorise donc ce passage (CORS).
// Usage : node scripts/build.mjs --dir exemples && node scripts/servir.mjs [port]
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist')
const port = Number(process.argv[2] ?? 4010)
const types = { '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

createServer(async (requete, reponse) => {
  const chemin = normalize(decodeURIComponent(new URL(requete.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  const entetes = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
  try {
    const corps = await readFile(join(racine, chemin))
    reponse.writeHead(200, { ...entetes, 'content-type': types[extname(chemin)] ?? 'application/octet-stream' })
    reponse.end(corps)
  } catch {
    reponse.writeHead(404, entetes)
    reponse.end()
  }
}).listen(port, () => console.log(`La FAQ est servie sur http://localhost:${port}/faq.json`))
