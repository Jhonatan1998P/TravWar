---
name: workspace-file-organization-pro
description: Organiza archivos y carpetas del workspace con criterios profesionales de estructura, nombres, mantenibilidad y escalabilidad.
license: MIT
compatibility: opencode
metadata:
  domain: project-structure
  focus: file-organization
  audience: engineering
  priority: high
---

## Que hago

- Diseno una estructura de carpetas clara por dominio, capa o feature.
- Estandarizo nombres de archivos y convenciones para reducir friccion.
- Reubico archivos de forma segura, minimizando deuda tecnica y rutas fragiles.

## Cuando usarme

Usame cuando se necesite:

- ordenar un proyecto con archivos dispersos o inconsistentes
- separar responsabilidades (core, shared, features, infra, ui, tests)
- limpiar duplicaciones de utilidades, componentes o modulos
- preparar una base escalable para crecimiento del producto

## Triggers (deteccion automatica)

Si el prompt contiene lenguaje cercano a estas frases, priorizame:

- "ordena la estructura del proyecto"
- "reorganiza carpetas y archivos"
- "limpia modulos duplicados"
- "deja una arquitectura escalable"

Palabras clave relacionadas:

- estructura
- carpetas
- convenciones
- imports
- modularizacion
- escalabilidad

## Cuando NO usarme

- Si la solicitud es solo implementar una feature sin cambios estructurales.
- Si se pide un rediseo UX/UI sin necesidad de mover archivos.
- Si existe una skill mas especifica para el stack visual o framework del problema.

## Flujo profesional de ordenamiento

1. Auditar estructura actual y detectar anti-patrones (carpetas cajon, nombres ambiguos, imports circulares).
2. Definir criterio de organizacion (por feature, por capas o hibrido) respetando el stack actual.
3. Proponer plan de migracion incremental con riesgo bajo y cambios trazables.
4. Mover archivos por bloques pequenos y actualizar imports en cada bloque.
5. Validar build, tests y lint despues de cada bloque relevante.
6. Documentar convenciones para que el orden se mantenga en el tiempo.

## Reglas no negociables

- No mover archivos de forma masiva sin plan y sin actualizar referencias.
- Mantener nombres explicitos, consistentes y orientados a responsabilidad.
- Evitar abreviaturas oscuras en carpetas o archivos.
- No introducir nuevas convenciones que rompan el estilo existente del repositorio.
- Priorizar cambios pequenos, reversibles y faciles de revisar en PR.

## Estandares recomendados

- Features: `src/features/<feature>/...`
- Compartido: `src/shared/{ui,lib,types,config}/...`
- Infra/core: `src/core/...` o `src/infrastructure/...` segun proyecto
- Tests junto al codigo o en `tests/` con criterio consistente
- Nombres: kebab-case en archivos, PascalCase solo para componentes/clases cuando aplique

## Checklist de calidad

- No hay imports rotos ni rutas huerfanas.
- Build y tests pasan tras el reordenamiento.
- Cada carpeta tiene una responsabilidad clara.
- No hay duplicados obvios de helpers o componentes.
- La navegacion del proyecto mejora para nuevos contribuidores.

## Como responder

- Explica primero el criterio de organizacion elegido y por que.
- Ejecuta la reorganizacion por etapas, no en un solo bloque riesgoso.
- Reporta archivos movidos y decisiones clave en lenguaje claro.
- Incluye verificaciones finales (build/test/lint) cuando sea posible.
