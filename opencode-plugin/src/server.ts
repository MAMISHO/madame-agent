import type { Plugin, Hooks, ProviderHook, ModelV2 } from "../types/index.js";

const CUSTOM_PROVIDER_ID = "local-redirect-provider";
const CUSTOM_MODEL_ID = "local-model";
const LOCAL_BASE_URL = "http://localhost:3001";

/* ------------------------------------------------------------------ */
/*  Provider Hook                                                     */
/* ------------------------------------------------------------------ */

const providerHook: ProviderHook = {
  id: CUSTOM_PROVIDER_ID,
  models: async (_provider, _ctx) => ({
    [CUSTOM_MODEL_ID]: {
      id: CUSTOM_MODEL_ID,
      name: "Local Redirect Model",
      provider: CUSTOM_PROVIDER_ID,
      capabilities: ["chat"],
    } as ModelV2,
  }),
};

/* ------------------------------------------------------------------ */
/*  Server Export                                                     */
/* ------------------------------------------------------------------ */

export const server: Plugin = async () => {
  const hooks: Hooks = {};

  /* --------------------------------------------------------------- */
  /*  chat.params — redirect requests to http://localhost:3001       */
  /* --------------------------------------------------------------- */
  hooks["chat.params"] = async (input, output) => {
    if (input.model.id === CUSTOM_MODEL_ID) {
      output.options = {
        ...output.options,
        // Most SDKs honour a "baseUrl" or API-key override via options.
        baseUrl: LOCAL_BASE_URL,
        apiKey: "placeholder",
      };
    }
  };

  /* --------------------------------------------------------------- */
  /*  chat.headers — add custom routing / auth headers               */
  /* --------------------------------------------------------------- */
  hooks["chat.headers"] = async (_input, output) => {
    output.headers = {
      "x-redirect-target": LOCAL_BASE_URL,
    };
  };

  return {
    ...hooks,
    provider: providerHook,
  };
};
