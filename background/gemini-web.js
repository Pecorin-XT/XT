import { extractCorrectId, extractCorrectIds } from "./gemini.js";
import { getReadyProviderTab } from "./provider-bridge.js";

function sendPromptToTab(tabId, prompt, signal, requestId) {
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
            type: "PECO_GEMINI_WEB_GENERATE",
            prompt,
            requestId,
        }, (response) => {
            signal.removeEventListener("abort", abortHandler);
            if (chrome.runtime.lastError) {
                reject(new Error(`GEMINI_WEB_BRIDGE_ERROR: ${chrome.runtime.lastError.message}`));
                return;
            }
            if (!response?.ok) {
                reject(new Error(response?.error || "GEMINI_WEB_EMPTY_RESPONSE"));
                return;
            }
            resolve(response.text);
        });
    });
}

export async function callGeminiWeb(prompt, payload, signal, requestId) {
    const tab = await getReadyProviderTab({
        provider: "GEMINI_WEB",
        urls: ["https://gemini.google.com/*", "https://bard.google.com/*"],
        contentScript: "content/gemini-web.js",
        statusMessage: { type: "PECO_GEMINI_WEB_STATUS" },
        isReady: (status) => status.ready,
    });
    const text = await sendPromptToTab(tab.id, prompt, signal, requestId);

    if (payload.type === "essay") {
        if (!text.trim()) throw new Error("GEMINI_WEB_EMPTY_ESSAY_ANSWER");
        return { answer: text.trim(), wasRetried: false };
    }
    if (payload.type === "multiple_answers") {
        const correctAnswerIds = extractCorrectIds(text, payload.options);
        if (!correctAnswerIds.length) throw new Error("GEMINI_WEB_FORMAT_ERROR_NO_IDS");
        return { correctAnswerIds, wasRetried: false };
    }

    const correctAnswerId = extractCorrectId(text, payload.options);
    if (!correctAnswerId) throw new Error("GEMINI_WEB_FORMAT_ERROR_NO_ID");
    return { correctAnswerId, wasRetried: false };
}
