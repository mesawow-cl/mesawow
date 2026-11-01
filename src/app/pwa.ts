// App instalable (PWA) y avisos push del teléfono o el computador.
import { useEffect, useState } from 'preact/hooks';
import { pedir } from './api';

interface EventoInstalar extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let instalar: EventoInstalar | null = null;
const eventos = new EventTarget();

export const registrarServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); instalar = e as EventoInstalar; eventos.dispatchEvent(new Event('cambio')); });
  addEventListener('appinstalled', () => { instalar = null; eventos.dispatchEvent(new Event('cambio')); });
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* sin service worker: la app funciona igual */ }); });
};

export const instalada = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const esIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Estado del botón "Instalar app": 'listo' (el navegador ofrece instalar), 'ios' (instrucciones), 'instalada' o null. */
export const useInstalar = () => {
  const calcular = () => instalada() ? 'instalada' as const : instalar ? 'listo' as const : esIos() ? 'ios' as const : null;
  const [estado, setEstado] = useState(calcular);
  useEffect(() => {
    const f = () => setEstado(calcular());
    eventos.addEventListener('cambio', f);
    return () => eventos.removeEventListener('cambio', f);
  }, []);
  const pedirInstalar = async () => {
    if (!instalar) return;
    await instalar.prompt();
    await instalar.userChoice;
    instalar = null;
    setEstado(calcular());
  };
  return { estado, pedirInstalar };
};

const aBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

export const pushSoportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Pide permiso y suscribe este dispositivo. Devuelve un mensaje para la persona. */
export const activarPush = async (clavePublica: string) => {
  if (!pushSoportado()) return esIos() && !instalada()
    ? 'En iPhone, primero instala mesawow (Compartir → Agregar a inicio) y actívalo desde la app instalada.'
    : 'Este navegador no permite avisos push.';
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return 'No diste permiso para avisos. Puedes cambiarlo en los ajustes del navegador.';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(clavePublica) });
  await pedir('/me/push', { method: 'POST', json: sub.toJSON() });
  return 'Avisos push activados en este dispositivo.';
};

export const desactivarPush = async () => {
  if (!pushSoportado()) return;
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  if (!sub) return;
  await pedir('/me/push', { method: 'DELETE', json: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
};

export const pushEnEsteDispositivo = async () => {
  if (!pushSoportado() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
};
