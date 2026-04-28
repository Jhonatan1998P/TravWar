# Reconexión tunel y email al restaurar internet

**Session ID:** ses_22b524455ffe3dB9VeCOnckEW3
**Created:** 4/28/2026, 3:20:48 PM
**Updated:** 4/28/2026, 3:27:44 PM

---

## User

el archivo @SecureVault-V2.py funciona bien solo que cuando se pierde la conexion a internet por unos minutos el tunel se pierde y cuando la pc vuelve a conectarse a internet el tunel ya caduco y no funciona por ende no puedo vovler a conectr a la computadora atra ves del tunel publico. lo ideal seria que tenga reintentos de conexion cuando se valla la conexion a internet y que cuando restabklezca la conexion con la ip publica que me envie otra vez un correo con la nuevas direcciones ip. lo demas dejalo tal y como esta

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: todowrite**

---

## Assistant

Voy a hacer dos cambios clave:

1. **`Tunel._keep()`** - Detectar cuando el proceso cloudflared muere y lanzar reintento automático
2. **`Monitor._ciclo()`** - Detectar pérdida de internet, esperar reconexión, y al volver enviar email con la nueva URL

Empezando por `_keep()`:

**Tool: edit**

---

## Assistant

**Tool: todowrite**

---

## User

continue

---

## Assistant

---

