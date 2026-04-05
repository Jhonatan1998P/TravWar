---
name: tailwind-responsive-pro
description: Disena y refactoriza interfaces con TailwindCSS mobile-first, accesibles, mantenibles y visualmente profesionales.
license: MIT
compatibility: opencode
metadata:
  stack: tailwindcss
  focus: responsive-ui
  audience: frontend
  priority: high
---

## Que hago

- Diseno y desarrollo UI responsive con enfoque mobile-first usando TailwindCSS.
- Convierto layouts fragiles en sistemas estables de breakpoints, espaciado y tipografia.
- Aplico practicas profesionales de accesibilidad, rendimiento y consistencia visual.

## Cuando usarme

Usame cuando el usuario pida hacer responsive una vista o mejorar UX en movil/tablet/desktop.

## Triggers (deteccion automatica)

Si el prompt contiene lenguaje cercano a estas frases, priorizame:

- "hazlo responsive"
- "arregla la vista en movil"
- "refactoriza con tailwind"
- "mejora breakpoints y layout"

Palabras clave relacionadas:

- tailwind
- mobile-first
- breakpoints
- overflow
- grid
- flex
- spacing

## Cuando NO usarme

- Si el proyecto no usa TailwindCSS ni utilidades equivalentes.
- Si la tarea es puramente visual de branding sin foco responsive.
- Si existe una skill mas especifica para reorganizacion de archivos o arquitectura.

## Flujo de trabajo

1. Auditar layout actual en movil, tablet y desktop.
2. Corregir base mobile-first y escalar con breakpoints minimos necesarios.
3. Ajustar tipografia, espaciado, grid/flex y contencion para evitar desbordes.
4. Validar estados interactivos, foco, targets tactiles y legibilidad.
5. Reportar cambios por pantalla/componente y verificaciones realizadas.

## Reglas no negociables

- Siempre mobile-first.
- Sin overflow horizontal no intencional.
- Targets tactiles >= 44px.
- Breakpoints progresivos (`sm`, `md`, `lg`, `xl`, `2xl`) solo cuando aporten valor.

## Checklist de salida

- Vista estable desde 360px hasta desktop sin saltos bruscos.
- Componentes clave adaptados por breakpoint con criterio.
- Interacciones accesibles (focus-visible, hover cuando aplique, estados disabled/error).
- Clases Tailwind limpias, consistentes y mantenibles.

## Como responder

- Explicar primero el problema responsive principal y el enfoque aplicado.
- Entregar cambios concretos en codigo, no recomendaciones abstractas.
- Incluir archivos tocados y impacto en movil/tablet/desktop.
