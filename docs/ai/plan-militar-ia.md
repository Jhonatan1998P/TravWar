# Plan militar IA

## Marco
- El enfoque correcto, usado en RTS/MMO de guerra persistente que funcionan, es este: `StrategicAI` como **planner ofensivo**, `reactive` como **controlador tactico/defensivo**, y un **contrato unico de combate** para que ambos decidan con la misma verdad.
- La regla madre debe ser: **ningun ataque PVP importante sin inteligencia fresca**.
- La segunda regla madre debe ser: **si `reactive` declara riesgo alto o esquiva pendiente, `StrategicAI` no puede gastar esas tropas**.
- La tercera regla madre debe ser: **cada tribu debe tener doctrina propia**, no solo numeros distintos.

## Doctrina Inicial
- **Germano**: ofensiva, presion, castigo a objetivos expuestos, acepta mas riesgo, preserva su nucleo ofensivo cuando va a perder, contraataca mas.
- **Egipcio**: defensiva, scouting mas disciplinado, refuerzo imperial, evita ataques inciertos, contraataca menos y prefiere `counterpressure` antes que `all-in`.

## Fase 1: Contrato Unico de Combate
- Objetivo: separar responsabilidades y eliminar contradicciones entre motor ofensivo y motor reactivo.
- `StrategicAI.js` debe ser dueno solo de: scouting ofensivo, scoring de objetivos, seleccion de fuerza, commit de ataque, cancelacion por riesgo.
- `reactive.js` debe ser dueno solo de: evaluacion de amenaza entrante, hold, reinforce, dodge, counterpressure, counterattack puntual.
- Ambos deben compartir el mismo vocabulario minimo: `threatLevel`, `threatType`, `intelFresh`, `lastIntelAt`, `preferredResponse`, `offenseSuppressed`, `reservedTroops`, `counterWindowOpen`, `attackerVillageId`.
- Debe quedar una prioridad clara de capa: `dodge/reinforce reactivo > defensa local > contraataque reactivo > ataque estrategico > farmeo`.
- Aunque el foco sean dos archivos, aqui hace falta una integracion minima en `AIController.js` para que el arbitraje haga cumplir estas reglas. Sin eso, seguiran siendo “compatibles en codigo” pero no “coherentes en juego”.
- Validacion real: provocar un ataque entrante mientras la IA tiene tropas listas para atacar y verificar en logs que el planner ofensivo se frena si la defensa lo exige.
- Criterio de salida: ningun movimiento ofensivo debe salir desde una aldea con `dodge` pendiente, `movementLock`, amenaza alta o tropas reservadas.

## Fase 2: Inteligencia Fresca y Ciclo de Scouts
- Objetivo: convertir la inteligencia en requisito obligatorio de decision militar contra aldeas de jugadores/IA.
- Regla central: no se ataca una aldea enemiga si no existe reporte de espionaje fresco.
- La frescura no debe ser unica para todo. Debe tener TTL por contexto.
- Germano: TTL mas corto para objetivos militares y para nemesis; reintento agresivo si falla el scout.
- Egipcio: TTL tambien corto, pero con mas prioridad a refrescar intel del atacante reciente y del vecino peligroso.
- La intel debe invalidarse si ocurre alguno de estos casos: expiro el TTL, el objetivo lanzo ataques recientemente, hubo reporte de combate reciente, fallo una incursion, cambio el valor estrategico del objetivo o existe sospecha de refuerzo.
- `StrategicAI.js` debe pasar de “scout como ayuda” a “scout como gate”.
- `reactive.js` debe abrir una necesidad de re-scout del atacante tras defender un ataque importante o tras detectar multi-wave, siege o conquest.
- Validacion real: intentar que la IA ataque una aldea con intel vieja; debe scoutear primero y no atacar hasta tener dato fresco.
- Criterio de salida: toda decision ofensiva PVP debe mostrar en log el `lastIntelAt`, el TTL aplicado y el motivo de validez o bloqueo.

## Fase 3: Rediseno del Motor Ofensivo en `StrategicAI.js`
- Objetivo: que el ataque no sea solo “puedo ganar”, sino “debo atacar este objetivo, con esta tribu, con esta certeza, y sin desprotegerme”.
- El scoring ofensivo debe separar tipos de objetivo: `nemesis`, `punish_exposed_army`, `economic_village`, `military_village`, `expansion_village`, `high_value_siege_target`.
- El motor debe usar el mismo estimador de combate que el defensivo. Hoy eso no esta alineado y es una fuente real de incoherencia.
- Germano debe priorizar:
- castigar aldeas con ejercito fuera,
- aldeas con muro bajo y poco defensor,
- ventanas cortas de presion,
- multi-wave si la intel lo permite,
- ataques con perdidas aceptables mas altas que Egipto.
- Egipcio debe priorizar:
- ataques solo con alta certeza,
- represalias seguras tras defender,
- objetivos aislados y subdefendidos,
- evitar commits prolongados si comprometen defensa imperial.
- Ambos deben reservar defensa minima por aldea antes de atacar.
- Germano puede reservar menos defensa minima que Egipto.
- Egipcio debe exigir mayor margen de victoria antes de lanzar ataque.
- Debe existir un filtro previo por aldea origen: si la aldea esta bajo amenaza, en `counterWindow`, con `reservedTroops`, con `movementLock` o con dodge pendiente, no puede ser usada ofensivamente.
- Validacion real: partida Germano vs Egipcio en early y mid; Germano debe atacar antes y con mas frecuencia, Egipcio menos, pero con mejor certeza y menos suicidio.
- Criterio de salida: se debe ver asimetria real entre tribus y caida visible de ataques “ciegos” o inutiles.

## Fase 4: Rediseno del Motor Defensivo y de Reaccion en `reactive.js`
- Objetivo: que la defensa no solo “aguante”, sino que preserve el activo correcto segun tribu y contexto.
- La evaluacion debe seguir este orden: clasificar amenaza, estimar defensa local, estimar defensa imperial, decidir hold/reinforce/dodge/counter, reservar tropas.
- Germano debe defender asi:
- si puede sostener con costo razonable, sostiene,
- si va a perder un ataque fuerte, prioriza salvar ofensiva, asedio y conquista,
- usa `partial_dodge` o `full_dodge` antes que regalar su nucleo ofensivo,
- contraataca si el atacante quedo expuesto y no compromete su siguiente ventana ofensiva.
- Egipcio debe defender asi:
- primero hold local,
- luego refuerzo imperial,
- luego `partial_dodge` de scouts, ofensivos, settlers/chiefs si la defensa no alcanza,
- `full_dodge` solo si la derrota es clara y el valor estrategico del pueblo no justifica perder ejercito.
- El dodge no debe ser “una sola politica”. Debe ser doctrinal por tribu y por composicion real del pueblo.
- El sistema de counter debe ser mas estricto para Egipto y mas oportunista para Germanos.
- Todo counter debe comprobar seguridad residual despues de enviar tropas.
- Validacion real: lanzar raid, standard attack, siege y conquest contra ambas tribus; deben reaccionar distinto y de forma comprensible.
- Criterio de salida: Germanos preservan mejor ofensiva; Egipcios sostienen mejor con refuerzos y esquivan menos en amenazas medias.

## Fase 5: Coordinacion y Arbitraje Entre Ambos Motores
- Objetivo: que `StrategicAI` y `reactive` no compitan por las mismas tropas ni por la misma aldea.
- `reactive.js` debe poder marcar `reservedTroops` por aldea.
- `StrategicAI.js` debe consumir solo tropas libres, nunca tropas reservadas.
- Si `reactive` abre una ventana de defensa o dodge, `StrategicAI` debe considerarlo veto temporal.
- Si `StrategicAI` compromete un ataque de alto valor, `reactive` no debe intentar un contraataque oportunista desde esa misma aldea salvo amenaza critica.
- El estimador de combate debe ser unico para ambos.
- La politica de prioridad debe ser unica para ambos.
- La logica de “counter window” debe decidir una sola cosa: o contraataque reactivo inmediato, o contraataque diferido, o nada. Nunca dos capas disparando la misma intencion.
- Aqui el ajuste fino del arbitraje en `AIController.js` es obligatorio, aunque el comportamiento principal viva en los otros dos archivos.
- Validacion real: provocar en la misma aldea un ataque entrante y una oportunidad ofensiva saliente casi simultanea; la IA debe escoger una sola prioridad coherente.
- Criterio de salida: cero doble-ordenes contradictorias desde una misma aldea en la misma ventana tactica.

## Fase 6: Balance por Tribu y Pruebas Reales en Juego
- Objetivo: estabilizar comportamiento con partidas reales, no con harnesses.
- La bateria de pruebas debe hacerse en juego en estas situaciones:
- Germano vs Egipcio early 1v1.
- Germano atacando con intel fresca contra defensor pasivo.
- Egipcio bajo multi-wave con refuerzo imperial.
- Ataque siege/conquest contra ambas tribus.
- Ataque con intel vieja para confirmar bloqueo ofensivo.
- Scout fallido y reintento de scout.
- Contraataque tras defensa exitosa.
- Pueblo con nucleo ofensivo valioso bajo amenaza inminente.
- Los ajustes deben hacerse por rangos doctrinales, no por parches puntuales.
- Lo que se debe afinar primero es: TTL de intel, margen minimo de commit, reserva minima local, severidad para full dodge, agresividad de counter.
- Validacion real: revisar repeticiones y logs de 10-20 partidas cortas por matchup relevante.
- Criterio de salida: la IA deja de parecer aleatoria y empieza a mostrar “personalidad militar” consistente por tribu.

## Checklist Final
- [ ] Ninguna aldea enemiga de jugador/IA es atacada sin reporte de scout fresco.
- [ ] La frescura de intel se invalida por tiempo y por eventos militares relevantes.
- [ ] `StrategicAI` no usa tropas de aldeas con amenaza alta, `movementLock`, dodge pendiente o tropas reservadas.
- [ ] `reactive` decide defensa usando hold/reinforce/dodge/counter con una politica distinta para Germano y Egipcio.
- [ ] Germano preserva su nucleo ofensivo cuando un ataque entrante lo va a destruir.
- [ ] Egipcio prioriza sostener y reforzar antes de hacer dodge completo.
- [ ] Los dos motores usan el mismo estimador de combate y no calculos distintos.
- [ ] Los contraataques no salen si dejan la defensa residual por debajo del umbral doctrinal.
- [ ] La IA no emite dos movimientos contradictorios desde la misma aldea en la misma ventana tactica.
- [ ] El farmeo y la ofensiva secundaria se bloquean automaticamente cuando la defensa reactiva lo exige.
- [ ] Los scouts ya no son decorativos: son la puerta de entrada de la ofensiva PVP.
- [ ] El comportamiento militar Germano se ve mas agresivo y castigador.
- [ ] El comportamiento militar Egipcio se ve mas prudente, imperial y defensivo.
- [ ] En pruebas reales, bajan los ataques suicidas y bajan las perdidas evitables por no esquivar.
- [ ] En pruebas reales, suben las defensas exitosas, los counters seguros y la coherencia entre ataque y defensa.
