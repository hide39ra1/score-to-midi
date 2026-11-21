import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const base = 'https://dsalex1.github.io/sheetscan/'
const files = ['homr.zip', 'models/segnet.onnx', 'models/encoder.onnx', 'models/decoder.onnx']
let manifest
try { manifest = JSON.parse(await readFile('assets-lock.json', 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
const hashes = {}
for (const name of files) {
  let bytes
  try { bytes = await readFile(`public/${name}`) } catch (e) { if (e.code !== 'ENOENT') throw e }
  if (!bytes) {
    console.log(`Downloading ${name}`)
    const response = await fetch(base + name)
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (manifest && manifest.files[name] !== hash) throw new Error(`Asset checksum mismatch: ${name}`)
  hashes[name] = hash
  await mkdir(`public/${name.split('/').slice(0, -1).join('/')}`, { recursive: true })
  await writeFile(`public/${name}`, bytes)
  console.log(`${name}: ${bytes.length} bytes, ${hash}`)
}
if (!manifest) await writeFile('assets-lock.json', JSON.stringify({ source: base, files: hashes }, null, 2) + '\n')
