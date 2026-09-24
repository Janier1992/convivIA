# ConvivIA — SaaS de administración de conjuntos residenciales

Plataforma SaaS multi-tenant para **administraciones de propiedad horizontal en Colombia** (conjuntos
residenciales, edificios y condominios). Cada copropiedad tiene su propio **asistente de IA**, que atiende a los
residentes por **Telegram** (canal recomendado, gratuito) o **WhatsApp**, y reemplaza el trabajo manual típico de
una administración: consultar saldo, reportar un pago, radicar un PQRS o reservar una zona común, todo por chat y
sin llamadas repetitivas al portero o al administrador.

Es una PWA (Progressive Web App): se puede instalar como app en el celular (Android/iOS) o en escritorio, y toda la
interfaz es responsiva.

---

## Tabla de contenidos

- [Funcionalidades](#funcionalidades)
- [Arquitectura](#arquitectura)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Configurar InsForge (base de datos + auth)](#configurar-insforge-base-de-datos--auth)
- [Configurar OpenAI (asistente de IA)](#configurar-openai-asistente-de-ia)
- [Configurar Telegram (canal recomendado, gratis)](#configurar-telegram-canal-recomendado-gratis)
- [Configurar WhatsApp / Twilio (opcional, con costo)](#configurar-whatsapp--twilio-opcional-con-costo)
- [Notificaciones push](#notificaciones-push)
- [Suscripción de la copropiedad (billing de la plataforma)](#suscripción-de-la-copropiedad-billing-de-la-plataforma)
- [Desarrollo local](#desarrollo-local)
- [Tests](#tests)
- [Build y producción](#build-y-producción)
- [Checklist de arquitectura](#checklist-de-arquitectura)
- [Simplificaciones conocidas / próximos pasos](#simplificaciones-conocidas--próximos-pasos)

---

## Funcionalidades

### Onboarding
Registro de la copropiedad (nombre, tipo — conjunto residencial / edificio / condominio —, ciudad, zona horaria) y
alta automática del administrador como **titular de la cuenta** (owner), antes de llegar al dashboard.

### Unidades y residentes
- Unidades (apartamentos, casas, locales, parqueaderos, depósitos) con su coeficiente de copropiedad, agrupadas por
  torre/bloque.
- **Generación masiva por pisos** (torres × pisos × unidades por piso) o **importación del censo desde Excel**, con
  vista previa de filas válidas/erróneas antes de confirmar e historial de importaciones.
- Censo de personas (propietarios, arrendatarios, familiares) vinculadas a sus unidades, con o sin canal conectado
  al asistente.

### Finanzas (cuotas, cartera y pagos)
- Conceptos de cobro configurables y liquidación masiva de cuotas por lote (`charge_batches`).
- **Cartera por unidad**, calculada en la base de datos (nunca por la IA) con antigüedad de saldos (por vencer, 1-30,
  31-60, 61-90, +90 días) y aplicación FIFO de pagos.
- Cargos manuales, intereses de mora configurables y anulación de cargos (nunca se borran: quedan auditados).
- **Pagos reportados por los residentes desde el chat** (el asistente les explica cómo pagar y reciben el soporte),
  con cola de revisión para el equipo (confirmar/rechazar/reversar) — nunca se confirman solos por lo que diga el
  residente.

### PQRS
Peticiones, quejas, reclamos y sugerencias con número de radicado, categorías configurables, SLA y trazabilidad
completa del historial — reemplaza las quejas informales sin seguimiento.

### Zonas comunes y reservas
Configuración de zonas comunes (salón social, piscina, gimnasio, etc.) con horarios, aforo y tarifas, y reservas
creadas por el equipo o por los propios residentes vía el asistente — con prevención de choques de horario a nivel
de base de datos.

### Portería y visitantes
Bitácora digital de portería: preautorización de visitantes (desde el panel o desde el chat, con confirmación
del residente), registro real de ingreso/salida en la garita, paquetes recibidos con aviso automático al
contacto principal de la unidad cuando hay canal conectado, y novedades generales de turno. Interfaz de una
sola pantalla, pensada para registrarse en segundos en la garita.

### Comunicados
Se entregan **como mensaje privado por el chat de cada persona, nunca como lista pública o grupo**, con ayuda
opcional de la IA para redactarlos.

### Documentos (base para el asistente)
Reglamento de propiedad horizontal, manual de convivencia, actas y demás documentos con visibilidad configurable
(público / residentes / staff). El asistente los indexa y puede **citar la fuente** al responder preguntas del
reglamento (búsqueda de texto completo en español sobre Postgres).

### Asistente de IA (por copropiedad, 100% configurable)
- Nombre y tono propios (ej. formal, amable-tuteo), instrucciones personalizadas y reglas adicionales de la
  copropiedad — siempre después de las reglas críticas del sistema, que nunca se pueden desactivar ni contradecir.
- Capacidades activables/desactivables una por una: consultar estado de cuenta, reportar pagos, radicar/consultar
  PQRS, reservar zonas comunes, preautorizar visitantes y consultar paquetes, buscar en documentos, transferir a
  una persona del equipo.
- **Nunca ejecuta una acción directamente**: primero la propone (validada de forma determinística contra los datos
  reales) y sólo la ejecuta si el residente la confirma explícitamente en un mensaje posterior — protege contra que
  el modelo "alucine" un pago, una reserva o un PQRS que nunca pidieron.
- Identifica al residente por el canal (número de WhatsApp o `request_contact` verificado de Telegram) cruzado
  contra el censo — nunca confía en lo que el modelo diga sobre quién es el usuario.
- Simulador de conversación en el propio dashboard, sin crear datos reales, para probar tono/instrucciones antes de
  publicarlas.

### Canales de mensajería
- **Telegram** (recomendado): cada copropiedad conecta su propio bot (gratis, vía
  [@BotFather](https://t.me/BotFather)). El compute service lo atiende con *long-polling*, sin necesitar dominio ni
  URL pública.
- **WhatsApp vía Twilio** (opcional, tiene costo de Twilio/Meta): webhook entrante validado por firma, con manejo de
  la ventana de 24h de mensajes gratuitos de Meta (usa plantillas pre-aprobadas fuera de esa ventana).

### Conversaciones (inbox)
Historial de conversaciones por canal, con intervención manual del equipo cuando el asistente transfiere o el
residente lo pide explícitamente.

### Equipo y permisos (RBAC granular)
- Titular de la cuenta (owner, acceso total) más roles invitables: `admin`, `assistant`, `accountant`, `council`
  (consejo de administración) y `auditor` — cada uno con permisos finos por módulo (ej. un `accountant` puede ver
  cartera pero no modificarla), no solo un rol de texto.
- Invitar por email, cambiar roles, revocar acceso. La copropiedad siempre conserva al menos un titular.

### Auditoría
Quién cambió qué, cuándo y con qué valores antes/después — registrado por triggers de base de datos, nunca depende
de texto generado por IA. Excluye credenciales y el texto completo de documentos.

### Suscripción de la plataforma
Cobro manual (comprobante de Nequi subido por la copropiedad) mientras no hay pasarela automática, con cola de
revisión para el equipo interno de soporte (`/support`, rol separado de los administradores de copropiedades).

### Notificaciones push
El equipo recibe una notificación con sonido en el celular cuando un residente reporta un pago, radica un PQRS o
reserva una zona común por chat — sin necesidad de tener la app abierta. Se activan desde **Configuración**, por
dispositivo.

### Multi-tenant y seguridad
Aislamiento estricto por copropiedad (`organization_id`) con Row Level Security de PostgreSQL, no con filtros en el
código de la aplicación — verificado con tests automatizados (ver [Tests](#tests)).

---

## Arquitectura

```text
Organización (copropiedad) → Unidades/Residentes → Cargos/Cartera → Pagos → PQRS → Zonas comunes/Reservas
→ Comunicados → Documentos (RAG) → Conversaciones (Telegram/WhatsApp) → Asistente IA → Auditoría
```

Backend: **[InsForge](https://insforge.dev)** (PostgreSQL + Auth + Storage + Data API, gestionado con
`@insforge/cli` y `@insforge/sdk`).

- **Multi-tenant desde el modelo de datos**: todo dato relevante cuelga de `organization_id`, y el aislamiento se
  garantiza con **Row Level Security** de PostgreSQL, no con filtros del backend.
- **RBAC granular**: los permisos viven en una tabla (`role_permissions`), no hardcodeados por nombre de rol —
  se consultan con `has_org_permission()` / `get_my_permissions()`.
- **Patrón "proponer → confirmar"**: el asistente nunca ejecuta un cambio de estado directamente; primero llama a
  una herramienta `proponer_*` (valida contra datos reales y guarda un resumen generado por el servidor, nunca por
  el modelo) y sólo ejecuta con `confirmar_accion`, que exige un mensaje del residente posterior a la propuesta.
- **Identidad verificada sin depender del LLM**: número de WhatsApp autenticado por el canal, o `request_contact`
  de Telegram verificado contra `contact.user_id === from.id`, cruzado contra el censo (`persons`).
- **Exposición mínima de herramientas**: la lista de herramientas que ve el modelo se filtra ANTES de llamarlo, por
  identidad verificada + capacidades habilitadas por la copropiedad; `executeTool()` revalida contra esa misma
  lista filtrada.
- **Outbox pattern**: toda salida (respuestas del staff, comunicados, recordatorios de pago, novedades de PQRS)
  pasa por `outbound_messages`, reclamada con `claim_outbound_messages()` (`SKIP LOCKED`) y entregada por un
  worker que respeta la ventana de 24h de WhatsApp.
- **Cola de trabajos en background** (`background_jobs`, `claim_background_jobs()` con `SKIP LOCKED` y
  recuperación de trabajos atascados) para ingesta de documentos y turnos del asistente que no deben bloquear la
  respuesta al canal.
- **RAG con búsqueda de texto completo de Postgres** (no requiere un vector store aparte): `document_chunks.tsv`
  en español, rankeado con `ts_rank_cd`, respetando visibilidad del documento y el flag `ai_enabled`.

### Por qué hay tres lugares donde vive "backend"

El SDK de browser de InsForge (`@insforge/sdk`, cliente `createClient`) mantiene el access token del usuario
**encapsulado en memoria, sin getter público**. Esto significa que el frontend **no puede** adjuntar
`Authorization: Bearer <token>` a un servidor propio externo — sólo puede adjuntarlo automáticamente cuando llama a
`insforge.functions.invoke()` (Edge Functions de InsForge). Esa restricción de la plataforma determinó la
arquitectura:

| Dónde | Qué vive ahí | Por qué |
|---|---|---|
| **Postgres (migraciones)** | Tablas, RLS, triggers, RPCs (`propose_*`, `confirm_action`, `get_admin_dashboard`, `ledger_open_items`, `get_portfolio`, `search_document_chunks`, etc.) | El frontend llama estas RPCs directamente vía `insforge.database.rpc()` — el SDK adjunta el token automáticamente porque es una llamada al propio backend de InsForge. |
| **`functions/` (Edge Functions, Deno, desplegadas con `@insforge/cli functions deploy`)** | `ai-assist`, `telegram-connect`, `telegram-disconnect`, `twilio-connect`, `twilio-disconnect`, `get-file-url`, `submit-subscription-payment`, `confirm-subscription-payment` | Lógica privilegiada que el **frontend** dispara (necesita el token del usuario + una API key admin para tocar `integrations.credentials`, bloqueada por columna para `authenticated`). |
| **`server/` (compute service, Node/Express persistente)** | Webhook de Twilio, long-polling de cada bot de Telegram conectado, el loop de tool-calling del asistente, workers de outbox/jobs/recordatorios | Twilio llama directo (no el frontend vía SDK); Telegram no llama a nadie (long-polling saliente), pero igual necesita un proceso persistente corriendo. El asistente y los workers necesitan seguir procesando en background — algo que una función serverless de vida corta no garantiza. |

**Importante para el despliegue**: por esto mismo, `app/` (el frontend) sí se puede desplegar en una plataforma
serverless/estática como Vercel, pero `server/` (el compute service) necesita un host que mantenga un proceso Node
siempre encendido (Railway, Render, Fly.io, un VPS) — Vercel no sirve para esa parte porque el poller de Telegram y
los workers necesitan estar corriendo todo el tiempo, no solo responder a requests puntuales.

### Stack

- **Frontend** (`app/`): React 18 + TypeScript + Vite + Tailwind CSS + TanStack Query + React Hook Form + Zod +
  Radix UI + `vite-plugin-pwa`.
- **Compute service** (`server/`): Node + Express + TypeScript, OpenAI SDK (tool-calling), Twilio SDK.
- **Edge Functions** (`functions/`): Deno, desplegadas a InsForge.
- **Base de datos**: PostgreSQL vía InsForge, con RLS, triggers y RPCs en `migrations/`.

---

## Estructura del repositorio

```text
convivIA/
├── app/                          # Frontend: React + Vite + TS + Tailwind
│   ├── public/icons/             # Íconos de la PWA
│   ├── scripts/generate-icons.mjs
│   └── src/
│       ├── pages/
│       │   ├── auth/             # Login, registro, recuperar contraseña
│       │   ├── onboarding/       # Registro de la copropiedad
│       │   ├── support/          # Panel interno de soporte (revisión de suscripciones)
│       │   └── dashboard/        # Inicio, Conversaciones, PQRS, Reservas, Zonas comunes, Portería,
│       │                         # Comunicados, Cartera, Pagos, Unidades, Residentes,
│       │                         # Documentos, Asistente IA, Canales, Equipo, Auditoría, Configuración
│       ├── components/           # ui/ (primitivas), layout/ (DashboardLayout + navigation.ts)
│       ├── hooks/                # useAuth, useOrganization (con can()), usePropertyProfile, useAdminDashboard
│       └── lib/                  # insforgeClient, rpc, format, labels, csv, censusImport, unitGenerator
├── server/                       # Compute service: Node + Express + TS
│   └── src/
│       ├── routes/                # webhooks (Twilio), health
│       ├── services/
│       │   ├── agent/             # promptBuilder, toolRegistry, tools/, pendingActions, agentRuntime
│       │   ├── conversations/     # identityService, inboundMessageHandler, replyComposer
│       │   ├── finance/           # receiptService
│       │   ├── documents/         # ingesta y chunking para RAG
│       │   ├── jobs/               # jobWorker (background_jobs)
│       │   ├── outbox/             # outboxSender, outboxWorker
│       │   ├── reminders/          # paymentReminderWorker
│       │   ├── subscription/       # billing de la plataforma
│       │   ├── telegram/ · twilio/ # long-polling multi-tenant / WhatsApp
│       │   └── notifications/      # pushService (Web Push)
│       └── tests/                  # vitest
├── functions/                     # Edge Functions (Deno), invocadas por el frontend
├── migrations/                    # Esquema completo + RLS + RPCs, en orden (npx @insforge/cli db migrations up)
├── db-tests/                      # Tests de esquema/RLS/RPCs sobre PGlite (Postgres local, sin proyecto real)
├── PRPs/                          # Product Requirements Proposals (metodología de planeación)
├── docs/                          # Documentación de producto
├── scripts/                       # check-insforge-project.mjs, deploy-functions.mjs
└── .env.example
```

---

## Requisitos

- Node.js ≥ 20 y npm ≥ 10
- Una cuenta de [InsForge](https://insforge.dev)
- Una API key de [OpenAI](https://platform.openai.com) (o cualquier endpoint compatible, ej. OpenRouter, para desarrollo)
- Un bot de Telegram gratis vía [@BotFather](https://t.me/BotFather) (canal recomendado)
- Opcional: una cuenta de [Twilio](https://www.twilio.com) con WhatsApp habilitado

## Instalación

```bash
npm install
cp .env.example .env
```

---

## Configurar InsForge (base de datos + auth)

InsForge es un servicio en la nube: todo se gestiona con `npx @insforge/cli`.

```bash
# 1. Autenticarse (abre el navegador)
npx @insforge/cli login

# 2. Crear un proyecto nuevo (o `link` si ya tenés uno)
npx @insforge/cli create

# 3. Aplicar todas las migraciones del esquema, en orden
npx @insforge/cli db migrations up --all

# 4. Obtener las credenciales para tu .env
npx @insforge/cli secrets get ANON_KEY
```

Completá en `.env`:
- `VITE_INSFORGE_URL` / `INSFORGE_URL`: la URL de tu proyecto InsForge.
- `VITE_INSFORGE_ANON_KEY`: la `ANON_KEY` obtenida arriba.
- `INSFORGE_API_KEY`: una API key admin (Project Settings → API Keys en el dashboard de InsForge) — **nunca** la
  expongas en variables `VITE_*` del frontend.

`scripts/check-insforge-project.mjs` corre antes de `insforge:migrate` y `insforge:functions:deploy` para evitar
aplicar cambios contra el proyecto InsForge equivocado.

### Desplegar las Edge Functions

```bash
npm run insforge:functions:deploy
```

o una por una:

```bash
npx @insforge/cli functions deploy <slug> --file functions/<slug>.ts
```

Cada función necesita estos secretos en InsForge (`npx @insforge/cli secrets add <KEY> <VALUE>`): `INSFORGE_BASE_URL`
y `API_KEY` (reservados, ya provistos por InsForge), más `OPENAI_API_KEY` y `OPENAI_MODEL`.

---

## Configurar OpenAI (asistente de IA)

1. Generá una API key en [platform.openai.com](https://platform.openai.com/api-keys).
2. Completá `OPENAI_API_KEY` en `.env` **y** como secreto de InsForge (lo usan tanto `server/` como `ai-assist`).
3. `OPENAI_MODEL` controla el modelo usado por el asistente desde un único lugar.
4. `OPENAI_BASE_URL` es opcional: permite apuntar a un endpoint compatible (ej. OpenRouter) para desarrollo sin
   costo de OpenAI directo.

---

## Configurar Telegram (canal recomendado, gratis)

A diferencia de WhatsApp, Telegram no cobra por mensaje ni requiere aprobación, y el compute service lo atiende con
**long-polling** (`server/src/services/telegram/telegramPollingManager.ts`) en vez de un webhook — por eso no hace
falta URL pública ni dominio, ni siquiera en producción.

1. Hablá con [@BotFather](https://t.me/BotFather), mandale `/newbot`, seguí las instrucciones y copiá el token
   (formato `123456789:AA...`).
2. Desde `/dashboard/integrations`, pegá ese token en la tarjeta "Telegram" y conectá — esto valida el token contra
   la API de Telegram y lo guarda en `integrations.credentials`.
3. Con el compute service corriendo, el `telegramPollingManager` detecta el bot conectado en su próximo ciclo de
   refresh (máx. 30s) y empieza a atenderlo automáticamente.
4. "Desconectar" detiene el poller de ese bot en el siguiente ciclo.

---

## Configurar WhatsApp / Twilio (opcional, con costo)

1. Creá una cuenta en [twilio.com](https://www.twilio.com) y activá el WhatsApp Sandbox (o un número aprobado).
2. Configurá el webhook entrante en **Messaging → WhatsApp Sender → "When a message comes in"** apuntando al
   **compute service**: `https://<tu-dominio-del-compute-service>/api/webhooks/twilio/whatsapp`.
3. Desde `/dashboard/integrations`, conectá WhatsApp con el Account SID, el Auth Token y el número
   (`whatsapp:+1415...`).
4. En producción, dejá `TWILIO_VALIDATE_SIGNATURE=true` para validar la cabecera `X-Twilio-Signature`.
5. Fuera de la ventana de 24h de mensajes gratuitos de Meta, los envíos salientes (recordatorios de pago, novedades
   de PQRS) usan una plantilla pre-aprobada en vez de texto libre.

---

## Notificaciones push

Cuando un residente reporta un pago, radica un PQRS o reserva una zona común por chat, el equipo recibe una
notificación push con sonido — sin necesidad de tener la app abierta.

- **Web Push + VAPID** (estándar, sin depender de servicios de terceros de pago).
- Generar el par de claves una sola vez:
  ```bash
  npx web-push generate-vapid-keys
  ```
- Completá en `.env`: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (compute service) + `VITE_VAPID_PUBLIC_KEY`
  (frontend, **mismo valor** que `VAPID_PUBLIC_KEY`).
- Sin estas variables, la funcionalidad queda deshabilitada automáticamente — el resto de la app sigue funcionando
  igual.

---

## Suscripción de la copropiedad (billing de la plataforma)

Mientras no hay una pasarela de pago automática, la copropiedad paga la suscripción de ConvivIA por Nequi y sube el
comprobante desde el dashboard (`SubscriptionCard`); el equipo interno de soporte (`/support`, rol separado de las
administraciones) lo confirma o rechaza vía las Edge Functions `submit-subscription-payment` /
`confirm-subscription-payment`. Es un flujo independiente de la **cartera de residentes** (eso es dinero que los
residentes le deben a la copropiedad; esto es lo que la copropiedad le paga a la plataforma).

---

## Desarrollo local

```bash
npm run dev
```

Levanta en paralelo (vía `concurrently`):
- Compute service en `http://localhost:3011` (webhook de Twilio, poller de Telegram, workers)
- Frontend en `http://localhost:5173`

Las Edge Functions no tienen modo "dev local": se prueban desplegándolas a InsForge e invocándolas desde la app.

## Tests

```bash
npm test
```

Corre, en orden: `db-tests` (esquema, RLS y RPCs sobre **PGlite** — Postgres compilado a WASM, sin necesitar un
proyecto InsForge real ni credenciales), la suite de `server` (vitest: asistente y sus herramientas, prompt
builder, `pendingActions`, outbox, webhook de Twilio, procesamiento de Telegram — con InsForge mockeado) y la de
`app`.

Para correr sólo los tests de base de datos:

```bash
npm run test:db
```

`db-tests/tests/tenancy.test.ts` verifica específicamente el aislamiento multi-tenant: que una copropiedad no puede
leer ni modificar datos de otra, y que los permisos por rol (`has_org_permission`) se respetan.

## Build y producción

```bash
npm run build
```

- **Frontend** (`app/`): build estático — se puede desplegar en Vercel, Netlify, cualquier CDN, o
  `npx @insforge/cli deployments deploy app`. Sólo necesita las variables `VITE_*`.
- **Compute service** (`server/`): necesita un host que mantenga un proceso Node siempre encendido — **no sirve
  Vercel** para esta parte, porque el poller de Telegram y los workers tienen que estar corriendo todo el tiempo.
  Alternativas con nivel gratuito: Railway, Render, Fly.io; o `npx @insforge/cli compute deploy`; o un VPS con PM2.
- **Edge Functions**: `npm run insforge:functions:deploy` (todas) o
  `npx @insforge/cli functions deploy <slug> --file functions/<slug>.ts` (una por una).
- **Base de datos**: aplicar migraciones nuevas con `npm run insforge:migrate`.
- Activar HTTPS en el dominio del compute service (requerido por Twilio).
- Configurar todas las variables de `.env.example` como variables de entorno del proveedor elegido.

---

## Checklist de arquitectura

- [x] PostgreSQL (InsForge) como única fuente de verdad.
- [x] Multi-tenant con `organizations` (copropiedades) + `organization_members` + RBAC granular por permisos.
- [x] RLS activo en todas las tablas tenant-aware, con funciones helper `SECURITY DEFINER`
      (`SET search_path = pg_catalog, public, pg_temp`) para evitar recursión.
- [x] Patrón proponer → confirmar para toda acción del asistente que cambie estado.
- [x] Identidad de residentes verificada por canal (WhatsApp/Telegram), nunca por lo que diga el modelo.
- [x] Cartera y aplicación de pagos calculadas en base de datos (FIFO), nunca por la IA.
- [x] Cargos inmutables salvo anulación explícita; nada se borra sin dejar rastro de auditoría.
- [x] RAG sobre documentos con búsqueda de texto completo en español, respetando visibilidad configurada.
- [x] Telegram por copropiedad vía long-polling (sin URL pública) — canal recomendado por costo cero.
- [x] WhatsApp/Twilio con validación de firma y manejo de la ventana de 24h de Meta.
- [x] Onboarding simple, aceptación de invitaciones de equipo.
- [x] Dashboard completo: inicio, conversaciones, PQRS, reservas, zonas comunes, portería, comunicados, cartera,
      pagos, unidades (con importación de censo), residentes, documentos, asistente (con preview), canales,
      equipo, auditoría, configuración.
- [x] Portería y visitantes: preautorizaciones, bitácora de ingreso/salida, paquetes con aviso automático al
      residente y novedades de turno, con permiso `porteria.*` propio y capacidad activable en el asistente.
- [x] PWA instalable, responsiva en mobile y desktop.
- [x] Notificaciones push (Web Push + VAPID) al equipo cuando el asistente registra algo que requiere revisión.
- [x] Tests de aislamiento multi-tenant y RLS automatizados sobre PGlite (no requieren un proyecto real).
- [x] Logging estructurado sin secretos, rate limiting, validaciones con Zod.

## Simplificaciones conocidas / próximos pasos

- **Vista de reservas**: sólo hay vista de **lista** con filtros. La vista de calendario mensual/semanal queda como
  siguiente paso de UI.
- **Invitaciones de equipo sin email automático**: "invitar" crea un registro en `organization_invites` que la
  persona debe aceptar manualmente iniciando sesión con ese email — no se envía un email de invitación automático.
- **Suscripción de la plataforma manual**: el cobro de ConvivIA a la copropiedad es por comprobante de Nequi
  revisado por soporte; falta integrar una pasarela de pago automática.
- **Bundle del frontend**: dividir el chunk principal con `manualChunks` o `import()` dinámico mejoraría el tiempo
  de carga inicial en conexiones móviles lentas.
- **Portería sin control de acceso físico**: registra y consulta visitantes, paquetes y novedades, pero no
  integra hardware (torniquetes, biométricos, lectura automática de placas). La placa del vehículo hoy es un
  campo de texto libre, no una entidad de vehículo con historial propio.
- **Sin asamblea, mantenimiento ni contabilidad todavía**: ver `PRPs/convivia-roadmap-ampliacion-2026-09-24.md`
  para la priorización completa de lo que falta frente al system prompt original del proyecto.
