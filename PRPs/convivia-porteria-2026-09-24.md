# PRP: Portería y visitantes

## Goal

Agregar a ConvivIA el módulo de portería (visitantes, preautorizaciones, paquetes y novedades) que pedía la
sección 4.6 del system prompt maestro (`System_Prompt_Plataforma_Administracion_PH_Colombia.md`) y que el MVP
inicial no cubría.

## Why

Es la función de mayor uso diario en un conjunto residencial colombiano (cada visita, cada domicilio, cada
vehículo), muy por encima de cartera o PQRS en frecuencia de uso. Los competidores directos (apps de
administración de PH en Colombia) suelen liderar justamente con portería/visitantes como gancho de adopción.
Sin este módulo, ConvivIA cubre bien la parte financiera y de trámites pero no el punto de contacto diario
entre el residente y su copropiedad.

| Antes | Con este módulo |
|---|---|
| Cuaderno físico o Excel en la garita | Bitácora digital con búsqueda instantánea |
| Llamada a la unidad para confirmar cada visita | Preautorización desde el chat, portería solo valida |
| "¿Ya llegó mi paquete?" repetido en el grupo de WhatsApp | Aviso automático al residente cuando llega, y consulta por chat |
| Novedades de turno en un cuaderno que nadie relee | Bitácora de novedades por categoría, consultable |

## Decisiones de arquitectura

1. **Cuatro tablas nuevas** (`visitor_authorizations`, `visitor_logs`, `packages`, `gate_notes`), todas con
   `organization_id`, RLS y los mismos triggers de auditoría, `enforce_tenant_refs` y
   `prevent_organization_change` que el resto del esquema. Ningún patrón nuevo: se siguió al pie de la letra
   `20260924120000_foundation.sql`.
2. **Permiso propio `porteria.read` / `porteria.write`**, no reutiliza `residents.*` ni `reservations.*`:
   portería es un rol operativo distinto (puede no tener acceso a cartera ni al censo completo). `owner`,
   `admin` y `assistant` lo reciben con escritura; `council` y `auditor` solo lectura.
3. **El asistente puede preautorizar, nunca registrar el ingreso real.** `proponer_autorizacion_visitante`
   sigue el patrón proponer → confirmar como cualquier otra acción del asistente (nunca ejecuta directo). El
   ingreso y la salida física los registra siempre una persona en la garita (`register_visitor_entry` /
   `register_visitor_exit`), porque es una decisión humana, no una que deba tomar un modelo de lenguaje.
4. **Una autorización vencida o ya usada no bloquea el ingreso.** `register_visitor_entry` deja pasar y
   anota la incidencia en `notes`; la decisión de dejar entrar a alguien es del portero, el sistema solo
   informa. Bloquear por datos incompletos sería peor que el problema que resuelve.
5. **Aviso proactivo de paquete** vía `enqueue_outbound_to_person` (el mismo mecanismo que ya usan PQRS y
   comunicados), al contacto principal de la unidad si tiene canal conectado. Sin canal, el paquete queda
   igual registrado, solo no se notifica por chat.
6. **Capacidad `visitors_enabled`** en `agents`, activable/desactivable como el resto de capacidades del
   asistente, con sus propias líneas en `promptBuilder.ts`.

## Qué no incluye (fuera de alcance de este PRP)

- Vehículos como registro propio de la unidad (hoy la placa es un campo libre en la autorización/bitácora,
  no una entidad `Vehicle` con historial). Ver roadmap de ampliación.
- Reconocimiento de placas o control de acceso físico (biométrico, torniquetes). Este módulo es de registro y
  consulta, no de hardware de control de acceso.
- Notificación push al equipo cuando llega un visitante sin preautorización (sí existe para paquetes). Fast
  follow de bajo esfuerzo si se confirma que se necesita.

## Validación

- `db-tests/tests/gatehouse.test.ts`: aislamiento multi-tenant, flujo completo autorización → ingreso →
  salida, paquete → notificación → entrega, permisos de solo lectura, ventanas de autorización inválidas.
- `npm run test:db`, `npm run test -w server`, `npm run test -w app`, `npm run lint` y `npm run build`
  corridos completos tras el cambio: sin errores.
