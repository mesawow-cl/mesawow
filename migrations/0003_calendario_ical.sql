-- Google Calendar por enlaces iCal (sin OAuth):
--   ical_cifrado: dirección secreta iCal de la persona, cifrada (AES-GCM) con CLAVE_CIFRADO.
--   enlace_hash:  huella SHA-256 del token del enlace privado con sus bloques de trabajo.
ALTER TABLE calendar_links ADD COLUMN ical_cifrado TEXT;
ALTER TABLE calendar_links ADD COLUMN enlace_hash TEXT;
CREATE UNIQUE INDEX calendar_links_enlace ON calendar_links(enlace_hash) WHERE enlace_hash IS NOT NULL;
