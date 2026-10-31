// Utilidades mínimas para escribir SQL literal (scripts de generación e importación).

export const q = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};

export const insert = (tabla: string, fila: Record<string, unknown>, modo: 'INSERT' | 'INSERT OR REPLACE' | 'INSERT OR IGNORE' = 'INSERT') => {
  const cols = Object.keys(fila);
  return `${modo} INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map((c) => q(fila[c])).join(', ')});`;
};

export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
