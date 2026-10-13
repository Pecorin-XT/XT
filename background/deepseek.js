import { extractCorrectId, extractCorrectIds } from "./gemini.js";

function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`DEEPSEEK_BRIDGE_ERROR: ${chrome.runtime.lastError.message}`));
                return;
            }
            resolve(response);
        });
    });
}

function queryDeepSeekTabs() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ url: "https://chat.deepseek.com/*" }, (tabs) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`DEEPSEEK_TAB_LOOKUP_FAILED: ${chrome.runtime.lastError.message}`));
                return;
            }
            resolve(tabs);
        });
    });
}

function waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
        let timeout;
        const cleanup = () => {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            chrome.tabs.onRemoved.removeListener(onRemoved);
        };
        const onUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
            cleanup();
            resolve();
        };
        const onRemoved = (removedTabId) => {
            if (removedTabId !== tabId) return;
            cleanup();
            reject(new Error("DEEPSEEK_TAB_CLOSED_DURING_LOAD"));
        };

        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.onRemoved.addListener(onRemoved);
        timeout = setTimeout(() => {
            cleanup();
            reject(new Error("DEEPSEEK_TAB_LOAD_TIMEOUT"));
        }, 30000);
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                cleanup();
                reject(new Error(`DEEPSEEK_TAB_LOOKUP_FAILED: ${chrome.runtime.lastError.message}`));
                return;
            }
            if (tab?.status === "complete") {
                cleanup();
                resolve();
            }
        });
    });
}

async function ensureDeepSeekBridge(tabId) {
    let initialStatus;
    try {
        initialStatus = await sendTabMessage(tabId, { type: "PECO_DEEPSEEK_STATUS" });
    } catch {
        initialStatus = undefined;
    }
    if (initialStatus?.ok && initialStatus.ready) return initialStatus;
    if (!initialStatus?.ok) {
        await new Promise((resolve, reject) => {
            chrome.scripting.executeScript(
                { target: { tabId }, files: ["content/deepseek.js"] },
                () => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(`DEEPSEEK_BRIDGE_INJECTION_FAILED: ${chrome.runtime.lastError.message}`));
                        return;
                    }
                    resolve();
                }
            );
        });
    }

    const readyDeadline = Date.now() + 15000;
    let lastBridgeError;
    while (Date.now() < readyDeadline) {
        try {
            const status = await sendTabMessage(tabId, { type: "PECO_DEEPSEEK_STATUS" });
            if (status?.ok) {
                lastBridgeError = undefined;
                if (status.ready) return status;
            }
        } catch (error) {
            lastBridgeError = error;
            // The injected content script may need a moment to register its listener.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (lastBridgeError) throw lastBridgeError;
    throw new Error("DEEPSEEK_CHAT_NOT_READY: abre una conversación e inicia sesión en DeepSeek.");
}

async function getDeepSeekTab() {
    const tabs = await queryDeepSeekTabs();
    const candidates = tabs
        .filter((tab) => tab.id != null)
        .sort((first, second) =>
            Number(second.status === "complete") - Number(first.status === "complete") ||
            Number(second.active) - Number(first.active)
        );
    if (!candidates.length) throw new Error("DEEPSEEK_TAB_NOT_FOUND");

    let lastError;
    for (const tab of candidates) {
        try {
            if (tab.status !== "complete") await waitForTabLoad(tab.id);
            const status = await ensureDeepSeekBridge(tab.id);
            if (status.ready) return tab;
            lastError = new Error("DEEPSEEK_CHAT_NOT_READY: abre una conversación e inicia sesión en DeepSeek.");
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("DEEPSEEK_CHAT_NOT_READY");
}

function sendPrompt(tabId, prompt, signal) {
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
            type: "PECO_DEEPSEEK_GENERATE",
            prompt,
        }, (response) => {
            signal.removeEventListener("abort", abortHandler);
            if (chrome.runtime.lastError) {
                reject(new Error(`DEEPSEEK_BRIDGE_ERROR: ${chrome.runtime.lastError.message}`));
                return;
            }
            if (!response?.ok) {
                reject(new Error(response?.error || "DEEPSEEK_EMPTY_RESPONSE"));
                return;
            }
            resolve(response.text);
        });
    });
}

export async function callDeepSeek(prompt, payload, signal) {
    const tab = await getDeepSeekTab();
    const text = await sendPrompt(tab.id, prompt, signal);

    if (payload.type === "essay") {
        if (!text.trim()) throw new Error("DEEPSEEK_EMPTY_ESSAY_ANSWER");
        return { answer: text.trim(), wasRetried: false };
    }
    if (payload.type === "multiple_answers") {
        const correctAnswerIds = extractCorrectIds(text, payload.options);
        if (!correctAnswerIds.length) throw new Error("DEEPSEEK_FORMAT_ERROR_NO_IDS");
        return { correctAnswerIds, wasRetried: false };
    }

    const correctAnswerId = extractCorrectId(text, payload.options);
    if (!correctAnswerId) throw new Error("DEEPSEEK_FORMAT_ERROR_NO_ID");
    return { correctAnswerId, wasRetried: false };
}
