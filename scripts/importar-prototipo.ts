// Importa el respaldo del prototipo (respaldo_mesa.json).
//
//   npm run importar -- ruta/respaldo_mesa.json              → genera importacion/ y muestra el informe
//   npm run importar -- ruta/respaldo_mesa.json --aplicar-local  → además lo carga en D1 y R2 locales
//
// La carpeta importacion/ puede contener datos personales: está en .gitignore y no se sube.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importarRespaldo } from '../src/importador/importar.ts';

const [ruta, ...banderas] = process.argv.slice(2);
if (!ruta) {
  console.error('Uso: npm run importar -- ruta/respaldo_mesa.json [--aplicar-local]');
  process.exit(1);
}

const raiz = fileURLToPath(new URL('..', import.meta.url));
const salida = join(raiz, 'importacion');
const { sql, archivos, informe } = importarRespaldo(JSON.parse(readFileSync(ruta, 'utf8')), { ahora: new Date().toISOString() });

rmSync(salida, { recursive: true, force: true });
mkdirSync(join(salida, 'archivos'), { recursive: true });
writeFileSync(join(salida, 'importar.sql'), sql.join('\n') + '\n');
writeFileSync(join(salida, 'informe.json'), JSON.stringify(informe, null, 2));
for (const a of archivos) {
  const destino = join(salida, 'archivos', a.clave);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, a.base64 !== undefined ? Buffer.from(a.base64, 'base64') : a.texto ?? '');
}

console.log('Filas por tabla:');
for (const [t, n] of Object.entries(informe.filas).sort()) console.log(`  ${t.padEnd(24)} ${n}`);
console.log(`Archivos para R2: ${archivos.length}`);
for (const [k, n] of Object.entries(informe.descartado)) console.log(`No se importa: ${k} (${n})`);
console.log(`Advertencias: ${informe.advertencias.length} (detalle en importacion/informe.json)`);
for (const a of informe.advertencias.slice(0, 15)) console.log(`  · ${a}`);

if (banderas.includes('--aplicar-local')) {
  const wrangler = (args: string[]) => execFileSync('npx', ['wrangler', ...args], { cwd: raiz, stdio: 'inherit' });
  wrangler(['d1', 'execute', 'DB', '--local', `--file=${join(salida, 'importar.sql')}`]);
  for (const a of archivos) {
    wrangler(['r2', 'object', 'put', `mesawow-archivos-local/${a.clave}`, '--local', `--file=${join(salida, 'archivos', a.clave)}`, `--content-type=${a.tipo}`]);
  }
  console.log('Importación aplicada en la base local.');
}
