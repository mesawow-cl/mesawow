import { render } from 'preact';
import { entrarComo } from './api';
import { App } from './App';
import { registrarServiceWorker } from './pwa';
import { MesaPublica } from './vistas/Estrategia';
import { guardarTokenDeInvitacion } from './vistas/Registro';
import './estilos/tokens.css';
import './estilos/base.css';
import './estilos/shell.css';
import './estilos/vistas.css';

// Atajo de desarrollo: ?entrar=correo@mesawow.test elige la persona de ejemplo (no existe en producción).
if (import.meta.env.DEV) {
  const url = new URL(location.href);
  const correo = url.searchParams.get('entrar');
  if (correo) {
    entrarComo(correo);
    url.searchParams.delete('entrar');
    history.replaceState(null, '', url.pathname + url.search);
  }
}

guardarTokenDeInvitacion();
registrarServiceWorker();
// mesawow.cl (y /mandantes en local) es la vista pública de mandantes; app.mesawow.cl es la app del equipo (D1).
const esPublica = /^(www\.)?mesawow\.cl$/.test(location.hostname) || location.pathname === '/mandantes';
render(esPublica ? <MesaPublica /> : <App />, document.getElementById('raiz')!);
