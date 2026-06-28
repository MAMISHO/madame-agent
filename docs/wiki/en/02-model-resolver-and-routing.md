# Model Resolver and Routing

`ModelResolverService` is the single-responsibility service responsible for translating requested model names (whether direct, composite, or virtual) into concrete provider configurations, dynamically evaluating whether a task should be processed locally or if it needs to be escalated to the cloud.

This service relies on **ClassifierService** and **ConfidenceEngineService** to make routing decisions. It was extracted to centralize model resolution, decoupling this logic from `RouterService` and `WorkflowService`.

---

## 1. Handled Model Types

The system mainly distinguishes three ways to reference a model in the request (`modelRaw`):

1. **Orchestrator Pairs (`orchestrator_pairs`)**
   Groupings designed for `WorkflowService`, where a main orchestrator (usually Cloud) and a list of delegated subagents (usually local or hybrid) are defined. *E.g., `Llama70B-Orchestrator+Gemma4-12B`*.
   
2. **Model Pairs (`model_pairs`)**
   "Hybrid" model pairs that link a local model and a cloud model (direct escalation). *E.g., `gemma4:12b-mlx-oc+DeepseekV4Flash`*.

3. **Direct Models (`providers`)**
   Direct keys pointing to a specific provider. *E.g., `local_medium` or directly the model name like `gemma4:12b-mlx`*.

---

## 2. Resolution Flow (`resolveModel`)

When the system needs to resolve which provider to send the message to, the `resolveModel(modelRaw, taskOrMessages)` method executes the following algorithm:

### Step A: Model Pairs Validation
1. Checks if `modelRaw` matches the name or ID of a hybrid pair (`model_pairs` in `routing.yaml`).
2. If it matches, it extracts the configurations for `pair.local` and `pair.cloud`.
3. Detects the operation mode (`plan` or `build`) by inspecting the `system` prompt of the messages.
4. Calls `ClassifierService` to evaluate the task (obtaining `{ mode, confidence }`) and `ConfidenceEngine` to evaluate the risk.
5. **Escalation Decision**:
   - If the system is in `systemMode === 'plan'`, it **forces escalation** to the Cloud model (the planner model must always be the smartest one).
   - If it is in `build`, it only escalates if the classifier determines that the task is `plan` (complex) or if the classifier confidence falls below the threshold (`shouldEscalate`).
6. Returns the chosen configuration (Local or Cloud).

### Step B: Direct Lookup
If it is not a composite pair, it directly searches for the model in the provider list (`providersConfig`). If there is an exact match by name or ID, it returns that configuration directly (`escalated: false`).

### Step C: Fallback (Automatic Routing by Classifier)
If the requested model does not exist or is not provided, it enters **Classifier Routing** mode:
1. `ClassifierService` evaluates the user input.
2. `ConfidenceEngineService` decides the destination based on the threshold.
3. The default provider configured for the intent is selected (e.g., `routing.plan.provider` vs `routing.execution.provider`).

---

## 3. Subagent Resolution (`getLocalConfig`)

The service provides the `getLocalConfig(modelName)` method, mainly used by the orchestrator's subagent cycle:
- Accepts both direct identifiers and hybrid pair names.
- If it receives a hybrid pair, it **always extracts the base local configuration** of that pair.
- This allows initializing the local tools cycle and checking if the base LLM is running (e.g., Ollama Healthcheck) before starting delegation.

---

## 4. Return Structure (`ResolvedModel`)

All resolutions from the service return a consistent interface that will be consumed by controllers or execution services:

```typescript
export interface ResolvedModel {
  config: any;           // The provider configuration (type, model, base_url, api_key_env...)
  providerKey: string;   // The resolved provider ID (e.g., "cloud_nvidia")
  escalated: boolean;    // Observability flag: was escalation triggered?
  classification?: {
    mode: string;        // Detected mode ('plan' | 'execution')
    confidence: number;  // Classification confidence level
  };
}
```

This structure allows upstream components (such as `ObservabilityService`) to accurately trace and measure when and why it was decided to escalate a request to the cloud, improving system monitoring.
