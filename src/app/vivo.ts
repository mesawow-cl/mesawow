// Conexión en vivo: un WebSocket por pestaña, con reconexión automática (pensada para el teléfono:
// pérdida de señal, pantalla bloqueada, cambio de red). Cada señal de cambio incrementa un "latido";
// las pantallas lo usan como dependencia para volver a pedir sus datos.
import { useEffect, useState } from 'preact/hooks';
import { hayEntrarComo } from './api';

const eventos = new EventTarget();
let latido = 0;
let estado: 'conectado' | 'reconectando' = 'reconectando';
let ws: WebSocket | null = null;
let espera = 1000;
let reintento: ReturnType<typeof setTimeout> | undefined;
let ping: ReturnType<typeof setInterval> | undefined;
let pendiente: ReturnType<typeof setTimeout> | undefined;
let activo = false;

const avisar = () => {
  // Varias señales seguidas se juntan en un solo latido.
  clearTimeout(pendiente);
  pendiente = setTimeout(() => { latido++; eventos.dispatchEvent(new Event('latido')); }, 500);
};
const fijarEstado = (e: typeof estado) => { estado = e; eventos.dispatchEvent(new Event('estado')); };

const abrir = () => {
  if (!activo || (ws && ws.readyState <= WebSocket.OPEN)) return;
  const url = new URL('/api/v1/vivo', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (hayEntrarComo()) { try { url.searchParams.set('como', localStorage.getItem('mesawow:entrar-como') ?? ''); } catch { /* sin almacenamiento */ } }
  const s = new WebSocket(url);
  ws = s;
  s.onopen = () => {
    espera = 1000;
    fijarEstado('conectado');
    clearInterval(ping);
    ping = setInterval(() => { if (s.readyState === WebSocket.OPEN) s.send('ping'); }, 25_000);
    avisar(); // al reconectar, ponerse al día
  };
  s.onmessage = (e) => { if (e.data !== 'pong') avisar(); };
  s.onclose = () => {
    clearInterval(ping);
    if (ws === s) ws = null;
    fijarEstado('reconectando');
    if (!activo) return;
    clearTimeout(reintento);
    reintento = setTimeout(abrir, espera);
    espera = Math.min(espera * 2, 30_000);
  };
};

/** Inicia la conexión (una vez por sesión). */
export const iniciarEnVivo = () => {
  if (activo) return;
  activo = true;
  abrir();
  // Al volver a la pestaña o recuperar la red, reconectar al tiro.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { espera = 1000; abrir(); } });
  addEventListener('online', () => { espera = 1000; abrir(); });
};

export const detenerEnVivo = () => { activo = false; clearTimeout(reintento); ws?.close(); };

/** Número que cambia con cada señal en vivo: úsalo como dependencia para volver a pedir datos. */
export const useLatido = () => {
  const [n, setN] = useState(latido);
  useEffect(() => {
    const f = () => setN(latido);
    eventos.addEventListener('latido', f);
    return () => eventos.removeEventListener('latido', f);
  }, []);
  return n;
};

export const useEstadoEnVivo = () => {
  const [e, setE] = useState(estado);
  useEffect(() => {
    const f = () => setE(estado);
    eventos.addEventListener('estado', f);
    return () => eventos.removeEventListener('estado', f);
  }, []);
  return e;
};
