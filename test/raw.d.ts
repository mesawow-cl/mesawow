// Importaciones de texto de Vite (p. ej. migraciones SQL en las pruebas).
declare module '*?raw' {
  const contenido: string;
  export default contenido;
}
