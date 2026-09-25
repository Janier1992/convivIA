# Roadmap de ampliación frente al system prompt maestro

Este documento retoma `System_Prompt_Plataforma_Administracion_PH_Colombia.md` (el prompt original del
proyecto) y prioriza lo que falta para que ConvivIA cubra el alcance completo que describe: un "sistema
operativo digital de la copropiedad", no solo cartera + PQRS + reservas + asistente.

De ese prompt ya está construido: núcleo de copropiedad, cartera y recaudo, PQRS, reservas de zonas comunes,
comunicaciones, documentos con RAG, el asistente contextual con sus guardrails (patrón proponer → confirmar,
identidad verificada, RLS multi-tenant, auditoría en base de datos), y ahora portería y visitantes (ver
`convivia-porteria-2026-09-24.md`).

Lo que sigue es una priorización honesta de lo que falta, ordenada por impacto para "captar clientes" del
nicho de conjuntos residenciales en Colombia, no por facilidad de construcción.

## P0. Ya construido en esta ronda

- **Portería y visitantes** (sección 4.6 del prompt). Ver PRP dedicado.

## P1. Asamblea y gobierno (sección 4.9)

**Por qué primero:** es el dolor legal más recurrente de un administrador en Colombia (Ley 675 de 2001):
convocatoria, quórum, poderes, votación por coeficiente, acta. Hoy no hay ninguna tabla para esto; es la
brecha más citada frente a competidores que sí lo resuelven.

Entidades propuestas: `assemblies`, `assembly_attendees`, `proxies` (poderes), `assembly_agenda_items`,
`votes`, `assembly_minutes`. Reglas clave:
- El quórum y la mayoría necesaria se calculan sobre coeficientes reales de `units`, nunca a mano.
- Un poder (`proxies`) tiene un dueño, un apoderado y un límite de unidades que puede representar según el
  reglamento (configurable, no hardcodeado: el prompt es explícito en no fijar interpretaciones jurídicas
  como universales).
- El acta final es un documento versionado (reutiliza `documents`), no texto libre perdido en un correo.
- El asistente puede resumir actas anteriores y explicar el proceso, pero nunca certifica quórum ni resultado
  de una votación: eso lo calcula la base de datos.

## P2. Mantenimiento de activos (sección 4.8)

**Por qué:** segundo dolor más frecuente después de asamblea; hoy cualquier daño (ascensor, bomba de agua,
portón) se coordina por WhatsApp sin trazabilidad ni historial de garantías.

Entidades propuestas: `assets`, `work_orders`, `maintenance_schedules`, `vendors` (se puede compartir con P3).
Flujo: reporte → diagnóstico → aprobación → asignación → ejecución → evidencia → validación → cierre (tal
como lo describe el prompt). El reporte inicial puede salir de una PQRS ya existente (categoría
"Mantenimiento"): no duplicar la entrada, solo agregar el seguimiento estructurado que hoy no tiene.

## P3. Empresa administradora: panel consolidado multi-copropiedad

**Por qué:** hoy una persona que administra varias copropiedades ya puede pertenecer a varias organizaciones
(selector existente), pero no hay ninguna vista que consolide cartera, PQRS o mantenimientos across todas sus
copropiedades a la vez. Para vender a empresas administradoras (canal de ventas grande en este nicho, no solo
a conjuntos individuales) esto pesa tanto como cualquier módulo nuevo.

Propuesta de menor esfuerzo que crear una entidad `management_companies` completa: una vista
`/dashboard/portfolio` que, para alguien con membresía en más de una organización, agregue los indicadores
clave (cartera vencida, PQRS abiertos, mantenimientos pendientes) de todas sus copropiedades en una sola
pantalla, con RLS ya resuelto porque reutiliza `get_user_organization_ids()`.

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
