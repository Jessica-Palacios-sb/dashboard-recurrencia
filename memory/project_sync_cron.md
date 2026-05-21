---
name: project-sync-cron
description: Sistema de caché Redis + cron de sincronización de datos cada 4 horas implementado en el dashboard
metadata:
  type: project
---

Sistema de sincronización implementado en mayo 2026.

**Why:** Los datos de Redshift tardaban 30-270 segundos en cargarse. Ahora se sirven desde Redis (<100ms) y se sincronizan automáticamente.

**How to apply:** Recordar que el cron requiere Pro plan de Vercel. Antes del deploy hay que configurar la variable de entorno `CRON_SECRET`.

## Cambios realizados

- 7 endpoints de datos modificados con cache-aside (Redis, TTL 5 horas)
- `api/sync.js`: endpoint GET (status) y POST (trigger sync)
- `vercel.json`: cron `0 */4 * * *` → `/api/sync`, maxDuration 300s para sync y recurrencia
- `auth-login.js` + `auth-session.js`: campo `superAdmin: true` para jpalacios@smartbeemo.com
- `App.js`: tab "Sincronización" visible solo para superAdmin

## Variable de entorno requerida

```
CRON_SECRET=<string aleatorio seguro>
```

Agregar en Vercel Dashboard → Settings → Environment Variables.
