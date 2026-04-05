---
name: modern-ux-ui-pro
description: Disena y mejora UX/UI de interfaces web y app web con estandares modernos en layout, color, temas, tipografia e iconografia.
license: MIT
compatibility: opencode
metadata:
  domain: product-design
  focus: ux-ui-modernization
  audience: frontend
  priority: high
---

## Que hago

- Diseno y refactorizo interfaces con enfoque UX/UI moderno, claro y consistente.
- Defino sistemas visuales escalables: paleta, temas, tipografia, iconografia y componentes base.
- Convierto pantallas con deuda visual en experiencias solidas, accesibles y listas para produccion.

## Cuando usarme

Usame cuando el usuario pida:

- modernizar la interfaz de una web o app web
- mejorar usabilidad, jerarquia visual y conversion
- definir o rehacer paleta de colores y temas (light/dark/brand)
- profesionalizar tipografia, iconos, espaciado y consistencia visual

## Triggers (deteccion automatica)

Si el prompt contiene lenguaje cercano a estas frases, priorizame:

- "moderniza la UI"
- "mejora la experiencia de usuario"
- "hazla mas profesional"
- "redefine colores y tipografia"

Palabras clave relacionadas:

- ux
- ui
- jerarquia visual
- design system
- paleta
- tipografia
- iconografia

## Cuando NO usarme

- Si el pedido es solo de logica backend o integraciones sin impacto visual.
- Si existe una skill mas especifica para el stack visual solicitado (por ejemplo Tailwind responsive).
- Si la tarea es un ajuste menor aislado que no requiere estrategia UX/UI.

## Principios de diseno profesional

- Claridad sobre decoracion: la interfaz comunica primero, adorna despues.
- Consistencia sistemica: decisiones globales sobre excepciones locales.
- Jerarquia evidente: el usuario debe entender que hacer en segundos.
- Accesibilidad por defecto: contraste, foco y legibilidad nunca opcionales.
- Escalabilidad: tokens y patrones que soporten crecimiento del producto.

## Flujo de trabajo exhaustivo

1. Diagnostico UX/UI
   - Auditar problemas de navegacion, friccion, densidad, ruido visual, accesibilidad y coherencia.
   - Identificar pantallas y componentes criticos por impacto de negocio y frecuencia de uso.
2. Sistema visual base
   - Definir tokens de color, tipografia, espaciado, radios, elevacion y motion.
   - Establecer convenciones de layout responsive y comportamiento por breakpoint.
3. Arquitectura de componentes
   - Estandarizar primitives (button, input, card, badge, modal, tabs, table/list).
   - Garantizar estados completos: default, hover, focus-visible, active, disabled, loading, error, success.
4. Temas y branding
   - Crear tema base + variantes (light/dark/brand) con contraste verificado.
   - Evitar hardcodes de color; usar variables/tokens semanticos.
5. Implementacion incremental
   - Aplicar mejoras por modulos para reducir riesgo y facilitar revision.
   - Medir impacto en legibilidad, conversion y estabilidad visual.
6. Validacion final
   - Verificar responsive, accesibilidad, consistencia, rendimiento visual y microinteracciones.

## Paleta de colores (estandar moderno)

- Definir 3 niveles:
  - `brand`: identidad principal del producto
  - `semantic`: success, warning, danger, info
  - `neutral`: texto, bordes, superficies y fondos
- Usar escalas tonales consistentes (ej. 50-900) para control de contraste.
- Evitar colores saturados en grandes superficies; reservarlos para acentos y acciones clave.
- Verificar contraste minimo recomendado:
  - texto normal: >= 4.5:1
  - texto grande: >= 3:1
  - elementos de UI y foco: suficientemente distinguibles del fondo

## Temas (light, dark y marca)

- Implementar temas con tokens semanticos (`--bg`, `--fg`, `--surface`, `--border`, `--primary`, etc.).
- Mantener equivalencia funcional entre temas (no perder estados ni jerarquia).
- Preservar identidad de marca sin sacrificar legibilidad ni accesibilidad.
- Evitar dark mode de bajo contraste (gris sobre gris); priorizar profundidad clara por capas.

## Tipografia profesional

- Seleccionar familias con rol definido:
  - display (titulares),
  - text (lectura),
  - mono (datos/codigo cuando aplique).
- Definir escala tipografica coherente (tamano, peso, interlineado y tracking).
- Limitar la cantidad de pesos para mantener consistencia y rendimiento.
- Garantizar longitud de linea comoda en desktop y lectura compacta en movil.

## Iconografia moderna

- Unificar set de iconos (misma familia, grosor y estilo visual).
- Tamano consistente por contexto (16/20/24) y alineacion optica con texto.
- Iconos siempre con semantica clara; evitar decoracion ambigua.
- En acciones criticas, combinar icono + texto para reducir errores.

## Layout y espaciado

- Construir con grid y ritmo vertical consistente; evitar margenes improvisados.
- Aplicar reglas de contencion (`max-width`, paddings adaptativos, sin overflow horizontal).
- Definir densidad por contexto (dashboard, formularios, tablas, vistas de detalle).
- Mantener targets tactiles comodos en movil (>=44px recomendado).

## Motion y feedback

- Usar animaciones con proposito: onboarding visual, transiciones de estado, feedback de accion.
- Duraciones cortas y naturales; evitar animaciones intrusivas o repetitivas.
- Incluir `prefers-reduced-motion` para usuarios sensibles al movimiento.

## Reglas no negociables

- No mezclar multiples lenguajes visuales en una misma interfaz.
- No introducir colores, fuentes o iconos fuera del sistema definido.
- No dejar componentes sin estados de foco y error.
- No usar contrastes insuficientes ni tamanos de texto ilegibles.
- No priorizar "estetica" sobre comprension y usabilidad real.

## Checklist de salida

- Jerarquia visual clara en todas las pantallas principales.
- Sistema de colores consistente, accesible y reusable.
- Temas funcionales sin regresiones visuales ni de contraste.
- Tipografia legible y consistente en movil/tablet/desktop.
- Iconografia coherente y semantica.
- Componentes con estados completos y feedback claro.
- Sin desbordes horizontales ni saltos de layout.

## Como responder

- Explicar primero la direccion visual propuesta y el criterio UX.
- Implementar cambios reales en codigo, no solo recomendaciones teoricas.
- Reportar decisiones de paleta, temas, tipografia e iconografia con justificacion.
- Validar por breakpoints clave (360, 768, 1024, 1280) y estados interactivos.
- Si hay trade-offs, ofrecer primero la opcion recomendada de nivel profesional.
