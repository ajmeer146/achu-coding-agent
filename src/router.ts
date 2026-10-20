export type ModelConfig = {
  name: string;
  baseURL: string;
  apiKey: string;
};

export const DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

// Models known to return HTTP 404 or unsupported on current NVIDIA NIM accounts
const DEPRECATED_OR_UNAVAILABLE_MODELS = new Set([
  "nvidia/nemotron-3-super-120b-a12b",
]);

export function getModelConfig(): ModelConfig {
  // Support NVIDIA-specific environment variables with fallback to existing ones
  const apiKey = process.env.NVIDIA_API_KEY || process.env.ACHU_AGENT_API_KEY;
  const baseURL = process.env.NVIDIA_BASE_URL || process.env.ACHU_AGENT_BASE_URL || "https://integrate.api.nvidia.com/v1";
  let model = process.env.NVIDIA_MODEL || process.env.ACHU_AGENT_MODEL || DEFAULT_MODEL;

  // Remap unavailable models to the verified working model
  if (DEPRECATED_OR_UNAVAILABLE_MODELS.has(model)) {
    model = DEFAULT_MODEL;
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
