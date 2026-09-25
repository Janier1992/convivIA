# Desplegar el compute service (server/) en Railway o Render

Este servicio (Node/Express) es el que atiende el long-polling de cada bot de
Telegram conectado, el webhook de Twilio, el loop del asistente de IA y los
workers de fondo (outbox, recordatorios, ingesta de documentos). Necesita un
proceso corriendo todo el tiempo — por eso no se despliega en Vercel (ver la
sección "Por qué hay tres lugares donde vive backend" en el README).

Todo el proceso se hace **desde el sitio web de Railway o Render**, sin
instalar ni ejecutar nada en tu computador: ellos construyen y corren el
contenedor en su propia nube a partir de tu repositorio de GitHub.

## 1. Conectar el repositorio

1. Crea una cuenta en [Railway](https://railway.app) o [Render](https://render.com) (ambos tienen capa gratuita/de prueba).
2. "New Project" → "Deploy from GitHub repo" → autoriza el acceso y elige `Janier1992/convivIA`.
3. Configura el servicio para que use Docker:
   - **Root Directory**: `.` (la raíz del repositorio, NO `server/`).
   - **Dockerfile Path**: `server/Dockerfile`.
   - Railway detecta el `Dockerfile` automáticamente si le indicas la ruta; en Render, elige "Docker" como Runtime y pon esa misma ruta.

## 2. Variables de entorno

Configúralas en el panel del servicio (Railway: pestaña "Variables"; Render:
"Environment"). Ninguna de estas es la clave de Gemini de InsForge (esa vive
como secreto en InsForge, no aquí) — este servicio necesita **su propia**
copia porque llama directamente a la API, no a través de InsForge.

| Variable | Valor | Notas |
|---|---|---|
| `NODE_ENV` | `production` | |
| `INSFORGE_URL` | `https://cy43tffm.us-east.insforge.app` | El mismo backend de InsForge. |
| `INSFORGE_API_KEY` | *(la clave admin del proyecto InsForge)* | La misma que usa el CLI — trátala como secreto, nunca la subas al repo. |
| `OPENAI_API_KEY` | *(la clave de Gemini)* | Reutiliza la misma clave de Google AI Studio ya configurada para la IA de administradores — el SDK de OpenAI funciona contra Gemini vía su capa de compatibilidad. |
| `OPENAI_MODEL` | `gemini-3.8-flash` | Mismo modelo que usa `ai-assist`. |
| `OPENAI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai/` | Endpoint de compatibilidad de Gemini. |
| `APP_URL` | *(la URL real del frontend en Vercel)* | Se usa en enlaces de algunos mensajes; ajústala cuando tengas el dominio de Vercel. |
| `DEFAULT_TIMEZONE` | `America/Bogota` | |
| `WORKERS_ENABLED` | `true` | Necesario para que arranque el long-polling de Telegram y los workers. |

Railway/Render inyectan su propia variable `PORT` automáticamente; el
servicio ya la respeta (`server/src/config/env.ts`), no hace falta fijarla a mano.

**Si más adelante quieres separar el proveedor de IA de residentes del de
administradores** (por ejemplo, usar OpenAI real para uno y Gemini para el
otro), basta con cambiar estas tres variables aquí — no requiere tocar código.

## 3. Desplegar

Al guardar las variables, la plataforma construye la imagen con el
`Dockerfile` y arranca el contenedor. Revisa los logs de arranque: deberías
ver `server_started` (viene de `server/src/lib/logger.js`). Si el build
falla, copia el error de los logs — casi siempre es una variable de entorno
faltante (Zod la reporta por nombre exacto).

## 4. Conectar el bot de Telegram

Esto ya funciona hoy mismo desde el panel de ConvivIA, sin depender de este
despliegue:

1. Habla con [@BotFather](https://t.me/BotFather) en Telegram → `/newbot` → sigue las instrucciones → te da un token con forma `123456789:ABC-...`.
2. En el dashboard de ConvivIA: **Configuración → Canales** → pega el token → Conectar. La función `telegram-connect` valida el token contra la API de Telegram y lo guarda.
3. **Para que el bot responda de verdad**, el compute service de este documento tiene que estar corriendo (paso 3 de arriba) — es el que hace el long-polling de cada bot conectado.

## 5. Verificar que quedó vivo

Desde cualquier navegador (no hace falta terminal):

```
https://tu-servicio.up.railway.app/api/health
```

Debería responder 200 con el estado de los workers en background. Luego
escríbele algo a tu bot de Telegram desde tu celular — si el servicio está
corriendo, el asistente debería responder en segundos.
