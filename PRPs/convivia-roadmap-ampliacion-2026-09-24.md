# Roadmap de ampliación frente al system prompt maestro

Este documento retoma `System_Prompt_Plataforma_Administracion_PH_Colombia.md` (el prompt original del
proyecto) y prioriza lo que falta para que ConvivIA cubra el alcance completo que describe: un "sistema
operativo digital de la copropiedad", no solo cartera + PQRS + reservas + asistente.

De ese prompt ya está construido: núcleo de copropiedad, cartera y recaudo, PQRS, reservas de zonas comunes,
comunicaciones, documentos con RAG, el asistente contextual con sus guardrails (patrón proponer → confirmar,
identidad verificada, RLS multi-tenant, auditoría en base de datos), portería y visitantes (ver
`convivia-porteria-2026-09-24.md`), IA para administradores sobre Gemini y ahora asamblea y gobierno (ver P1).

Lo que sigue es una priorización honesta de lo que falta, ordenada por impacto para "captar clientes" del
nicho de conjuntos residenciales en Colombia, no por facilidad de construcción.

## P0. Ya construido en esta ronda

- **Portería y visitantes** (sección 4.6 del prompt). Ver PRP dedicado.
- **Menú lateral en acordeón** (mejora de interfaz, no funcional): cada módulo principal se despliega y pliega
  el resto, en escritorio y celular.
- **P1.5 IA para administradores** (cartera de la semana + PQRS a priorizar, ver detalle abajo). Sobre Gemini
  (Google AI Studio) como proveedor inicial, intercambiable por variables de entorno sin tocar código.
- **P1 Asamblea y gobierno** (sección 4.9 del prompt, ver detalle abajo).

## Retomado: dos hallazgos adicionales tras revisar de nuevo la sección 10 (IA para administradores)

Al revisar `functions/ai-assist.ts` para confirmar qué tanto de la sección 10 del prompt ("IA para
administradores") ya existe, encontré que solo **2 de las 7 capacidades que describe el prompt están
construidas**: `daily_brief` ("Resume qué requiere atención hoy") y `draft_announcement` ("Redacta un
comunicado..."). El resto (cartera de la semana, PQRS por vencer, resumen de actas, mantenimientos
pendientes, contratos por vencer) no existe todavía. Dos de esas faltantes se pueden construir **ya**, sin
esperar ningún módulo nuevo, porque los datos que necesitan ya existen en cartera y PQRS:

- **"¿Qué cambió en la cartera esta semana?"**: comparar el estado de cartera actual contra el de hace 7 días
  (recaudo, nuevas unidades en mora, unidades que salieron de mora). Es prácticamente una consulta SQL nueva
  más una redacción corta por IA sobre esos números, mismo patrón que `daily_brief`.
- **"Clasifica las PQRS abiertas y detecta las que están cerca del vencimiento"**: hoy la página de PQRS ya
  muestra el vencimiento por fila, pero no hay una vista agrupada que priorice "esto se vence en menos de 24h"
  para el administrador. Es determinista (una consulta SQL ordenada por `due_at`), la IA es opcional para
  redactar el resumen.

Esto es más rápido de construir que asamblea o mantenimiento (no requiere tablas nuevas) y encaja
directamente con lo que el prompt describe como el valor de la IA "para administradores", que hoy está casi
vacío frente a lo que describe. Lo subo de prioridad: **P1.5**, entre asamblea y mantenimiento.

**Construido**: las dos capacidades ya están hechas. `get_portfolio_weekly_changes()` (nueva función
determinista) calcula recaudo, facturación, unidades que entraron en mora y unidades que se pusieron al día en
los últimos 7 días; `ai-assist` gana las acciones `portfolio_weekly_brief` y `pqrs_priority_brief` (esta última
agrupa las PQRS abiertas por vencidas / vencen hoy / vencen en 48h antes de pedirle a la IA que redacte, así
que la priorización en sí es determinista, no depende del modelo). Ambas quedaron como tarjetas en Inicio,
junto a "Resumen del día". Proveedor: Gemini (`GEMINI_API_KEY`, gratis en Google AI Studio), intercambiable por
OpenAI u otro compatible con solo cambiar variables de entorno, sin tocar código — ver README.

También noté, revisando el núcleo de copropiedad (sección 4.1), que **vehículos y mascotas** no son
entidades propias: la placa del vehículo hoy vive como texto libre dentro de portería (autorizaciones y
bitácora), sin un registro por unidad con historial (marca, color, más de un vehículo por unidad) ni mascotas
en absoluto. Es una ampliación pequeña y de bajo riesgo sobre lo que ya existe, no un módulo nuevo: dos
tablas (`unit_vehicles`, `unit_pets`) colgando de `units`, sin RPCs complejas. La subo como candidata de bajo
esfuerzo para intercalar entre módulos más grandes, no como prioridad por sí sola.

## P1. Asamblea y gobierno (sección 4.9)

**Por qué primero:** es el dolor legal más recurrente de un administrador en Colombia (Ley 675 de 2001):
convocatoria, quórum, poderes, votación por coeficiente, acta. Hoy no hay ninguna tabla para esto; es la
brecha más citada frente a competidores que sí lo resuelven.

**Construido**: `assemblies`, `assembly_agenda_items`, `proxies` (poderes), `assembly_attendees` y `votes`, con
7 RPCs de escritura (`create_assembly`, `add_agenda_item`, `start_assembly`, `close_assembly`,
`cancel_assembly`, `register_proxy`, `revoke_proxy`, `check_in_unit`, `remove_attendee`, `cast_vote`,
`set_assembly_minutes`) y 4 de consulta (`get_assembly_quorum`, `get_vote_results`, `get_assembly_attendees`,
`get_assembly_proxies`). Reglas clave, tal como las pedía el prompt:
- El quórum se calcula **siempre** en la base de datos sobre coeficientes reales de `units`
  (`get_assembly_quorum`), nunca a mano; el coeficiente de cada unidad presente queda congelado al momento del
  registro de asistencia, así una corrección posterior no reescribe un quórum ya vivido.
- Un poder (`proxies`) tiene un dueño, un apoderado y un límite de unidades que puede representar
  **configurable por copropiedad** (`property_profiles.max_proxies_per_attorney`, nulo = sin límite), nunca
  hardcodeado como una interpretación jurídica universal.
- Los resultados de votación (`get_vote_results`) son números crudos por coeficiente (a favor / en contra /
  abstención); el sistema **nunca certifica** si una decisión "quedó aprobada", porque el tipo de mayoría
  (simple, absoluta, calificada) depende del reglamento y del tema, no es algo que deba fijar el software.
- El acta final es un documento versionado (reutiliza `documents`, `doc_type = 'assembly_minutes'`, ya existía
  en el esquema), vinculado con `set_assembly_minutes`, no texto libre perdido en un correo.
- El asistente de IA solo informa fecha, lugar y orden del día de la próxima asamblea
  (`consultar_proxima_asamblea`, capacidad `assembly_enabled`); nunca calcula ni menciona quórum ni resultados
  de votación, tal como pide explícitamente el prompt maestro.
- Nueva pantalla `/dashboard/assembly` (lista + detalle con pestañas: orden del día, poderes, asistencia,
  votación, acta) y permiso `assembly.*` propio (owner/admin/assistant/council con escritura, auditor solo
  lectura).

## P2. Mantenimiento de activos (sección 4.8)

**Por qué:** segundo dolor más frecuente después de asamblea; hoy cualquier daño (ascensor, bomba de agua,
portón) se coordina por WhatsApp sin trazabilidad ni historial de garantías.

Entidades propuestas: `assets`, `work_orders`, `maintenance_schedules`, `vendors` (se puede compartir con P3).
Flujo: reporte → diagnóstico → aprobación → asignación → ejecución → evidencia → validación → cierre (tal
como lo describe el prompt). El reporte inicial puede salir de una PQRS ya existente (categoría
"Mantenimiento"): no duplicar la entrada, solo agregar el seguimiento estructurado que hoy no tiene.

**Construido**: `assets`, `vendors`, `maintenance_schedules`, `work_orders` y `work_orders_events` (historial
append-only, mismo patrón que `pqrs_events`), con las 15 RPCs del flujo completo. Dos permisos, no uno:
`maintenance.write` para la operación (reportar/diagnosticar/asignar/ejecutar/evidencia) y
`maintenance.approve` como checkpoint de gobierno separado (aprobar el gasto diagnosticado y validar el
cierre) — solo owner, admin y consejo lo tienen, igual que en asamblea. `create_work_order` acepta un
`pqrs_ticket_id` opcional (índice único parcial evita enlazar dos órdenes al mismo PQRS) sin acoplar el
estado de los dos módulos. Nueva pantalla `/dashboard/maintenance` con pestañas (Órdenes, Activos,
Proveedores, Preventivo) y botón "Crear orden de trabajo" desde el detalle de una PQRS.

## P3. Empresa administradora: panel consolidado multi-copropiedad

**Por qué:** hoy una persona que administra varias copropiedades ya puede pertenecer a varias organizaciones
(selector existente), pero no hay ninguna vista que consolide cartera, PQRS o mantenimientos across todas sus
copropiedades a la vez. Para vender a empresas administradoras (canal de ventas grande en este nicho, no solo
a conjuntos individuales) esto pesa tanto como cualquier módulo nuevo.

**Construido**: sin entidad `management_companies` ni tablas nuevas, tal como proponía este documento. La RPC
`get_portfolio_overview()` (sin parámetros: se autoescopea a `auth.uid()`) agrega cartera vencida — reutilizando
`ledger_open_items()`, nunca reinventando la mora —, PQRS abiertas/vencidas y mantenimiento abierto de cada
copropiedad donde el usuario es miembro, con el rol de esa copropiedad puntual. Cada cifra se oculta (`null`)
si el rol no tiene el permiso de lectura correspondiente ahí — el rol puede variar de una copropiedad a otra.
Nueva pantalla `/dashboard/portfolio` (con tarjetas resumen + tabla); tocar una fila cambia de copropiedad
activa y entra a su panel completo.

## P4. Contabilidad y presupuesto (sección 4.3)

**Por qué después:** el prompt mismo advierte separar `operación administrativa ≠ cálculo contable ≠ emisión
tributaria` y pide no simular cumplimiento tributario. Construirlo mal (o a medias) genera más riesgo legal
que valor. Recomendación: no construir un motor contable propio; construir la **capa de integración** con un
software contable establecido (Siigo, Alegra, World Office son comunes en PH colombiana), exportando desde
`charges`/`payments` en el formato que cada uno requiere, y dejar el cálculo tributario a esas herramientas.

## P5. MFA para roles sensibles

Hoy el registro pide un código de verificación de correo (OTP de un solo uso al crear la cuenta), que no es
autenticación de dos factores. Agregar TOTP (app autenticadora) obligatorio para `owner` y `accountant` es un
cambio acotado (una tabla de secretos TOTP + un paso más en el login) y cierra una brecha de seguridad real
sin necesitar ningún módulo nuevo de negocio.

## P6. Observabilidad y evaluación del asistente (secciones 15 y 16)

Hoy no existe ninguna métrica de calidad del asistente (tasa de alucinación, groundedness, tasa de
escalamiento) ni una suite de casos de prueba (jailbreak, extracción de prompt, fuga entre tenants) que se
corra antes de cada release, como pide el prompt explícitamente. Es la brecha de menor impacto comercial
inmediato pero la de mayor riesgo si el asistente cambia de proveedor de modelo o de prompt sin red de
seguridad. Se puede construir de forma incremental sobre `ai_traces`, que ya registra cada turno.

## Lo que se decidió NO perseguir por ahora

- **Apps nativas iOS/Android.** La PWA ya cubre instalación en celular sin fricción; el costo de dos code
  bases nativas no se justifica hasta que el volumen de copropiedades lo pida explícitamente.
- **Facturación electrónica propia.** Se resuelve como integración (P4), nunca como motor propio: es
  regulación fiscal, no un problema de producto.
