---
name: rpg-backend-architect-pro
description: Disena e implementa backends RPG persistentes y en tiempo real con FastAPI, SQLModel, PostgreSQL y Redis, priorizando consistencia, seguridad y escalabilidad.
license: MIT
compatibility: opencode
metadata:
  domain: backend-architecture
  focus: rpg-persistence-realtime
  audience: backend|fullstack
  priority: high
  stack: fastapi-sqlmodel-postgresql-redis
---

## Que hago

- Construyo backends RPG listos para produccion con FastAPI async, PostgreSQL ACID y Redis para estado de baja latencia.
- Diseno arquitectura anti-exploits (dupe, race conditions, doble gasto) con transacciones atomicas y validaciones estrictas.
- Implemento modulos clave de juego: autenticacion JWT, economia, inventario, combate, cooldowns, presencia y WebSockets.

## Cuando usarme

Usame cuando el usuario pida cualquiera de estos objetivos:

- crear o refactorizar un servidor backend para RPG persistente
- implementar logica de combate, stats, fases de transformacion y progresion
- resolver consistencia de datos (XP, items, currency) bajo concurrencia real
- montar base de despliegue en Render/Replit/Vercel con CORS, health checks y configuracion segura

## Triggers (deteccion automatica)

Si el prompt contiene lenguaje cercano a estas frases, priorizame:

- "crea el backend del juego"
- "arma el servidor RPG con FastAPI"
- "evita duplicacion de items o currency"
- "necesito combate en tiempo real con websockets"

Palabras clave relacionadas:

- rpg
- fastapi
- sqlmodel
- postgresql
- asyncpg
- redis
- websocket
- jwt
- cooldown
- inventory
- economy

## Cuando NO usarme

- Si la solicitud es solo frontend/UI sin impacto en backend o tiempo real.
- Si el problema principal es DevOps avanzado (Kubernetes, Terraform, multi-region), salvo configuracion basica de despliegue.
- Si existe una skill mas especifica para organizacion de archivos o diseno visual.

## Stack base obligatorio

- Python `3.11+`
- FastAPI + Uvicorn
- SQLModel sobre SQLAlchemy 2.0 async
- PostgreSQL via `asyncpg`
- Redis async para estado efimero y sincronizacion selectiva
- Pydantic v2 con validaciones estrictas
- Alembic para migraciones de esquema

## Contratos de arquitectura (no negociables)

1. Async end-to-end
   - Todo acceso a DB y Redis debe usar `async def` y clientes async.
   - Prohibido mezclar llamadas bloqueantes en rutas criticas de juego.

2. Consistencia transaccional
   - XP, currency, inventario y recompensas usan transacciones ACID.
   - Operaciones compuestas se ejecutan en una sola unidad atomica.
   - Ante conflicto, rollback completo y respuesta idempotente.

3. Validacion estricta de dominio
   - Stats, fases y restricciones de progresion se validan antes de persistir.
   - Nunca confiar en payload del cliente para valores sensibles.

4. Redis para tiempo real
   - Cooldowns y estado de combate viven en Redis con TTL.
   - PostgreSQL no se usa para timers cortos ni presencia volatil.
   - Datos criticos en Redis se sincronizan a DB por evento (logout) o batch controlado.

5. Escalado horizontal
   - Servicios stateless; sin estado de sesion en memoria local del proceso.
   - Preparado para multiples instancias en Render/Replit/Vercel.

## Persistencia y datos

- Normalizar `DATABASE_URL`:
  - si empieza con `postgres://`, convertir a `postgresql+asyncpg://`.
- Separar modelos por responsabilidad:
  - tablas SQLModel para persistencia
  - esquemas Pydantic para entrada/salida API
- Usar Alembic para cambios de esquema en entornos compartidos.
- `SQLModel.metadata.create_all` solo en desarrollo controlado o bootstrap inicial.

## Modulos RPG recomendados

- `app/core/config.py`: settings, parseo de env vars, seguridad y CORS.
- `app/db/session.py`: engine async, session factory y helpers transaccionales.
- `app/models/`: entidades SQLModel (Player, Inventory, CurrencyLedger, SkillCooldown, etc.).
- `app/schemas/`: contratos Pydantic de requests/responses.
- `app/services/`: logica de dominio (combat, economy, progression, inventory).
- `app/game/state_machines.py`: estados de Sharingan/Byakugan/Jinchuriki y transiciones validas.
- `app/game/formulas.py`: formulas puras de damage/dodge/crit y balance hooks.
- `app/realtime/connection_manager.py`: broadcast por mapa, DM PvP/chat, control de conexiones.
- `app/api/`: routers versionados (`/api/v1/...`).

## Seguridad y autenticacion

- JWT con expiracion corta + refresh token rotativo si aplica.
- Password hashing robusto (`passlib`/`bcrypt` o equivalente seguro).
- Rate limiting en login, acciones economicas y endpoints sensibles.
- Verificacion de ownership/autorizacion en toda mutacion de recursos.

## Reglas de despliegue

- Entry point en `main.py` con `uvicorn.run(app, host="0.0.0.0", port=8080)`.
- CORS habilitado con lista explicita de origenes del frontend (Vercel u otros).
- Exponer endpoint de health check (`/health`) para plataforma.
- Mantener `requirements.txt` limpio, pinneado y sin dependencias muertas.

## Flujo de trabajo recomendado

1. Definir dominio y limites transaccionales (economia, inventario, progresion).
2. Disenar modelos y migraciones base con indices y constraints.
3. Implementar servicios de dominio primero, luego endpoints delgados.
4. Integrar Redis para cooldowns/presencia/combate y estrategia de sync.
5. Integrar JWT, permisos y controles anti abuso.
6. Implementar WebSocket manager y eventos de tiempo real.
7. Ejecutar pruebas de concurrencia, integracion y smoke de despliegue.

## Checklist de salida

- Operaciones criticas protegidas por transacciones atomicas.
- Validaciones de stats y fases aplicadas en capa de dominio.
- Redis usado para estado efimero con TTL, no para verdad historica.
- Migraciones Alembic generadas para cualquier cambio de schema.
- Auth JWT y controles de seguridad minimos implementados.
- Backend arrancable en `0.0.0.0:8080` con CORS correcto.

## Como responder

- Comenzar por la decision arquitectonica principal y el riesgo que resuelve.
- Implementar cambios reales en codigo (no solo teoria), con rutas/archivos claros.
- Reportar validaciones ejecutadas y limites conocidos.
- Si hay trade-offs, dar primero la opcion recomendada para produccion.
