import fs from 'fs';
import path from 'path';

const inDir = process.argv[2] || './in';
const outDir = process.argv[3] || './out';

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const isRQ = (name) => /^rq_/.test(name) && name.endsWith('.json');
const isRS = (name) => /^rs_/.test(name) && name.endsWith('.json');

function stripBOM(buf) {
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.slice(3);
  }
  return buf;
}

function validateRQ(obj, name) {
  const ok = obj && typeof obj.query === 'string' && obj.variables && typeof obj.variables === 'object';
  return ok ? [] : [`[${name}] RQ inválido: debe tener "query"(string) y "variables"(obj).`];
}

function validateRS(obj, name) {
  const errs = [];
  if (!obj || typeof obj !== 'object') errs.push(`[${name}] RS inválido: raíz debe ser objeto.`);
  if (!('data' in obj)) errs.push(`[${name}] RS inválido: falta "data".`);
  return errs;
}

function extraHints(name, obj) {
  const tips = [];
  if (name === 'rs_hotels.json') {
    const hotels = obj?.data?.hotelX?.hotels;
    if (!hotels) tips.push(`[${name}] Aviso: falta data.hotelX.hotels (¿guardaste el envelope crudo?).`);
  }
  return tips;
}

const files = fs.readdirSync(inDir).filter(f => f.endsWith('.json'));
if (!files.length) {
  console.error(`No se encontraron .json en ${inDir}`);
  process.exit(1);
}

let hadErrors = false;

for (const fname of files) {
  const src = path.join(inDir, fname);
  const raw = fs.readFileSync(src);
  const nb = stripBOM(raw);
  let obj;
  try {
    obj = JSON.parse(nb.toString('utf8'));
  } catch (e) {
    console.error(`[${fname}] JSON inválido: ${e.message}`);
    hadErrors = true;
    continue;
  }

  let errs = [];
  if (isRQ(fname)) errs = errs.concat(validateRQ(obj, fname));
  if (isRS(fname)) errs = errs.concat(validateRS(obj, fname));
  errs = errs.concat(extraHints(fname, obj));

  if (errs.length) {
    hadErrors = true;
    errs.forEach(e => console.error(e));
  }

  // Copia “sanitizada” sin BOM y re-formateada
  const dst = path.join(outDir, fname);
  fs.writeFileSync(dst, JSON.stringify(obj, null, 2), { encoding: 'utf8' });
  console.log(`OK -> ${dst}`);
}

if (hadErrors) {
  console.log('\nSe detectaron problemas. Revisá los mensajes arriba. Si son solo avisos, podés probar igual con los archivos de ./out.');
} else {
  console.log('\nTodos los archivos pasaron validaciones básicas.');
}