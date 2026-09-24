# proyectIA-vibe-coding - Motor de Desarrollo Agéntico Universal

Este es un kit de inicio y motor de desarrollo agéntico universal optimizado para **desarrollo asistido por Inteligencia Artificial (AI-Assisted Coding)**. Está diseñado para ser compatible de forma nativa con **Gemini**, **Claude Code**, **Cursor**, **Windsurf** o cualquier otro IDE o LLM de IA.

Contiene las instrucciones de contexto, agentes especializados, comandos personalizados y skills que permiten estructurar, automatizar y acelerar el ciclo de vida del software para cualquier tipo de desarrollo tecnológico (aplicativos web, aplicaciones móviles, sistemas backend, integraciones de IA, etc.).

---

## 📂 Estructura del Kit Agéntico

```
proyectIA-vibe-coding/
├── .claude/                   # Motor agéntico para Claude Code
│   ├── PRPs/                  # Historial y plantillas de Requerimientos de Producto
│   │   └── templates/
│   │       ├── prp_base.md        # Plantilla genérica base
│   │       ├── prp_frontend.md    # Plantilla optimizada para componentes visuales
│   │       └── prp_backend_api.md # Plantilla optimizada para APIs y bases de datos
│   ├── agents/                # Asistentes especializados
│   │   ├── codebase-analyst.md
│   │   ├── gestor-documentacion.md
│   │   ├── validacion-calidad.md
│   │   └── arquitecto-sistemas.md # Subagente para modelado de datos y arquitectura
│   ├── commands/              # Comandos personalizados (/primer, /bootstrap, etc.)
│   └── skills/                # Habilidades estructuradas para el desarrollo
├── .agents/                   # Configuración de contexto para Gemini
│   ├── AGENTS.md              # Reglas globales de codificación leídas por Gemini
│   └── skills/                # Habilidades estructuradas para Gemini
├── CLAUDE.md                  # Reglas del proyecto y comandos rápidos para Claude Code
├── .cursorrules               # Reglas de contexto y comportamiento para Cursor
├── .windsurfrules             # Reglas para Cascade en Windsurf
├── example.mcp.json           # Plantilla de configuración de servidores MCP
└── README.md                  # Este manual de uso
```

---

## 🛠️ Cómo iniciar un nuevo proyecto con este Kit

Cuando vayas a iniciar un nuevo proyecto tecnológico asistido por Inteligencia Artificial, sigue estos sencillos pasos:

1. **Crea el directorio de tu nuevo proyecto** e inicializa tu repositorio Git si es necesario.
2. **Copia las carpetas `.claude/` y `.agents/`**, junto con los archivos de la raíz (`CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `README.md` y `example.mcp.json`) en la raíz de tu nuevo proyecto.
3. **Inicializa tu stack con un comando**: Escribe `/bootstrap nextjs`, `/bootstrap python` o `/bootstrap expo` para que la IA genere el andamiaje inicial del stack de forma automatizada.
4. **Instala tus servidores MCP** preferidos utilizando la plantilla `example.mcp.json`. Por ejemplo, Playwright MCP te servirá para que el agente realice validaciones visuales del frontend.
5. **¡Comienza a programar de la mano con tu IA!** Pídele a tu IA que use el comando `/primer` al comenzar una nueva conversación para que entienda rápidamente tu entorno de trabajo.

---

## 🔄 El Bucle Agéntico y la Metodología PRP

El motor está estructurado en base a la metodología de **Propuesta de Requerimientos de Producto (PRP)** y el **Bucle Agéntico**. Esto garantiza que la IA no improvise código a ciegas, sino que siga un proceso de desarrollo predecible y robusto:

1. **Investigación (Fase 1)**: Se analiza el codebase actual y recursos externos mediante búsquedas oficiales para encontrar el patrón óptimo.
2. **Planificación (Fase 2)**: Se genera un documento PRP utilizando la plantilla adecuada (`prp_frontend.md` para UI, `prp_backend_api.md` para endpoints o `prp_base.md`). El plan describe las tareas de desarrollo secuenciales y su pseudocódigo asociado.
3. **Validación (Fase 3)**: El plan contiene comandos y scripts de pruebas unitarias o lints que la IA ejecuta de forma iterativa hasta alcanzar el éxito al 100%.

---

## 🧠 Habilidades (Skills) Incorporadas

El kit incluye las siguientes habilidades (Skills) listas para ser invocadas por los agentes de IA:

1. **`skill-creator`**: Una herramienta automatizada que ayuda a la IA a crear, empaquetar y validar nuevas habilidades (skills) personalizadas para extender las capacidades del motor.
2. **`agent-builder-pydantic-ai`**: Guías y patrones de diseño para construir agentes conversacionales y sistemas multi-agente robustos en Python utilizando la librería *Pydantic AI* y OpenRouter.
3. **`agent-builder-vercel-sdk`**: Guías y componentes de referencia para construir interfaces de chat en streaming y flujos agénticos en JavaScript/TypeScript utilizando el *Vercel AI SDK*.
4. **`supabase-backend`**: Directrices e instrucciones para diseñar bases de datos PostgreSQL, configurar autenticación, almacenamiento y funciones Deno Edge en *Supabase*.
5. **`insforge-backend`**: Guías de operación e integración con la infraestructura *InsForge*, un backend agent-native basado en Postgres, PostgREST, GoTrue y MinIO controlable mediante CLI y MCP.
6. **`ui-ux-aesthetics`**: Manual de tokens y reglas de estilo para construir interfaces premium, dinámicas y modernas (HSL, glassmorphism, micro-animaciones) evitando elementos planos y placeholders.

---

## 🦾 Asistentes Agénticos Disponibles (Sub-agentes)

En proyectos complejos, puedes delegar tareas a los siguientes perfiles de agentes definidos en `.claude/agents/` para que trabajen en segundo plano:

* **`arquitecto-sistemas`**: Especialista en diseñar el modelado de datos, diagramar flujos de sistemas y definir routers e infraestructura técnica.
* **`codebase-analyst`**: Especialista en la exploración del codebase, detección de convenciones de diseño y descubrimiento de patrones de integración y pruebas existentes.
* **`gestor-documentacion`**: Encargado de mantener el archivo README, documentar APIs y asegurar que los manuales técnicos permanezcan sincronizados con el código implementado.
* **`validacion-calidad`**: Especialista en QA. Diseña suites de pruebas unitarias y de integración simples y efectivas, y realiza ejecuciones repetidas hasta corregir cualquier error.
