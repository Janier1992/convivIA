# PRP: ConvivIA — MVP de administración de propiedad horizontal

## Goal

Transformar el repositorio de ReservasIA (SaaS de reservas con agente de IA) en **ConvivIA**: una plataforma
SaaS multi-tenant para administrar conjuntos residenciales, edificios y condominios sometidos al régimen de
propiedad horizontal en Colombia, conservando la arquitectura probada del proyecto anterior:

- InsForge (Postgres + Auth + Storage + Edge Functions) como backend y única fuente de verdad.
- Compute service Node/Express persistente con el agente de IA (tool-calling) y los canales Telegram
  (long-polling) y WhatsApp (Twilio).
- Frontend React + Vite (PWA) como panel de la administración.

Estado final del MVP (sección 18 del system prompt maestro):
copropiedad → unidades + residentes → cuotas + cartera → pagos → PQRS → reservas de zonas comunes →
comunicaciones → portal residente (conversacional) → panel administrador → asistente IA contextual.

## Why

- Las administraciones de PH operan con Excel, WhatsApp informal y llamadas repetitivas. Cada módulo debe
  eliminar trabajo manual concreto (ver tabla "Trabajo manual que elimina").
- El residente ya vive en WhatsApp/Telegram: el canal conversacional es el portal de autoservicio.
- La arquitectura existente ya resolvió problemas difíciles en producción (concurrencia de turnos, poller de
  Telegram trabado, ventana de 24h de WhatsApp, respuestas fuera de orden). Reutilizarla reduce riesgo.

| Módulo | Trabajo manual que elimina |
|---|---|
| Unidades/residentes + importación | Censo en Excel desactualizado, doble registro |
| Cuotas + cartera | Liquidación mensual a mano, cálculo de mora en hojas de cálculo |
| Pagos reportados por chat | "¿Ya pagué?" por WhatsApp, fotos de soportes perdidas en chats personales |
| PQRS con radicado | Quejas sin trazabilidad ni tiempos de respuesta |
| Reservas de zonas comunes | Cuaderno de portería, conflictos de horario |
| Comunicados segmentados | Mensajes masivos manuales, circulares impresas |
| Asistente IA | Llamadas repetitivas por saldo, horarios, reglamento |

## Decisiones de arquitectura (ADR resumido)

1. **Tenant = copropiedad (`organizations`)**. Una empresa administradora se modela como un equipo con
   membresía en varias copropiedades (el selector de copropiedad ya existe). Motivo: mantener el aislamiento
   RLS probado y un bot/número por copropiedad (el residente de A nunca habla con el bot de B). Una tabla
   `management_companies` con vista consolidada queda para fase 2; el modelo actual no la bloquea.
2. **Backend InsForge NUEVO**. Este repo nació como clon de ReservasIA y `.insforge/project.json` apunta a
   `crm-clients-wpp` (backend de ReservasIA en producción). Las migraciones de ConvivIA **nunca** deben
   aplicarse ahí: `scripts/check-insforge-project.mjs` bloquea `npm run insforge:migrate` contra ese
   proyecto. Migraciones escritas desde cero (proyecto limpio), consolidando los fixes históricos.
3. **Lógica de negocio determinista en SQL (RPCs)**: estado de cuenta (FIFO), cartera por edades,
   generación de cuotas, intereses, disponibilidad y reserva de zonas, radicados de PQRS, comunicados.
   Frontend y agente llaman las mismas funciones: una sola fuente de verdad (lección aprendida del
   `check-availability` duplicado en ReservasIA).
4. **El LLM nunca ejecuta acciones directamente**: las herramientas que cambian estado son
   `proponer_*` (validan de forma determinista y guardan una acción pendiente con resumen generado por el
   servidor) y `confirmar_accion`, que solo ejecuta si hubo un mensaje del residente POSTERIOR a la
   propuesta y ejecuta exactamente el payload propuesto (el modelo no puede cambiar datos al confirmar).
5. **Identidad verificada por canal, sin LLM**: WhatsApp → el número `From` (autenticado por WhatsApp)
   se cruza con el censo. Telegram → botón "Compartir mi número" (`request_contact`; se exige
   `contact.user_id == from.id`). Las herramientas privadas solo se exponen a identidades verificadas y
   cada ejecución vuelve a autorizar unidad/relación.
6. **Router implícito por tool-calling + exposición mínima de herramientas**: en vez de una llamada extra
   de clasificación (duplicaría la latencia en WhatsApp), el conjunto de herramientas se filtra por
   identidad y capacidades habilitadas, el prompt es modular por dominio, y cada resultado de herramienta
   declara `tipo_dato`, `fuente` y `fecha_datos` (sección 11 de veracidad).
7. **Outbox para todo mensaje saliente** (`outbound_messages`): respuestas del staff, comunicados,
   recordatorios de cobro, avisos de PQRS y reservas. Un worker del compute service entrega por canal,
   decide texto libre vs plantilla (ventana 24h de WhatsApp), reintenta máximo 3 veces e idempotencia por
   `dedupe_key`. El canal no contiene lógica de negocio (sección 13).
8. **Cola de trabajos** (`background_jobs`) para la vista previa del asistente desde el panel (usa el
   runtime REAL del agente, sin copia en Deno) y para la ingesta de documentos.
9. **RAG con búsqueda de texto completo de Postgres (`spanish`)** sobre fragmentos de documentos,
   con ranking `ts_rank_cd` y cita de fuente. Funciona con cualquier proveedor LLM; pgvector híbrido queda
   para fase 2.
10. **RBAC granular**: roles `owner`, `admin`, `assistant` (auxiliar), `accountant` (contador/tesorero),
    `council` (consejo), `auditor` (revisor fiscal) mapeados a permisos en `role_permissions`;
    `has_org_permission()` en RLS y `get_my_permissions()` para la UI. Nunca "admin = todo" como único
    modelo.
11. **Portal residente = canal conversacional** (WhatsApp/Telegram) en el MVP. El portal web de residentes
    (login propio + RLS por unidad) queda para fase 2; el canal `web` y la cola de trabajos ya lo habilitan.
12. **Auditoría en base de datos** (`audit_events`) por triggers: quién, qué, cuándo, desde dónde (si el
    gateway expone la IP), antes/después. Nunca depende de texto generado por IA. Las credenciales se
    excluyen del registro.

## What

### Módulos del MVP
- Núcleo: copropiedad, torres, unidades (tipo, área, coeficiente %), personas, relación persona-unidad
  (propietario, arrendatario, residente, autorizado), importación XLSX con simulación, errores, cambios
  detectados, confirmación atómica y reversión de lo creado.
- Cartera: conceptos (fijo / por coeficiente / manual), generación mensual idempotente con vista previa,
  cargos manuales, anulación con motivo (el libro nunca se borra), intereses de mora con tasa configurable
  y vista previa, estado de cuenta con aplicación FIFO, cartera por edades, saldos iniciales.
- Pagos: registro manual, reportes del residente por chat con foto del soporte (pendiente de revisión),
  confirmación/rechazo humano, reversión.
- PQRS: radicado por año, categorías con SLA, estados del flujo, asignación, historial append-only,
  respuesta que se entrega por el canal del residente.
- Zonas comunes: horarios por día, modo exclusivo o por aforo, tarifa (genera cargo en la cuenta),
  depósito, aprobación opcional, anticipación mínima/máxima, cupo por unidad, bloqueo opcional por mora.
- Comunicaciones: comunicados segmentados (todos, torres, unidades, propietarios, residentes, unidades en
  mora — siempre mensajes privados), borrador asistido por IA, entrega por outbox con conteos.
- Asistente IA residente (WhatsApp/Telegram) y vista previa desde el panel con identidad simulada.
- IA para administradores: borrador de comunicados y resumen del día (con fuente, fecha y limitaciones).
- Panel: inicio con KPIs, conversaciones (traspaso a humano), auditoría, equipo, integraciones,
  configuración, suscripción de la plataforma y panel de soporte.

### Success Criteria
- [ ] Migraciones aplican limpio sobre un Postgres con shims de InsForge (PGlite) y la suite SQL valida
      aislamiento entre copropiedades, permisos por rol, FIFO/edades, idempotencia de cuotas, choque de
      reservas y el flujo de PQRS.
- [ ] `npm test`, `npm run lint` y `npm run build` pasan en `server` y `app`.
- [ ] El agente nunca expone herramientas privadas a identidades no verificadas; toda acción que cambia
      estado pasa por `proponer_*` + `confirmar_accion` con mensaje posterior del residente.
- [ ] Ningún monto que ve el residente sale del LLM: saldos, tarifas y recordatorios vienen de RPCs.
- [ ] Ningún archivo nuevo supera 500 líneas.
- [ ] README, `.env.example` y guía de despliegue actualizados; guarda contra el backend de ReservasIA.

## Modelo de datos (resumen)

```text
organizations (copropiedad, tenant) ─┬─ organization_members(role) ── role_permissions
                                     ├─ property_profiles (1:1)
                                     ├─ towers ── units ── unit_persons ── persons
                                     ├─ charge_concepts ── charges (libro, anulables) ── charge_batches
                                     ├─ payments (pending_review → confirmed/rejected → reversed)
                                     ├─ pqrs_categories ── pqrs_tickets ── pqrs_events (append-only)
                                     ├─ common_areas ── common_area_hours / area_reservations (EXCLUDE)
                                     ├─ announcements ── outbound_messages (outbox)
                                     ├─ conversations ── messages / pending_actions / ai_traces
                                     ├─ agents, agent_rules, integrations(credentials revocadas)
                                     ├─ documents ── document_chunks (tsvector spanish)
                                     ├─ background_jobs, import_batches, audit_events
                                     └─ push_subscriptions, subscription_payments, support_*
```

## Implementation Blueprint — tareas en orden

```yaml
Fase 1 - Base de datos:
  - migrations/ desde cero (13 archivos agrupados por dominio), sin BEGIN/COMMIT.
  - db-tests/: harness PGlite con shims de InsForge (auth.users, auth.uid(), system.update_updated_at,
    storage.objects, roles anon/authenticated) + suites vitest por dominio.
  VALIDATE: npm test -w db-tests

Fase 2 - Compute service:
  - agente: runtime (locks por conversación, trazas), promptBuilder modular, registro de herramientas por
    dominio, acciones pendientes, identidad.
  - canales: procesador de Telegram (start, contacto, fotos, opt-out), webhook WhatsApp (texto + media),
    outbox worker, plantillas de WhatsApp.
  - jobs: vista previa del agente, ingesta de documentos (unpdf + chunker).
  - recordatorios de cobro, notificaciones push, suscripción.
  VALIDATE: npm run lint -w server && npm test -w server && npm run build -w server

Fase 3 - Edge Functions:
  - telegram/twilio connect-disconnect (plantillas por tipo), get-file-url (soportes/documentos),
    suscripción (3), ai-assist (borrador de comunicado, resumen del día).

Fase 4 - Frontend:
  - identidad visual ConvivIA, layout con navegación por permisos, onboarding, páginas por módulo.
  VALIDATE: npm run lint -w app && npm test -w app && npm run build -w app

Fase 5 - Documentación y evaluación:
  - README, .env.example, CLAUDE.md del proyecto (motor agéntico instalado), dataset de evaluación del
    agente + runner opcional contra el modelo real.
```

## Validation Loop
```bash
npm test -w db-tests      # migraciones + RLS + lógica SQL sobre PGlite
npm run lint              # server + app
npm test                  # server + app (+ db-tests)
npm run build             # server + app
```

## Fuera del MVP (fase 2)
Portería (visitantes, paquetes, vehículos, bitácora), mantenimiento y activos, proveedores y contratos,
asambleas (quórum, poderes, votaciones), acuerdos de pago, conciliación bancaria automática, pasarela de
pagos (PSE/Wompi), facturación electrónica, portal web de residentes, empresa administradora con vista
consolidada, embeddings/pgvector, confirmaciones de lectura de WhatsApp, mascotas y vehículos en el censo.

## Anti-Patterns to Avoid
- ❌ Cálculos financieros en el frontend o en el LLM.
- ❌ Confiar en IDs que repite el modelo sin volver a autorizar contra la identidad verificada.
- ❌ Listas de morosos en canales generales.
- ❌ Reintentos infinitos de mensajes salientes.
- ❌ Afirmar "cumplimiento legal" por tener una funcionalidad; tasas y reglas de asamblea son configurables.
- ❌ Aplicar migraciones de ConvivIA contra el backend de ReservasIA.

## Confidence Score: 7/10
✅ Patrones probados en producción (RLS multi-tenant, canales, concurrencia del agente); SQL validable
localmente con PGlite. ⚠️ Superficie grande; las plantillas de WhatsApp dependen de aprobación de Meta; la
calidad del RAG por texto completo depende de que los PDFs tengan capa de texto (sin OCR).
