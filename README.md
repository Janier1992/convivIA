# Reservas AI — SaaS multi-tenant de agentes de reservas

Plataforma SaaS multi-tenant para negocios que trabajan con reservas o turnos (restaurantes, barberías,
peluquerías/salones de belleza, spas, consultorios odontológicos y médicos, fisioterapia, veterinarias, talleres
mecánicos, academias, gimnasios, estudios, etc.). Cada negocio configura su
propio agente de IA, que atiende a sus clientes por **Telegram** (canal recomendado, gratuito) o **WhatsApp**,
consulta disponibilidad real contra la agenda del negocio y crea, cancela o reprograma reservas — sincronizando
automáticamente con **Google Calendar**, tanto el del negocio como una invitación al propio calendario del cliente.

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
- [Configurar OpenAI (agente de IA)](#configurar-openai-agente-de-ia)
- [Configurar Telegram (canal recomendado, gratis)](#configurar-telegram-canal-recomendado-gratis)
- [Configurar WhatsApp / Twilio (opcional, con costo)](#configurar-whatsapp--twilio-opcional-con-costo)
- [Configurar Google Calendar](#configurar-google-calendar)
- [Moneda y localización](#moneda-y-localización)
- [PWA — instalación en celular/escritorio](#pwa--instalación-en-celularescritorio)
- [Notificaciones push](#notificaciones-push)
- [Desarrollo local](#desarrollo-local)
- [Tests](#tests)
- [Build y producción](#build-y-producción)
- [Checklist de arquitectura](#checklist-de-arquitectura)
- [Simplificaciones conocidas / próximos pasos](#simplificaciones-conocidas--próximos-pasos)

---

## Funcionalidades

### Onboarding
Wizard de 10 pasos: nombre y tipo de negocio, zona horaria, datos de contacto, horarios de atención, catálogo de
servicios (con precio, moneda y duración), recursos (mesas/personal/consultorios), configuración del agente de IA, y
conexión de canales — todo antes de llegar al dashboard.

### Agente de IA (por negocio, 100% configurable)
- Responde en el idioma y tono configurados (formal / casual / amable), con instrucciones y reglas propias por
  negocio.
- Nunca inventa horarios, precios ni servicios: todo lo que dice sale de datos reales (`consultar_disponibilidad`,
  `consultar_servicios`, `obtener_info_negocio`).
- Pide confirmación explícita del cliente antes de reservar, cancelar o reprogramar.
- Resuelve `service_id`/`resource_id` reales (nunca los inventa) cuando el negocio tiene catálogo configurado.
- Si el negocio conectó Google Calendar, ofrece pedirle el email al cliente (opcional) para invitarlo al turno en su
  propio calendario, y le recuerda que acepte la invitación por correo.
- Vista previa de conversación desde el dashboard, sin crear reservas reales, para probar tono/instrucciones.

### Canales de mensajería
- **Telegram** (recomendado): cada negocio conecta su propio bot (gratis, vía [@BotFather](https://t.me/BotFather)).
  El compute service lo atiende con *long-polling*, sin necesitar dominio ni URL pública.
- **WhatsApp vía Twilio** (opcional, tiene costo de Twilio/Meta): webhook entrante validado por firma.

### Reservas
- Vista de lista con filtro por estado, creación manual desde el dashboard (con selección de servicio/recurso,
  email opcional del cliente) o automática vía el agente.
- Prevención de doble reserva a nivel de base de datos (no solo en la app).
- Acciones por estado: completar, marcar no-show, cancelar, y eliminar (una vez cancelada/completada) para mantener
  la lista limpia.

### Servicios y recursos
- Alta manual, edición inline (nombre, duración, precio, moneda) y baja.
- **Carga masiva por Excel (.xlsx)**: botón "Carga masiva" en Servicios, con plantilla descargable, vista previa de
  filas válidas/erróneas antes de confirmar, y detección de encabezados sin importar tildes/mayúsculas.
- Sin flechitas de incremento/decremento en los campos numéricos — el usuario tipea el valor directamente.

### Clientes
- Búsqueda por nombre/teléfono, historial de reservas por cliente.
- Nombre, email y notas editables directamente desde el dashboard (el email es el que se usa para invitarlo a
  Google Calendar).
- Eliminar cliente (rol admin/owner).

### Inbox
- Conversaciones por canal con historial de mensajes e info del cliente (reservas recientes), respuesta manual
  desde el dashboard cuando hace falta intervención humana.
- En mobile, la vista de 3 columnas se adapta a navegación por paneles (lista → hilo, con info del cliente en un
  diálogo).

### Integraciones
- Telegram, WhatsApp (Twilio) y Google Calendar, cada una conectada/desconectada por organización desde
  `/dashboard/integrations`, con credenciales aisladas por tenant.

### Equipo
- Invitar usuarios por email con rol `admin` o `staff`, cambiar roles, revocar acceso. La organización siempre
  conserva al menos un `owner`.

### Notificaciones push
- El negocio recibe una notificación con sonido en el celular apenas el agente confirma una reserva por
  Telegram/WhatsApp, sin necesidad de tener la app abierta. Se activan desde **Configuración**, por dispositivo.

### Configuración del negocio
- Datos de contacto, moneda (COP por defecto, cualquier otra editable), duración/intervalo de turnos, capacidad,
  anticipación mínima/máxima, política de cancelación, horarios por día.

### Multi-tenant y seguridad
- Aislamiento estricto por organización con Row Level Security de PostgreSQL, no con filtros en el código de la
  aplicación.

---

## Arquitectura

```text
User → Organization → Business Profile → Agent → Channels → Customers → Conversations → Messages → Reservations → Integrations
```

Backend: **[InsForge](https://insforge.dev)** (PostgreSQL + Auth + Data API, gestionado con `@insforge/cli` y
`@insforge/sdk`).

- **Multi-tenant desde el modelo de datos**: todo dato relevante cuelga de `organization_id`, y el aislamiento se
  garantiza con **Row Level Security** de PostgreSQL.
- **Prevención de doble reserva** a nivel de base de datos con un `EXCLUDE` constraint (`btree_gist`) sobre
  `(organization_id, resource_id, tstzrange(start_at, end_at))`, más locks de asesoría (`pg_advisory_xact_lock`)
  para el caso de capacidad total sin recursos individuales.
- **Agente genérico**: el prompt se arma en runtime a partir de `business_profiles`, `services`, `resources`,
  `business_hour_periods`, `agents`, `agent_rules` y el estado de la integración de Google Calendar. El motor de
  reservas es el mismo para todos los rubros; lo único específico por rubro es una guía opcional para el agente
  (`server/src/services/agent/businessTypes.ts`: qué datos anotar y límites de seguridad, como no dar diagnósticos)
  y las plantillas de servicios del onboarding (`app/src/lib/businessTypes.ts`).

### Por qué hay tres lugares donde vive "backend"

El SDK de browser de InsForge (`@insforge/sdk`, cliente `createClient`) mantiene el access token del usuario
**encapsulado en memoria, sin getter público**. Esto significa que el frontend **no puede** adjuntar
`Authorization: Bearer <token>` a un servidor propio externo — sólo puede adjuntarlo automáticamente cuando llama a
`insforge.functions.invoke()` (Edge Functions de InsForge). Esa restricción de la plataforma determinó la
arquitectura:

| Dónde | Qué vive ahí | Por qué |
|---|---|---|
| **Postgres (migraciones)** | Tablas, RLS, triggers, RPCs (`book_reservation`, `create_organization_with_owner`, `accept_organization_invite`, etc.) | El frontend llama estas RPCs directamente vía `insforge.database.rpc()` — el SDK adjunta el token automáticamente porque es una llamada al propio backend de InsForge. |
| **`functions/` (Edge Functions, Deno, desplegadas con `@insforge/cli functions deploy`)** | `agent-preview`, `check-availability`, `twilio-connect`, `twilio-disconnect`, `telegram-connect`, `telegram-disconnect`, `google-oauth-start`, `google-disconnect`, `conversations-reply` | Lógica privilegiada que el **frontend** dispara (necesita el token del usuario + una API key admin para tocar `integrations.credentials`, bloqueada por columna para `authenticated`). |
| **`server/` (compute service, Node/Express persistente)** | Webhook de Twilio, callback de Google OAuth, el long-polling de cada bot de Telegram conectado, el loop de tool-calling del agente | Twilio y Google llaman directo (no el frontend vía SDK); Telegram no llama a nadie (long-polling saliente), pero igual necesita un proceso persistente corriendo. El agente necesita poder seguir procesando en background — algo que una función serverless de vida corta no garantiza. |

**Importante para el despliegue**: por esto mismo, `app/` (el frontend) sí se puede desplegar en una plataforma
serverless/estática como Vercel, pero `server/` (el compute service) necesita un host que mantenga un proceso Node
siempre encendido (Railway, Render, Fly.io, un VPS) — Vercel no sirve para esa parte porque el poller de Telegram
necesita estar escuchando todo el tiempo, no solo responder a requests puntuales.

### Stack

- **Frontend** (`app/`): React 18 + TypeScript + Vite + Tailwind CSS + TanStack Query + React Hook Form + Zod +
  Radix UI + `vite-plugin-pwa`.
- **Compute service** (`server/`): Node + Express + TypeScript, OpenAI SDK (tool-calling), Twilio SDK, `googleapis`.
- **Edge Functions** (`functions/`): Deno, desplegadas a InsForge.
- **Base de datos**: PostgreSQL vía InsForge, con RLS, triggers y RPCs en `migrations/`.

---

## Estructura del repositorio

```text
crm-clients-wpp/
├── app/                          # Frontend: React + Vite + TS + Tailwind
│   ├── public/icons/             # Íconos de la PWA (manifest + apple-touch-icon)
│   ├── scripts/
│   │   └── generate-icons.mjs    # Genera los PNG de los íconos sin dependencias nativas
│   ├── vite.config.ts            # Config de vite-plugin-pwa (manifest, service worker)
│   └── src/
│       ├── pages/
│       │   ├── auth/             # Login, registro, recuperar contraseña
│       │   ├── onboarding/       # Wizard de 10 pasos + steps/
│       │   └── dashboard/        # Inicio, Inbox, Reservas, Clientes, Servicios, Recursos,
│       │                         # Agente, Integraciones, Equipo, Configuración
│       ├── components/
│       │   ├── ui/               # Primitivas (button, input, select, dialog, ...)
│       │   ├── layout/            # DashboardLayout (sidebar/drawer responsivo)
│       │   └── AcceptInvites.tsx, RequireAuth.tsx, RequireOrganization.tsx
│       ├── hooks/                # useAuth, useOrganization, usePendingInvites
│       └── lib/                  # insforgeClient, functionsClient, queryClient, currency
├── server/                       # Compute service: Node + Express + TS
│   ├── src/
│   │   ├── routes/               # webhooks (Twilio), integrations (Google callback), health
│   │   ├── services/
│   │   │   ├── agent/            # promptBuilder, tools, toolExecutors, agentRuntime, coreRules
│   │   │   ├── availability/     # motor de disponibilidad (horarios, recursos, capacidad)
│   │   │   ├── reservations/     # createReservation/cancel/reschedule (vía RPCs + Google sync)
│   │   │   ├── customers/        # findOrCreateCustomerByPhone, updateCustomer
│   │   │   ├── conversations/    # handleInboundMessage: lógica compartida entre canales
│   │   │   ├── google/           # OAuth callback + Google Calendar (crear/actualizar/borrar eventos)
│   │   │   ├── twilio/           # WhatsApp
│   │   │   └── telegram/         # long-polling multi-tenant (telegramPollingManager)
│   │   ├── middleware/           # rateLimit, errorHandler
│   │   ├── config/env.ts         # Validación de variables de entorno
│   │   └── lib/                  # insforge (admin client), openai, logger
│   └── tests/                    # vitest: disponibilidad, tools del agente, prompt, webhook, telegram
├── functions/                    # Edge Functions (Deno), invocadas por el frontend vía insforge.functions.invoke()
├── migrations/                   # Esquema completo + RLS + RPCs, en orden (npx @insforge/cli db migrations up)
├── db-tests/                     # Test de aislamiento multi-tenant (SQL plano, correr con psql)
├── scripts/
│   └── deploy-functions.mjs      # Deploya todas las Edge Functions de una sola vez
└── .env.example
```

---

## Requisitos

- Node.js ≥ 20 y npm ≥ 10
- Una cuenta de [InsForge](https://insforge.dev)
- Una API key de [OpenAI](https://platform.openai.com) (o cualquier endpoint compatible, ej. OpenRouter, para desarrollo)
- Un bot de Telegram gratis vía [@BotFather](https://t.me/BotFather) (canal recomendado)
- Opcional: una cuenta de [Twilio](https://www.twilio.com) con WhatsApp habilitado
- Opcional: un proyecto de [Google Cloud](https://console.cloud.google.com) con la API de Calendar habilitada

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
- `INSFORGE_API_KEY`: una API key admin (Project Settings → API Keys en el dashboard de InsForge).

### Datos demo

`migrations/20260830121700_seed-demo-data.sql` crea 3 organizaciones demo completas (restaurante, barbería, salón
de belleza) — horarios, servicios, recursos, en pesos colombianos — sin owner asignado. Para explorarlas: registrate
normalmente (`/register`) y llamá la RPC `claim_demo_organization('<id-de-la-org>')` (los 3 IDs están en el propio
archivo de seed) para convertirte en owner de una de ellas.

### Desplegar las Edge Functions

```bash
node scripts/deploy-functions.mjs
```

o una por una:

```bash
npx @insforge/cli functions deploy <slug> --file functions/<slug>.ts
```

Cada función necesita estos secretos en InsForge (`npx @insforge/cli secrets add <KEY> <VALUE>`): `INSFORGE_BASE_URL`
y `API_KEY` (reservados, ya provistos por InsForge), más `OPENAI_API_KEY`, `OPENAI_MODEL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` y `OAUTH_STATE_SECRET` (este último con el mismo valor que en el
`.env` del compute service).

---

## Configurar OpenAI (agente de IA)

1. Generá una API key en [platform.openai.com](https://platform.openai.com/api-keys).
2. Completá `OPENAI_API_KEY` en `.env` **y** como secreto de InsForge (lo usan tanto `server/` como `agent-preview`).
3. `OPENAI_MODEL` controla el modelo usado por el agente desde un único lugar.
4. `OPENAI_BASE_URL` es opcional: permite apuntar a un endpoint compatible (ej. OpenRouter) para desarrollo sin
   costo de OpenAI directo.

---

## Configurar Telegram (canal recomendado, gratis)

A diferencia de WhatsApp, Telegram no cobra por mensaje ni requiere aprobación de negocio, y el compute service lo
atiende con **long-polling** (`server/src/services/telegram/telegramPollingManager.ts`) en vez de un webhook — por
eso no hace falta URL pública ni dominio, ni siquiera en producción.

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

---

## Configurar Google Calendar

Sólo el **negocio** pasa por el consentimiento de Google (una vez). El **cliente** que reserva nunca necesita su
propia cuenta de Google: si da su email al agente, se lo agrega como invitado al evento y Google le manda la
invitación por correo — si acepta, le queda guardado en su propio calendario.

1. Creá un proyecto en [Google Cloud Console](https://console.cloud.google.com) y habilitá la **Google Calendar API**.
2. Configurá la pantalla de consentimiento OAuth (tipo **Externo**), agregando los scopes
   `.../auth/calendar.events` y `.../auth/userinfo.email`, y tu email como usuario de prueba (modo "Testing").
3. Creá credenciales **OAuth 2.0 Client ID** de tipo "Aplicación web".
4. Agregá como **URI de redirección autorizado** la URL del **compute service** (Google redirige ahí, no a
   InsForge ni al frontend):
   ```text
   http://localhost:3011/api/integrations/google/callback   # desarrollo
   https://<tu-dominio-del-compute-service>/api/integrations/google/callback   # producción
   ```
5. Completá `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI` en `.env` **y** como secretos de
   InsForge.
6. Desde `/dashboard/integrations`, cada organización conecta su **propia** cuenta de Google (tokens guardados por
   `organization_id`, nunca en una fila global).

---

## Moneda y localización

La plataforma nació pensada para Colombia: el default de moneda de negocios y servicios nuevos es **COP** (peso
colombiano). No está hardcodeado — cada negocio puede cambiar su moneda desde **Configuración**, y cada servicio
tiene su propio selector de moneda al crearlo o editarlo (`app/src/lib/currency.ts`), así que la plataforma sigue
sirviendo para otros países sin cambios de esquema.

---

## PWA — instalación en celular/escritorio

La app es instalable como Progressive Web App:

- **Manifest** (`vite-plugin-pwa`, configurado en `app/vite.config.ts`): nombre, ícono, `theme_color` de marca,
  `display: "standalone"` (se abre sin barra de navegador).
- **Íconos**: generados con `app/scripts/generate-icons.mjs` (sin dependencias nativas de imágenes) — 192px, 512px,
  512px "maskable" (Android) y `apple-touch-icon` (iOS). Para regenerarlos tras cambiar el color de marca:
  ```bash
  node app/scripts/generate-icons.mjs
  ```
- **Service worker propio** (`app/src/sw.ts`, modo `injectManifest` de `vite-plugin-pwa`): precachea el shell de la
  app (HTML/JS/CSS/íconos) para que abra instantáneo, y además escucha los eventos `push`/`notificationclick` (ver
  [Notificaciones push](#notificaciones-push)). Los datos del negocio (reservas, conversaciones) siempre se piden
  en vivo a InsForge, nunca se sirven desde caché.
- **Actualizaciones**: cuando se publica una versión nueva, el usuario ve un aviso ("Hay una nueva versión
  disponible") con un botón para actualizar al toque.
- **Botón "Instalar app"** propio (visible en la pantalla de login, `app/src/components/InstallAppButton.tsx`): en
  Android/Chrome dispara la instalación de un clic usando el evento `beforeinstallprompt`, capturado globalmente en
  `app/src/hooks/useInstallPrompt.tsx` (un React Context montado una única vez en `App.tsx`, para que el evento —
  que el navegador dispara sólo una vez por sesión — no se pierda si llega mientras el usuario está en otra
  pantalla). Si el navegador no ofrece ese evento (o en iOS, que no lo tiene), el botón muestra instrucciones
  manuales según la plataforma detectada.
- El service worker **no se activa en modo desarrollo** (`npm run dev`), es el comportamiento esperado. Para
  probar la instalación real:
  ```bash
  cd app
  npm run build
  npm run preview
  ```
  y abrí la URL que imprime desde el navegador del celular (misma red) o desde Chrome/Edge en desktop.

Todo el dashboard es responsivo: el menú lateral se convierte en un drawer con botón de hamburguesa en mobile (con
altura fija al viewport para que esa barra nunca se desplace al scrollear el contenido), y el Inbox (que en desktop
muestra 3 columnas) pasa a navegación por paneles (lista → conversación, con la info del cliente en un diálogo).

---

## Notificaciones push

Cuando el agente de IA confirma una reserva nueva (por Telegram/WhatsApp), el negocio recibe una notificación push
con sonido en el celular — sin necesidad de tener la app abierta.

- **Web Push + VAPID** (estándar, sin depender de Firebase/OneSignal ni de ningún servicio de terceros de pago).
- El service worker (`app/src/sw.ts`) escucha el evento `push` y muestra la notificación; al tocarla, enfoca la
  pestaña de la app ya abierta o abre una nueva en `/dashboard/reservations`.
- Cada dispositivo/navegador donde un miembro del negocio activa las notificaciones (desde **Configuración** →
  "Notificaciones push") guarda su suscripción en `push_subscriptions`, aislada por organización con RLS.
- El compute service (`server/src/services/notifications/pushService.ts`) manda el push, en paralelo a todas las
  suscripciones de esa organización, cuando se crea una reserva vía el agente
  (`server/src/services/reservations/reservationsService.ts`). Es best-effort — igual que la sincronización con
  Google Calendar: si falla el envío, la reserva ya quedó creada de todas formas. Las reservas creadas manualmente
  desde el dashboard no disparan push (quien las crea ya está mirando el dashboard).

### Configurar VAPID

```bash
npx web-push generate-vapid-keys
```

Completá con el par que te devuelva:
- `.env`: `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` (compute service) + `VITE_VAPID_PUBLIC_KEY` (frontend, **mismo
  valor** que `VAPID_PUBLIC_KEY`).
- Como secretos de InsForge sólo hace falta si algún día una Edge Function necesita mandar push directamente; hoy
  sólo los usa el compute service, así que alcanza con el `.env` de `server/` en el host donde lo despliegues.

Sin estas variables, la funcionalidad queda deshabilitada automáticamente (el botón de Configuración explica que el
navegador/dispositivo no la soporta) — el resto de la app sigue funcionando igual.

---

## Desarrollo local

```bash
npm run dev
```

Levanta en paralelo:
- Compute service en `http://localhost:3011` (webhook de Twilio, callback de Google, poller de Telegram)
- Frontend en `http://localhost:5173`

Las Edge Functions no tienen modo "dev local": se prueban desplegándolas a InsForge e invocándolas desde la app.

## Tests

```bash
npm test
```

Corre la suite de `server` (vitest: motor de disponibilidad, reglas y herramientas del agente, prompt builder,
webhook de Twilio, procesamiento de Telegram — con InsForge mockeado, no requiere proyecto real) y de `app`.

### Tests de aislamiento multi-tenant / RLS

```bash
psql "<connection-string-de-tu-proyecto-InsForge>" -f db-tests/tenant-isolation.sql
```

Verifica que un owner/staff de una organización no puede leer, insertar, actualizar ni borrar datos de otra, que
staff no puede ver integraciones ni eliminar la organización, y que el `EXCLUDE` constraint bloquea reservas
solapadas. Requiere reemplazar los UUID de usuarios de prueba por cuentas reales ya registradas y ejecutarse en una
única sesión `psql` (no como una secuencia de `db query` sueltos, porque necesita mantener `SET LOCAL ROLE` dentro
de una misma transacción).

## Build y producción

```bash
npm run build
```

- **Frontend** (`app/`): build estático — se puede desplegar en Vercel, Netlify, cualquier CDN, o
  `npx @insforge/cli deployments deploy app`. Sólo necesita las variables `VITE_*`.
- **Compute service** (`server/`): necesita un host que mantenga un proceso Node siempre encendido — **no sirve
  Vercel** para esta parte, porque el poller de Telegram tiene que estar escuchando todo el tiempo. Alternativas
  con nivel gratuito: Railway, Render, Fly.io; o `npx @insforge/cli compute deploy`; o un VPS con PM2.
- **Edge Functions**: `npx @insforge/cli functions deploy <slug> --file functions/<slug>.ts` por cada una, o
  `node scripts/deploy-functions.mjs` para todas.
- **Base de datos**: aplicar migraciones nuevas con `npx @insforge/cli db migrations up --all`.
- Activar HTTPS en el dominio del compute service (requerido por Twilio y por el redirect URI de Google OAuth).
- Configurar todas las variables de `.env.example` como variables de entorno del proveedor elegido.

---

## Checklist de arquitectura

- [x] PostgreSQL (InsForge) como única fuente de verdad.
- [x] Multi-tenant con `organizations` + `organization_members` + roles `owner/admin/staff`.
- [x] RLS activo en todas las tablas tenant-aware, con funciones helper `SECURITY DEFINER`
      (`SET search_path = pg_catalog, public, pg_temp`) para evitar recursión.
- [x] GRANT explícito + REVOKE de columna (`integrations.credentials`).
- [x] Prevención de doble reserva con `EXCLUDE` constraint + locks de asesoría.
- [x] `book_reservation` valida que el servicio/recurso pertenezcan a la organización que reserva (aislamiento
      multi-tenant también a nivel de datos referenciados, no sólo de filas propias).
- [x] Agente con tool-calling multi-ronda, confirmación explícita antes de reservar, IDs de servicio/recurso
      siempre resueltos contra el catálogo real (nunca inventados).
- [x] Telegram por organización vía long-polling (sin URL pública) — canal recomendado por costo cero.
- [x] WhatsApp/Twilio con routing multi-organización por número y validación de firma configurable.
- [x] Google Calendar por organización (OAuth propio del negocio) + invitación al cliente como asistente del
      evento cuando da su email.
- [x] Onboarding de 10 pasos, aceptación de invitaciones de equipo.
- [x] Dashboard completo: inicio, inbox, reservas, clientes, servicios (con carga masiva por Excel), recursos,
      agente (con preview), integraciones, equipo, configuración.
- [x] Moneda configurable por negocio (COP por defecto).
- [x] PWA instalable, responsiva en mobile y desktop.
- [x] Notificaciones push (Web Push + VAPID) al negocio cuando el agente confirma una reserva nueva.
- [x] Logging estructurado sin secretos, rate limiting, protección de costos de IA, validaciones con Zod.

## Simplificaciones conocidas / próximos pasos

- **Vista de reservas**: sólo hay vista de **lista** con filtros por estado. La vista de calendario
  mensual/semanal queda como siguiente paso de UI.
- **`check-availability` duplicado**: la Edge Function y el servicio interno del compute service implementan el
  mismo algoritmo por separado (Deno y Node) en vez de compartir una única fuente de verdad en SQL.
- **Invitaciones de equipo sin email automático**: "invitar" crea un registro en `organization_invites` que la
  persona debe aceptar manualmente iniciando sesión con ese email — no se envía un email de invitación automático.
- **Tests de RLS**: escritos en `db-tests/tenant-isolation.sql` pero deben ejecutarse manualmente contra un
  proyecto InsForge real antes de un primer despliegue a producción.
- **Google Login / Magic Link**: activables desde la configuración de Auth de InsForge sin cambios de código más
  allá de agregar los botones de UI (`insforge.auth.signInWithOAuth`).
- **Bundle del frontend**: el chunk principal supera los 500kB tras minificar; dividirlo con `manualChunks` o
  `import()` dinámico mejoraría el tiempo de carga inicial en conexiones móviles lentas.
