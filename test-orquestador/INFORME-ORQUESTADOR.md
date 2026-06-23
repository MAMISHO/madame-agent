# Prueba: Orquestador-Subagente — Deepseek + Gemini

**Fecha**: 2026-06-23 19:26:57 UTC
**Task**: Listar .py, leer el más pequeño, resumir

## Resumen

| Par | Tipo | Provider | Latencia | Output chars | Delegó |
|---|---|---|---|---|---|
| DeepseekV4Flash-Orchestrator+Gemma4-12B       | Deepseek (directo)   | NVIDIA Cloud    |   207.8s | 1491 | ✅ |
| DeepseekV4Flash-Orchestrator+Gemma4-Deepseek- | Deepseek (hibrido pair) | NVIDIA Cloud    |    29.1s | 1383 | ✅ |
| Gemini-Orchestrator+Gemma12B-OC               | Gemini (directo)     | Google Gemini   |    95.2s |  526 | ✅ |
| Gemini-Orchestrator+Gemma-Gemini-Hybrid       | Gemini (hibrido pair) | Google Gemini   |    10.5s |  557 | ✅ |


## Métricas del servidor

```json
{
  "uptime": 370,
  "requests": {
    "total": 5,
    "byProvider": {
      "local_gemma_oc": 1,
      "cloud_nvidia_deepseek": 2,
      "cloud_google": 2
    },
    "byMode": {
      "direct": 1,
      "orchestrator": 4
    }
  },
  "escalations": {
    "total": 0,
    "rate": 0
  },
  "tokens": {
    "inputTotal": 1081,
    "savedByContext": 0
  },
  "latency": {
    "avgMs": 70161
  },
  "errors": {
    "total": 0,
    "byProvider": {}
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
