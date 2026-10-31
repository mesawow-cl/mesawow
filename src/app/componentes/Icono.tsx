// Íconos de línea (trazo 2, puntas redondas) que heredan el color del texto.
const TRAZOS: Record<string, string> = {
  home: 'M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10',
  check: 'M9 4h6M9 4a1 1 0 0 0-1 1v1h8V5a1 1 0 0 0-1-1M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 14l2 2 4-4',
  layers: 'm12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5',
  rocket: 'M5 15c-1.5 1-2 4-2 6 2 0 5-.5 6-2M9 15l-3-3c1-4 4-8 10-9 1 5-4 9-7 12ZM15 9a1.5 1.5 0 1 0 0-.01M10 7H6l-3 3 4 1M17 14v4l-3 3-1-4',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M18 14a5 5 0 0 1 4 5v2',
  bell: 'M6 9a6 6 0 1 1 12 0c0 6 3 8 3 8H3s3-2 3-8M10 21a2 2 0 0 0 4 0',
  plus: 'M12 5v14M5 12h14',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  x: 'M6 6l12 12M18 6 6 18',
  smile: 'M4 13c3 5 13 5 16 0',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z',
  trophy: 'M8 4h8v6a4 4 0 0 1-8 0V4ZM8 6H4a4 4 0 0 0 4 4M16 6h4a4 4 0 0 1-4 4M12 14v4M8 21h8',
};

export type NombreIcono = keyof typeof TRAZOS;

export const Icono = ({ nombre, tam = 22 }: { nombre: NombreIcono; tam?: number }) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d={TRAZOS[nombre]} />
  </svg>
);
