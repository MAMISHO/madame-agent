# Prueba: Orquestador-Subagente — Deepseek + Gemini

**Fecha**: 2026-06-24 21:49:15 UTC
**Task**: Listar .py, leer el más pequeño, resumir

## Resumen

| Par | Tipo | Provider | Latencia | Output chars | Delegó |
|---|---|---|---|---|---|
| DeepseekV4Flash-Orchestrator+Gemma4-12B       | Deepseek (directo)   |                 |    28.7s |    0 | ❌ | ({"error":{"message":"Cloud API returned 429: {\"st)
| DeepseekV4Flash-Orchestrator+Gemma4-Deepseek- | Deepseek (hibrido pair) |                 |    28.6s |    0 | ❌ | ({"error":{"message":"Cloud API returned 429: {\"st)
| Gemini-Orchestrator+Gemma12B-OC               | Gemini (directo)     | Google Gemini   |   101.5s |  539 | ✅ |
| Gemini-Orchestrator+Gemma-Gemini-Hybrid       | Gemini (hibrido pair) | Google Gemini   |     6.7s |  587 | ✅ |


## Métricas del servidor

```json
{
  "uptime": 184,
  "requests": {
    "total": 7,
    "byProvider": {
      "local_gemma_oc": 2,
      "cloud_nvidia_deepseek": 2,
      "cloud_google": 3
    },
    "byMode": {
      "direct": 2,
      "orchestrator": 4,
      "classifier": 1
    }
  },
  "escalations": {
    "total": 1,
    "rate": 0.14285714285714285
  },
  "tokens": {
    "inputTotal": 779,
    "savedByContext": 0
  },
  "latency": {
    "avgMs": 30775
  },
  "errors": {
    "total": 2,
    "byProvider": {
      "cloud_nvidia_deepseek": 2
    }
  }
}
```

## Subagentes activos

```json
[]
```

## Metodología

- Se llama al orquestador pair por nombre
- El server inyecta automáticamente la tool `delegate_subagent`
- El modelo orquestador (cloud) decide si delegar al subagente local
- El subagente ejecuta herramientas de filesystem y devuelve resultado
- Failover: si el primer subagente falla, intenta el siguiente
