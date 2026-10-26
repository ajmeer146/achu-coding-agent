export type ModelConfig = {
  name: string;
  baseURL: string;
  apiKey: string;
};

// Verified primary high-speed UI/agent model
export const PRIMARY_MODEL = "minimaxai/minimax-m3.1-flash";

// Verified stable fallback model (preserved for failover and tests)
export const FALLBACK_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

// Default model is PRIMARY_MODEL
export const DEFAULT_MODEL = PRIMARY_MODEL;

// Models known to return HTTP 404, hangs, or unsupported on current NVIDIA NIM accounts
const DEPRECATED_OR_UNAVAILABLE_MODELS = new Set([
  "nvidia/nemotron-3-super-120b-a12b",
  "mistralai/codestral-22b-instruct-v0.1",
  "moonshotai/kimi-k2.6",
  "mistralai/mistral-large-2-instruct",
  "deepseek-ai/deepseek-v4.1-flash",
]);

export function getModelConfig(): ModelConfig {
  // Support NVIDIA-specific environment variables with fallback to existing ones
  const apiKey = process.env.NVIDIA_API_KEY || process.env.ACHU_AGENT_API_KEY;
  const baseURL = process.env.NVIDIA_BASE_URL || process.env.ACHU_AGENT_BASE_URL || "https://integrate.api.nvidia.com/v1";
  let model = process.env.NVIDIA_MODEL || process.env.ACHU_AGENT_MODEL || PRIMARY_MODEL;

  // Remap unavailable models to the verified working fallback model
  if (DEPRECATED_OR_UNAVAILABLE_MODELS.has(model)) {
    model = FALLBACK_MODEL;
  }

  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY or ACHU_AGENT_API_KEY is not configured.");
  }

  if (!baseURL) {
    throw new Error("NVIDIA_BASE_URL or ACHU_AGENT_BASE_URL is not configured.");
  }

  if (!model) {
    throw new Error("NVIDIA_MODEL or ACHU_AGENT_MODEL is not configured.");
  }

  return {
    name: model,
    baseURL,
    apiKey,
  };
}
