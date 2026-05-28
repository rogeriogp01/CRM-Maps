# CRM-Maps

Inbox WhatsApp + CRM unificado (lead pipeline) + disparo via Baileys.

## Documentos importantes

- [Plano de execução (ROGA-32)](https://example.invalid/ROGA-32-plan) — visão de produto e ondas.
- [Compliance LGPD / opt-out automático](docs/compliance/opt-out-lgpd.md) — política e implementação técnica do opt-out (ROGA-42).

## Estrutura

```
src/lib/server/
  inbox.ts            # handler de mensagens recebidas (incl. opt-out)
  dispatch.ts         # envio real via Baileys (consulta blacklist antes)
  system-settings.ts  # singleton de configuração do operador
database/             # migrations idempotentes (001..NNN)
```

## Convenções

- Migrations são numeradas e idempotentes (`IF NOT EXISTS`, `ON CONFLICT`).
- `phone_normalized` é canônico: dígitos do DDI+DDD+número, sem `+` nem máscara.
- Para opt-out: ver `docs/compliance/opt-out-lgpd.md`.
