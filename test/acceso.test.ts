import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verificarAccess } from '../src/worker/access';
import { usarClavesDeAccessParaPruebas } from '../src/worker/identidad';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const EQUIPO = 'mesawow.cloudflareaccess.com';
const AUD = 'aud-de-prueba';

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let claves: CryptoKeyPair;
let jwk: JsonWebKey;

const firmar = async (carga: Record<string, unknown>, cabeza: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }, par = claves) => {
  const datos = `${b64url(JSON.stringify(cabeza))}.${b64url(JSON.stringify(carga))}`;
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, new TextEncoder().encode(datos)));
  return `${datos}.${b64url(firma)}`;
};

const ahora = () => Math.floor(Date.now() / 1000);
const valido = (extra: Record<string, unknown> = {}) =>
  ({ iss: `https://${EQUIPO}`, aud: [AUD], email: 'Bruno@mesawow.test', exp: ahora() + 600, iat: ahora(), ...extra });

const nuevoPar = () =>
  crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;

beforeAll(async () => {
  claves = await nuevoPar();
  jwk = { ...(await crypto.subtle.exportKey('jwk', claves.publicKey) as JsonWebKey), kid: 'k1' } as JsonWebKey;
  usarClavesDeAccessParaPruebas(async () => [jwk]);
});
afterAll(() => usarClavesDeAccessParaPruebas(undefined));

const config = { equipo: EQUIPO, aud: AUD, obtenerClaves: async () => [jwk] };

describe('verificación del JWT de Cloudflare Access', () => {
  it('acepta un token válido y devuelve el correo en minúsculas', async () => {
    expect(await verificarAccess(await firmar(valido()), config)).toBe('bruno@mesawow.test');
  });

  it.each([
    ['emisor distinto', { iss: 'https://otro.cloudflareaccess.com' }, /Emisor/],
    ['audiencia de otra aplicación', { aud: ['otra'] }, /Audiencia/],
    ['vencido', { exp: ahora() - 3600 }, /vencida/],
    ['sin correo', { email: undefined }, /correo/],
  ])('rechaza un token con %s', async (_, extra, error) => {
    await expect(verificarAccess(await firmar(valido(extra)), config)).rejects.toThrow(error);
  });

  it('rechaza una firma hecha con otra clave', async () => {
    const otra = await nuevoPar();
    await expect(verificarAccess(await firmar(valido(), undefined, otra), config)).rejects.toThrow(/Firma/);
  });

  it('rechaza algoritmos distintos de RS256 (p. ej. "none")', async () => {
    const t = `${b64url(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${b64url(JSON.stringify(valido()))}.`;
    await expect(verificarAccess(t, config)).rejects.toThrow(/Algoritmo/);
  });

  it('rechaza un token alterado', async () => {
    const [h, , f] = (await firmar(valido())).split('.');
    const alterado = `${h}.${b64url(JSON.stringify(valido({ email: 'ana@mesawow.test' })))}.${f}`;
    await expect(verificarAccess(alterado, config)).rejects.toThrow(/Firma/);
  });
});

describe('ingreso en staging y production', () => {
  const produccion = { ...env, ENTORNO: 'production', ACCESS_EQUIPO: EQUIPO, ACCESS_AUD: AUD } as unknown as Env;
  beforeEach(cargarSemilla);

  it('entra con el JWT de Access e ignora la identidad de desarrollo', async () => {
    const r = await llamar('/me', { entorno: produccion, como: 'ana@mesawow.test', cabeceras: { 'cf-access-jwt-assertion': await firmar(valido()) } });
    expect(r.status).toBe(200);
    expect(r.cuerpo.persona.id).toBe('demo-bruno');
  });

  it('sin JWT pide iniciar sesión', async () => {
    const r = await llamar('/me', { entorno: produccion, como: 'ana@mesawow.test' });
    expect(r.status).toBe(401);
    expect(r.cuerpo.error.code).toBe('sin_sesion');
  });

  it('con un JWT inválido responde sesión inválida', async () => {
    const r = await llamar('/me', { entorno: produccion, cabeceras: { 'cf-access-jwt-assertion': 'a.b.c' } });
    expect(r.status).toBe(401);
    expect(r.cuerpo.error.code).toBe('sesion_invalida');
  });

  it('un correo verificado que no es del equipo no entra', async () => {
    const r = await llamar('/me', { entorno: produccion, cabeceras: { 'cf-access-jwt-assertion': await firmar(valido({ email: 'extrano@gmail.com' })) } });
    expect(r.status).toBe(403);
    expect(r.cuerpo.error.code).toBe('sin_acceso');
  });
});
