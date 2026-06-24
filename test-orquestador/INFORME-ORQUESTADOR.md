# Prueba: Orquestador-Subagente — Deepseek + Gemini

**Fecha**: 2026-06-23 23:31:03 UTC
**Task**: Listar .py, leer el más pequeño, resumir

## Resumen

| Par | Tipo | Provider | Latencia | Output chars | Delegó |
|---|---|---|---|---|---|
| DeepseekV4Flash-Orchestrator+Gemma4-12B       | Deepseek (directo)   | NVIDIA Cloud    |    93.1s | 1339 | ✅ |
| DeepseekV4Flash-Orchestrator+Gemma4-Deepseek- | Deepseek (hibrido pair) | NVIDIA Cloud    |    70.6s | 1114 | ✅ |
| Gemini-Orchestrator+Gemma12B-OC               | Gemini (directo)     | Google Gemini   |   124.1s |  415 | ✅ |
| Gemini-Orchestrator+Gemma-Gemini-Hybrid       | Gemini (hibrido pair) | Google Gemini   |    28.6s |  621 | ✅ |


## Métricas del servidor

```json
{
  "uptime": 740,
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
    "avgMs": 64958
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
