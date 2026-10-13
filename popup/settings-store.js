const DEFAULT_SETTINGS = {
    highlightColor: "#3478B8",
    highlightOpacity: 0.85,
    highlightRadius: 4,
    provider: "gemini",
    responseStyle: "Responde en español de forma clara y natural. Ve directo a lo que preguntan y añade solo el contexto útil.",
};
const PREVIOUS_DEFAULT_RESPONSE_STYLE =
    "Responde en español, de forma muy breve y clara, en una o dos frases. Da la idea principal y una justificación corta solo si la pregunta la solicita.";

function storageGet(area, keys) {
    return new Promise((resolve, reject) => {
        chrome.storage[area].get(keys, (stored) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(stored);
        });
    });
}

function storageSet(area, values) {
    return new Promise((resolve, reject) => {
        chrome.storage[area].set(values, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

export async function loadSettings() {
    const [synced, local] = await Promise.all([
        storageGet("sync", [...Object.keys(DEFAULT_SETTINGS), "apiKey"]),
        storageGet("local", ["apiKeys"]),
    ]);
    const apiKeys = Array.isArray(local.apiKeys) && local.apiKeys.length
        ? local.apiKeys
        : (synced.apiKey ? [synced.apiKey] : []);
    const responseStyle = synced.responseStyle === PREVIOUS_DEFAULT_RESPONSE_STYLE
        ? DEFAULT_SETTINGS.responseStyle
        : synced.responseStyle;

    return {
        settings: { ...DEFAULT_SETTINGS, ...synced, responseStyle },
        apiKeys,
    };
}

export async function saveSettings(settings, apiKeys) {
    await storageSet("local", { apiKeys });
    await storageSet("sync", {
        highlightColor: settings.highlightColor,
        highlightOpacity: settings.highlightOpacity,
        highlightRadius: settings.highlightRadius,
        provider: ["gemini-web", "deepseek", "chatgpt"].includes(settings.provider) ? settings.provider : "gemini",
        responseStyle: settings.responseStyle,
        apiKey: "",
    });
}
