export function getModelConfig() {
    const apiKey = process.env.ACHU_AGENT_API_KEY;
    const baseURL = process.env.ACHU_AGENT_BASE_URL;
    const model = process.env.ACHU_AGENT_MODEL;
    if (!apiKey) {
        throw new Error("ACHU_AGENT_API_KEY is not configured.");
    }
    if (!baseURL) {
        throw new Error("ACHU_AGENT_BASE_URL is not configured.");
    }
    if (!model) {
        throw new Error("ACHU_AGENT_MODEL is not configured.");
    }
    return {
        name: model,
        baseURL,
        apiKey,
    };
}
