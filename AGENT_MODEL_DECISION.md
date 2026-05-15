# Decision Log
## Model Selection: gemma4:e4b

**Date:** 2026-05-14
**Context:** Agentic Telemetry MVP - Gemma4 model integration

### Attempts
| Model Variant | Size | Result |
|--------------|------|--------|
| gemma4:e4b (default) | 9.6GB | ❌ Binary crash - exit -1 |
| gemma4:e4b-it-q4_K_M | 9.6GB | ❌ "Requires more system memory than available" |
| gemma4:e2b | 2GB | ✅ Working |
| gemma4:26b | 18GB | ❌ Too large |
| gemma4:31b | 20GB | ❌ Too large |
| gemma4:mxfp16 | N/A | ❌ Does not exist in registry |

### Analysis
The e4b variant consistently crashes with "llama runner process has terminated with exit code -1" across:
- Docker container (16GB memory allocated)
- Native host with Metal GPU (17.8GB VRAM)
- Various configuration changes (flash attention, metal, cpu)

The crash appears to be a runner/model binary compatibility issue, not resource-related.
gemma4:e2b runs successfully and generates valid inference.

### Pending
- [ ] Re-test gemma4:e4b after Ollama version update
- [ ] Check if newer runner builds resolve the binary crash