// Uso: npm run datos-base  →  escribe migrations/0002_datos_base.sql
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sqlDatosBase } from './datos-base.ts';
import { sqlSemillaDesarrollo } from './semilla-desarrollo.ts';

const escribir = (relativo: string, contenido: string) => {
  const destino = fileURLToPath(new URL(relativo, import.meta.url));
  writeFileSync(destino, contenido);
  console.log(`Escrito ${destino}`);
};

escribir('../migrations/0002_datos_base.sql', sqlDatosBase());
escribir('../seed/desarrollo.sql', sqlSemillaDesarrollo());
