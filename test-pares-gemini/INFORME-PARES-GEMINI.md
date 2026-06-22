# Prueba: Pares Gemini — Detección de modo plan/build

**Fecha**: 2026-06-22 01:14:10 UTC
**Servidor**: `:3001` — NO reiniciado

## Resumen

| Par | Modo | Latencia | Output chars | Provider detectado |
|---|---|---|---|---|
| gemma4:12b-mlx-oc+Gemini | plan | 13.4s | 2753 | Google Gemini (cloud) |
| gemma4:12b-mlx-oc+Gemini | build | 29.6s | 1674 | Ollama (local) |
| qwen3.6:27b-oc+Gemini | plan | 5.2s | 2760 | Google Gemini (cloud) |
| qwen3.6:27b-oc+Gemini | build | 93.8s | 13 | Ollama (local) |


## Logs de ruteo

```
  [32m[Nest] 56262  - [39m22/06/2026, 3:07:36 [32m    LOG[39m [38;5;3m[RouterService] [39m[32mPair "gemma4:12b-mlx-oc+Gemini": systemMode=plan, mode=plan, confidence=0.955 → ESCALATING to cloud_google (models/gemini-3.1-flash-lite)[39m
  [32m[Nest] 56262  - [39m22/06/2026, 3:07:42 [32m    LOG[39m [38;5;3m[RouterService] [39m[32mPair "gemma4:12b-mlx-oc+Gemini": systemMode=build, mode=plan, confidence=0.955 → using local local_gemma_oc (gemma4:12b-mlx-oc)[39m
  [32m[Nest] 56262  - [39m22/06/2026, 3:08:45 [32m    LOG[39m [38;5;3m[RouterService] [39m[32mPair "qwen3.6:27b-oc+Gemini": systemMode=plan, mode=plan, confidence=0.955 → ESCALATING to cloud_google (models/gemini-3.1-flash-lite)[39m
  [32m[Nest] 56262  - [39m22/06/2026, 3:08:48 [32m    LOG[39m [38;5;3m[RouterService] [39m[32mPair "qwen3.6:27b-oc+Gemini": systemMode=build, mode=plan, confidence=0.955 → using local local_qwen_oc (qwen3.6:27b-oc)[39m
```

## Metodología

- **plan mode**: system prompt "planning mode" → debe escalar a Gemini cloud
- **build mode**: system prompt "build mode" → debe usar modelo local
- Sin tools — solo chat text-in/text-out
- El provider se detecta por `extra_content` en la respuesta:
  - `google` en extra_content → Gemini cloud
  - `ollama` → local
- Servidor NO fue reiniciado para preservar estado
