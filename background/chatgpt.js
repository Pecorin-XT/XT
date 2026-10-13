import { extractCorrectId, extractCorrectIds } from "./gemini.js";
import { getReadyProviderTab } from "./provider-bridge.js";

const chatGptPorts = new Map();

export function registerChatGptPort(port, tabId) {
    if (tabId != null) chatGptPorts.set(tabId, port);
    port.onDisconnect.addListener(() => {
        if (tabId != null && chatGptPorts.get(tabId) === port) chatGptPorts.delete(tabId);
    });
}

export function hasChatGptConnection() {
    return chatGptPorts.size > 0;
}

function sendPrompt(tabId, prompt, signal, requestId) {
    const port = chatGptPorts.get(tabId);
    if (port) return sendPromptOverPort(port, prompt, signal, requestId);
    if (tabId == null) return Promise.reject(new Error("CHATGPT_NO_ACTIVE_CONNECTION"));

    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error("REQUEST_ABORTED"));
            return;
        }

        const abortHandler = () => {
            signal.removeEventListener("abort", abortHandler);
            reject(new Error("REQUEST_ABORTED"));
        };
        signal.addEventListener("abort", abortHandler, { once: true });
        chrome.tabs.sendMessage(tabId, {
            type: "PECO_CHATGPT_GENERATE",
            prompt,
            requestId,
        }, (response) => {
            signal.removeEventListener("abort", abortHandler);
            if (chrome.runtime.lastError) {
                reject(new Error(`CHATGPT_BRIDGE_ERROR: ${chrome.runtime.lastError.message}`));
                return;
            }
            if (!response?.ok) {
                reject(new Error(response?.error || "CHATGPT_EMPTY_RESPONSE"));
                return;
            }
            resolve(response.text);
        });
    });
}

function sendPromptOverPort(port, prompt, signal, requestId) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error("REQUEST_ABORTED"));
            return;
        }

        const cleanup = () => {
            signal.removeEventListener("abort", abortHandler);
            port.onMessage.removeListener(onMessage);
            port.onDisconnect.removeListener(onDisconnect);
        };
        const abortHandler = () => {
            cleanup();
            reject(new Error("REQUEST_ABORTED"));
        };
        const onDisconnect = () => {
            cleanup();
            reject(new Error("CHATGPT_PORT_DISCONNECTED"));
        };
        const onMessage = (message) => {
            if (message?.type !== "PECO_CHATGPT_GENERATE_RESULT" || message.requestId !== requestId) return;
            cleanup();
            if (!message.ok) {
                reject(new Error(message.error || "CHATGPT_EMPTY_RESPONSE"));
                return;
            }
            resolve(message.text);
        };

        signal.addEventListener("abort", abortHandler, { once: true });
        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
        try {
            port.postMessage({
                type: "PECO_CHATGPT_GENERATE",
                prompt,
                requestId,
            });
        } catch (error) {
            cleanup();
            reject(new Error(`CHATGPT_PORT_SEND_FAILED: ${error.message}`));
        }
    });
}

export async function callChatGpt(prompt, payload, signal, requestId) {
    const tab = await getReadyProviderTab({
        provider: "CHATGPT",
        urls: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
        contentScript: "content/chatgpt.js",
        statusMessage: { type: "PECO_CHATGPT_PING" },
        isReady: (status) => status.composerFound,
    });
    const text = await sendPrompt(tab.id, prompt, signal, requestId);

    if (payload.type === "essay") {
        if (!text.trim()) throw new Error("CHATGPT_EMPTY_ESSAY_ANSWER");
        return { answer: text.trim(), wasRetried: false };
    }
    if (payload.type === "multiple_answers") {
        const correctAnswerIds = extractCorrectIds(text, payload.options);
        if (!correctAnswerIds.length) throw new Error("CHATGPT_FORMAT_ERROR_NO_IDS");
        return { correctAnswerIds, wasRetried: false };
    }

    const correctAnswerId = extractCorrectId(text, payload.options);
    if (!correctAnswerId) throw new Error("CHATGPT_FORMAT_ERROR_NO_ID");
    return { correctAnswerId, wasRetried: false };
}
