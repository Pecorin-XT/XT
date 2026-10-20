import { callGemini, createPrompt } from "./gemini.js";
import { callGeminiWeb } from "./gemini-web.js";
import { callDeepSeek } from "./deepseek.js";
import { callChatGpt, hasChatGptConnection, registerChatGptPort } from "./chatgpt.js";
import { getCacheKey, getFromCache, saveToCache } from "./cache.js";

const DEBOUNCE_MS = 800;
const ESSAY_DRAFT_DEDUPE_MS = 15000;
const tabState = {};
const activeRequests = new Set();
const recentEssayDrafts = new Map();
const recentAnswers = new Map();
const NOTICE_STORAGE_KEY = "pecoUserNotices";
const PROVIDERS = ["gemini", "gemini-web", "deepseek", "chatgpt"];
const PRACTICE_QUESTION_TYPES = new Set(["multiple_choice", "multiple_answers", "essay"]);
const WEB_PROVIDER_URLS = {
    "gemini-web": ["https://gemini.google.com/*", "https://bard.google.com/*"],
    deepseek: ["https://chat.deepseek.com/*"],
    chatgpt: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
};
const WEB_PROVIDER_HOME_URLS = {
    "gemini-web": "https://gemini.google.com/app",
    deepseek: "https://chat.deepseek.com/",
    chatgpt: "https://chatgpt.com/",
};
const WEB_PROVIDER_ATTEMPTS = 2;
const PROVIDER_WARMUP_MS = 1800;
let providerPreparationQueue = Promise.resolve();

function getProviderName(provider) {
    return {
        gemini: "Gemini API",
        "gemini-web": "Gemini",
        deepseek: "DeepSeek",
        chatgpt: "ChatGPT",
        practice: "la IA seleccionada",
    }[provider] || "la IA seleccionada";
}

function getUserFacingError(errorMessage) {
    const noticeCode = classifyUserNotice(errorMessage);
    const messages = {
        "missing-api-key": "falta configurar una clave de Gemini API",
        "missing-provider-tab": "no se encontró una pestaña abierta de la IA seleccionada",
        "provider-disconnected": "la sesión con la IA se desconectó o no está lista",
        "provider-unresponsive": "la IA no respondió a tiempo",
        "provider-request-failed": "no se pudo completar la consulta",
    };
    return messages[noticeCode];
}

function callWebProvider(provider, prompt, payload, signal, requestId) {
    if (provider === "deepseek") return callDeepSeek(prompt, payload, signal);
    if (provider === "chatgpt") return callChatGpt(prompt, payload, signal, requestId);
    return callGeminiWeb(prompt, payload, signal, requestId);
}

function isRetryableWebProviderError(error) {
    return /TIMEOUT|BRIDGE|SEND_FAILED|PORT_DISCONNECTED|NO_ACTIVE_CONNECTION|TAB_NOT_FOUND|NOT_CONNECTED|DISCONNECTED|EMPTY_RESPONSE|EMPTY_ANSWER/i
        .test(error.message);
}

function delayWithSignal(delay, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error("REQUEST_ABORTED"));
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("REQUEST_ABORTED"));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, delay);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

async function callConfiguredProvider(provider, payload, signal, requestId, responseStyle, apiKeys = []) {
    const prompt = createPrompt(payload, responseStyle);
    if (!WEB_PROVIDER_URLS[provider]) {
        return {
            ...await callGemini(apiKeys, payload, signal, responseStyle),
            provider: "gemini",
        };
    }

    let lastError;
    for (let attempt = 0; attempt < WEB_PROVIDER_ATTEMPTS; attempt++) {
        try {
            return {
                ...await callWebProvider(provider, prompt, payload, signal, requestId),
                provider,
            };
        } catch (error) {
            if (signal.aborted || error.message === "REQUEST_ABORTED") {
                throw new Error("REQUEST_ABORTED");
            }
            if (!isRetryableWebProviderError(error)) throw error;
            lastError = error;
            if (attempt + 1 < WEB_PROVIDER_ATTEMPTS) {
                await delayWithSignal(1000, signal);
            }
        }
    }

    const fallbackApiKeys = await getConfiguredApiKeys();
    if (!fallbackApiKeys.length) {
        throw new Error(`NO_API_KEY_FALLBACK: ${lastError?.message || "WEB_PROVIDER_UNRESPONSIVE"}`);
    }
    return {
        ...await callGemini(fallbackApiKeys, payload, signal, responseStyle),
        provider: "gemini",
        wasRetried: true,
    };
}

function callbackApi(api, method, ...args) {
    return new Promise((resolve, reject) => {
        api[method](...args, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(result);
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
            reject(new Error("PROVIDER_TAB_CLOSED_DURING_WARMUP"));
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.onRemoved.addListener(onRemoved);
        timeout = setTimeout(() => {
            cleanup();
            reject(new Error("PROVIDER_TAB_LOAD_TIMEOUT"));
        }, 30000);
        callbackApi(chrome.tabs, "get", tabId).then((tab) => {
            if (tab.status === "complete") {
                cleanup();
                resolve();
            }
        }).catch((error) => {
            cleanup();
            reject(error);
        });
    });
}

function showKeepTabNotice() {
    const noticeId = "peco-keep-provider-tab-notice";
    document.getElementById(noticeId)?.remove();
    const notice = document.createElement("div");
    notice.id = noticeId;
    notice.textContent = "No cerrar esta pestaña";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    Object.assign(notice.style, {
        position: "fixed",
        zIndex: "2147483647",
        top: "16px",
        right: "16px",
        padding: "12px 18px",
        border: "1px solid #67B7E5",
        borderRadius: "10px",
        background: "#17243A",
        color: "#FFFFFF",
        boxShadow: "0 8px 28px rgba(0,0,0,.35)",
        font: "600 14px/1.4 system-ui, sans-serif",
        pointerEvents: "none",
    });
    document.documentElement.append(notice);
    setTimeout(() => notice.remove(), 6000);
}

async function focusProviderTab(tab) {
    await callbackApi(chrome.windows, "update", tab.windowId, { focused: true });
    await callbackApi(chrome.tabs, "update", tab.id, { active: true });
}

async function restoreOriginalTab(tab) {
    if (!tab?.id) return;
    try {
        await callbackApi(chrome.windows, "update", tab.windowId, { focused: true });
        await callbackApi(chrome.tabs, "update", tab.id, { active: true });
    } catch (error) {
        console.warn("[ PecoXT ] No se pudo volver automáticamente a la pestaña anterior.");
    }
}

async function prepareWebProvider(provider) {
    const urls = WEB_PROVIDER_URLS[provider];
    if (!urls) return;

    const [originalTabs, providerTabs] = await Promise.all([
        callbackApi(chrome.tabs, "query", { active: true, lastFocusedWindow: true }),
        queryTabs(urls),
    ]);
    const originalTab = originalTabs[0];
    const providerTab = providerTabs.find((tab) => tab.windowId === originalTab?.windowId) || providerTabs[0];
    let targetTab = providerTab;

    try {
        if (!targetTab) {
            targetTab = await callbackApi(chrome.tabs, "create", {
                url: WEB_PROVIDER_HOME_URLS[provider],
                active: true,
                ...(originalTab?.windowId == null ? {} : { windowId: originalTab.windowId }),
            });
        }

        await focusProviderTab(targetTab);
        if (targetTab.status !== "complete") await waitForTabLoad(targetTab.id);
        await new Promise((resolve) => setTimeout(resolve, PROVIDER_WARMUP_MS));
        await callbackApi(chrome.scripting, "executeScript", {
            target: { tabId: targetTab.id },
            func: showKeepTabNotice,
        });
    } catch (error) {
        console.warn(`[ PecoXT ] No se pudo preparar la pestaña de ${getProviderName(provider)}.`);
    } finally {
        await restoreOriginalTab(originalTab);
    }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes.provider || !WEB_PROVIDER_URLS[changes.provider.newValue]) return;
    const provider = changes.provider.newValue;
    providerPreparationQueue = providerPreparationQueue
        // A failed preparation is reported below, but must not block a later provider change.
        .catch(() => {})
        .then(() => prepareWebProvider(provider))
        .catch(() => console.warn(`[ PecoXT ] No se pudo activar ${getProviderName(provider)}; puedes volver a intentarlo.`));
});

function queryTabs(urls) {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ url: urls }, (tabs) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(tabs);
        });
    });
}

function classifyUserNotice(errorMessage) {
    if (errorMessage === "NO_API_KEY" || errorMessage.startsWith("NO_API_KEY_FALLBACK")) return "missing-api-key";
    if (errorMessage.includes("TAB_NOT_FOUND")) return "missing-provider-tab";
    if (
        errorMessage.includes("NOT_CONNECTED") ||
        errorMessage.includes("PORT_DISCONNECTED") ||
        errorMessage.includes("NO_ACTIVE_CONNECTION") ||
        errorMessage.includes("CHAT_NOT_READY")
    ) {
        return "provider-disconnected";
    }
    if (errorMessage.includes("TIMEOUT") || errorMessage.includes("BRIDGE")) return "provider-unresponsive";
    return "provider-request-failed";
}

function saveUserNotice(provider, errorMessage) {
    const notice = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        provider,
        code: classifyUserNotice(errorMessage),
        at: Date.now(),
    };
    chrome.storage.local.get([NOTICE_STORAGE_KEY], (stored) => {
        if (chrome.runtime.lastError) {
            console.warn("[ PecoXT ] No se pudo actualizar el historial de avisos.");
            return;
        }
        const notices = Array.isArray(stored[NOTICE_STORAGE_KEY]) ? stored[NOTICE_STORAGE_KEY] : [];
        chrome.storage.local.set({ [NOTICE_STORAGE_KEY]: [notice, ...notices].slice(0, 8) }, () => {
            if (chrome.runtime.lastError) {
                console.warn("[ PecoXT ] No se pudo guardar el aviso para mostrarlo en la extensión.");
            }
        });
    });
}

async function getSetupStatus() {
    const { provider = "gemini" } = await storageGet("sync", ["provider"]);
    const apiKeys = await getConfiguredApiKeys();
    const checks = {
        gemini: { ready: apiKeys.length > 0, detail: apiKeys.length ? "Clave configurada" : "Falta agregar una clave API" },
        "gemini-web": { ready: false, detail: "No hay una pestaña de Gemini abierta" },
        deepseek: { ready: false, detail: "No hay una pestaña de DeepSeek abierta" },
        chatgpt: { ready: false, detail: "No hay una pestaña de ChatGPT abierta" },
    };

    const [geminiTabs, deepseekTabs, chatgptTabs] = await Promise.all([
        queryTabs(["https://gemini.google.com/*", "https://bard.google.com/*"]),
        queryTabs("https://chat.deepseek.com/*"),
        queryTabs(["https://chatgpt.com/*", "https://chat.openai.com/*"]),
    ]);
    const geminiReady = geminiTabs.some((tab) => tab.status === "complete");
    const deepseekReady = deepseekTabs.some((tab) => tab.status === "complete");
    const chatgptReady = chatgptTabs.some((tab) => tab.status === "complete") || hasChatGptConnection();
    checks["gemini-web"] = {
        ready: geminiReady,
        detail: geminiReady ? "Gemini está abierto en una pestaña" : "Abre Gemini en una pestaña e inicia sesión",
    };
    checks.deepseek = {
        ready: deepseekReady,
        detail: deepseekReady ? "DeepSeek está abierto" : "Abre DeepSeek e inicia sesión",
    };
    checks.chatgpt = {
        ready: chatgptReady,
        detail: chatgptReady ? "ChatGPT está abierto" : "Abre ChatGPT e inicia sesión",
    };
    return { provider: PROVIDERS.includes(provider) ? provider : "gemini", checks };
}

async function runPracticeQuestion(payload, requestId) {
    if (
        !PRACTICE_QUESTION_TYPES.has(payload?.type) ||
        typeof payload.question !== "string" ||
        !payload.question.trim() ||
        (payload.type !== "essay" &&
            (!Array.isArray(payload.options) || payload.options.length < 2 ||
                payload.options.some((option) => typeof option?.id !== "string" || typeof option?.text !== "string")))
    ) {
        throw new Error("INVALID_PRACTICE_QUESTION");
    }
    const { provider = "gemini" } = await storageGet("sync", ["provider"]);
    const selectedProvider = PROVIDERS.includes(provider) ? provider : "gemini";
    const apiKeys = selectedProvider === "gemini" ? await getConfiguredApiKeys() : [];
    if (selectedProvider === "gemini" && !apiKeys.length) throw new Error("NO_API_KEY");
    const responseStyle = await getResponseStyle();
    const controller = new AbortController();
    const promptPayload = { ...payload, questionId: `practice_${requestId}`, contentHash: requestId };
    const result = await callConfiguredProvider(
        selectedProvider,
        promptPayload,
        controller.signal,
        requestId,
        responseStyle,
        apiKeys
    );
    const answer = result.answer || "";
    const correctAnswerIds = result.correctAnswerIds || (result.correctAnswerId ? [result.correctAnswerId] : []);
    recentAnswers.set(`practice_${payload.questionId}`, payload.type === "essay" ? answer : correctAnswerIds);
    if (recentAnswers.size > 100) recentAnswers.delete(recentAnswers.keys().next().value);
    return {
        provider: result.provider,
        answer,
        correctAnswerIds,
    };
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "update") {
        chrome.storage.local.remove([
            "pecoLicenseKey",
            "pecoLicenseDeviceId",
            "pecoLicenseStatus",
            "pecoLicenseApiBaseUrl",
            "pecoFreeProviderLock",
        ], () => {
            if (chrome.runtime.lastError) {
                console.warn("[ PecoXT ] No se pudieron limpiar datos antiguos de licencia.");
            }
        });
    }
    if (details.reason !== "install") return;
    chrome.tabs.create({ url: chrome.runtime.getURL("guide/index.html") }, () => {
        if (chrome.runtime.lastError) {
            console.warn("[ PecoXT ] No se pudo abrir automáticamente la guía de inicio.");
        }
    });
});

function getTabState(tabId) {
    if (!tabState[tabId]) {
        tabState[tabId] = {
            debounceTimers: new Map(),
            requestControllers: new Map(),
        };
    }
    return tabState[tabId];
}

function setIcon(tabId, status) {
    const states = {
        idle: { title: "Quiz AI Analyzer", text: "", color: "#666666" },
        loading: { title: "Analizando...", text: "...", color: "#3B82F6" },
        success: { title: "Análisis completado", text: "✓", color: "#3478B8" },
        recovered: { title: "Análisis completado con una clave/modelo alternativo", text: "✓", color: "#F5C542" },
        error: { title: "Error en el análisis", text: "✗", color: "#E97968" },
    };
    const state = states[status] || states.idle;
    chrome.action.setTitle({ tabId, title: state.title });
    chrome.action.setBadgeText({ tabId, text: state.text });
    chrome.action.setBadgeBackgroundColor({ tabId, color: state.color });
}

function getEssayDraftKey(tabId, payload, provider) {
    return `${provider}_${tabId}_${payload.questionId}_${payload.contentHash || ""}`;
}

function sendEssaySuggestion(tabId, payload, answer, requestId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, {
            type: "SUGGEST_ESSAY_ANSWER",
            answer,
            answerEditorId: payload.answerEditorId,
            questionId: payload.questionId,
            requestId,
        }, (response) => {
            if (chrome.runtime.lastError) {
                const error = new Error(`ESSAY_DELIVERY_FAILED: ${chrome.runtime.lastError.message}`);
                reject(error);
                return;
            }
            if (!response?.ok) {
                reject(new Error(response?.error || "ESSAY_INSERTION_FAILED"));
                return;
            }
            resolve(response);
        });
    });
}

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

async function getConfiguredApiKeys() {
    const { apiKeys = [] } = await storageGet("local", ["apiKeys"]);
    const configuredKeys = Array.isArray(apiKeys)
        ? apiKeys.filter((key) => typeof key === "string" && key.trim()).map((key) => key.trim())
        : [];
    if (configuredKeys.length) return configuredKeys;

    const { apiKey } = await storageGet("sync", ["apiKey"]);
    return apiKey?.trim() ? [apiKey.trim()] : [];
}

async function getResponseStyle() {
    const { responseStyle } = await storageGet("sync", ["responseStyle"]);
    const previousDefault =
        "Responde en español, de forma muy breve y clara, en una o dos frases. Da la idea principal y una justificación corta solo si la pregunta la solicita.";
    if (!responseStyle?.trim() || responseStyle.trim() === previousDefault) {
        return "Responde en español de forma clara y natural. Ve directo a lo que preguntan y añade solo el contexto útil.";
    }
    return responseStyle.trim();
}

async function processQuestion(tabId, payload) {
    const requestKey = `${tabId}_${payload.questionId}`;
    if (activeRequests.has(requestKey)) return;

    const requestId = `${requestKey}_${Date.now()}`;
    const state = getTabState(tabId);
    activeRequests.add(requestKey);
    const abortController = new AbortController();
    let provider = "gemini";
    state.requestControllers.set(requestKey, abortController);
    setIcon(tabId, "loading");

    try {
        const { provider: savedProvider } = await storageGet("sync", ["provider"]);
        provider = PROVIDERS.includes(savedProvider) ? savedProvider : "gemini";
        console.info(`[ PecoXT ] IA activa: ${getProviderName(provider)}. Iniciando análisis.`);
        const essayDraftKey = payload.type === "essay"
            ? getEssayDraftKey(tabId, payload, provider)
            : null;
        if (essayDraftKey && !payload.forceRefresh) {
            const recentDraft = recentEssayDrafts.get(essayDraftKey);
            if (recentDraft && Date.now() - recentDraft.timestamp < ESSAY_DRAFT_DEDUPE_MS) {
                await sendEssaySuggestion(tabId, payload, recentDraft.answer, requestId);
                console.info("[ PecoXT ] Borrador reciente reutilizado; no fue necesario consultar de nuevo.");
                setIcon(tabId, "success");
                return;
            }
            recentEssayDrafts.delete(essayDraftKey);
        }

        const apiKeys = provider === "gemini" ? await getConfiguredApiKeys() : [];
        if (provider === "gemini" && !apiKeys.length) throw new Error("NO_API_KEY");
        const cacheKey = getCacheKey(payload.questionId, payload.contentHash, provider);
        let previousAnswer = payload.forceRefresh ? recentAnswers.get(`${provider}_${requestKey}`) : null;
        if (payload.forceRefresh && previousAnswer == null && essayDraftKey) {
            previousAnswer = recentEssayDrafts.get(essayDraftKey)?.answer || null;
        }
        if (payload.forceRefresh && previousAnswer == null && payload.type !== "essay") {
            previousAnswer = await getFromCache(cacheKey);
        }
        const promptPayload = previousAnswer == null ? payload : { ...payload, previousAnswer };
        const cached = payload.type === "essay" || payload.forceRefresh
            ? null
            : await getFromCache(cacheKey);
        if (payload.forceRefresh) {
            console.info("[ PecoXT ] Actualización solicitada; se consultará de nuevo a la IA.");
        }
        if (cached) {
            chrome.tabs.sendMessage(tabId, {
                type: "HIGHLIGHT_ANSWER",
                correctAnswerIds: Array.isArray(cached) ? cached : [cached],
                questionId: payload.questionId,
            });
            console.info("[ PecoXT ] Respuesta recuperada de la caché.");
            setIcon(tabId, "success");
            return;
        }

        const responseStyle = await getResponseStyle();
        let result;
        result = await callConfiguredProvider(
            provider,
            promptPayload,
            abortController.signal,
            requestId,
            responseStyle,
            apiKeys
        );
        console.info(`[ PecoXT ] Respuesta recibida de ${getProviderName(result.provider)}.`);

        if (payload.type === "essay") {
            await sendEssaySuggestion(tabId, payload, result.answer, requestId);
            recentAnswers.set(`${provider}_${requestKey}`, result.answer);
            if (recentAnswers.size > 100) recentAnswers.delete(recentAnswers.keys().next().value);
            if (essayDraftKey) {
                recentEssayDrafts.set(essayDraftKey, {
                    answer: result.answer,
                    timestamp: Date.now(),
                });
            }
            console.info("[ PecoXT ] Borrador recibido e insertado en la respuesta.");
        } else {
            const correctAnswerIds = result.correctAnswerIds || [result.correctAnswerId];
            recentAnswers.set(`${provider}_${requestKey}`, correctAnswerIds);
            if (recentAnswers.size > 100) recentAnswers.delete(recentAnswers.keys().next().value);
            await saveToCache(cacheKey, correctAnswerIds);
            chrome.tabs.sendMessage(tabId, {
                type: "HIGHLIGHT_ANSWER",
                correctAnswerIds,
                questionId: payload.questionId,
            });
            console.info("[ PecoXT ] Respuesta recibida y aplicada a la pregunta.");
        }

        setIcon(tabId, result.wasRetried ? "recovered" : "success");
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage !== "REQUEST_ABORTED") {
            console.warn(`[ PecoXT ] Problema detectado: ${getUserFacingError(errorMessage)}.`);
        }
        if (errorMessage !== "REQUEST_ABORTED") saveUserNotice(provider, errorMessage);
        setIcon(tabId, errorMessage === "REQUEST_ABORTED" ? "idle" : "error");
    } finally {
        activeRequests.delete(requestKey);
        state.requestControllers.delete(requestKey);
        setTimeout(() => {
            if (!state.requestControllers.size) setIcon(tabId, "idle");
        }, 3000);
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "PECO_GET_SETUP_STATUS") {
        getSetupStatus().then((status) => {
            chrome.storage.local.get([NOTICE_STORAGE_KEY], (stored) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ ...status, notices: [], error: chrome.runtime.lastError.message });
                    return;
                }
                sendResponse({
                    ...status,
                    notices: Array.isArray(stored[NOTICE_STORAGE_KEY]) ? stored[NOTICE_STORAGE_KEY] : [],
                });
            });
        }).catch((error) => {
            console.warn("[ PecoXT ] No se pudo cargar el estado de configuración.");
            sendResponse({ error: error.message, notices: [] });
        });
        return true;
    }

    if (message?.type === "PECO_CLEAR_USER_NOTICES") {
        chrome.storage.local.remove([NOTICE_STORAGE_KEY], () => {
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
            }
            sendResponse({ ok: true });
        });
        return true;
    }

    if (message?.type === "PECO_RUN_PRACTICE") {
        const guideUrl = chrome.runtime.getURL("guide/index.html");
        const practiceUrl = chrome.runtime.getURL("guide/practice.html");
        const isGuidePage = sender.url === guideUrl || sender.url?.startsWith(`${guideUrl}?`) || sender.url?.startsWith(`${guideUrl}#`);
        const isPracticePage = sender.url === practiceUrl || sender.url?.startsWith(`${practiceUrl}?`) || sender.url?.startsWith(`${practiceUrl}#`);
        if (!isGuidePage && !isPracticePage) {
            sendResponse({ ok: false, error: "UNAUTHORIZED_PRACTICE_REQUEST" });
            return;
        }
        const requestId = `practice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        runPracticeQuestion(message.payload, requestId).then((result) => {
            sendResponse({ ok: true, ...result });
        }).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`[ PecoXT ] Problema detectado: ${getUserFacingError(errorMessage)}.`);
            if (!errorMessage.includes("NO_API_KEY")) saveUserNotice("practice", errorMessage);
            sendResponse({ ok: false, error: classifyUserNotice(errorMessage) });
        });
        return true;
    }

    if (message?.type !== "ANALYZE_QUESTION") return;
    const tabId = sender.tab?.id;
    if (tabId == null || !message.payload?.questionId) {
        sendResponse({ accepted: false, error: "INVALID_ANALYSIS_REQUEST" });
        return;
    }

    const requestKey = `${tabId}_${message.payload.questionId}`;
    const state = getTabState(tabId);
    const existingTimer = state.debounceTimers.get(requestKey);
    if (existingTimer) clearTimeout(existingTimer);
    const debounceTimer = setTimeout(() => {
        state.debounceTimers.delete(requestKey);
        processQuestion(tabId, message.payload);
    }, DEBOUNCE_MS);
    state.debounceTimers.set(requestKey, debounceTimer);
    sendResponse({ accepted: true });
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "peco-chatgpt") return;
    const pageUrl = port.sender?.url || "";
    if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(pageUrl)) {
        port.disconnect();
        return;
    }

    registerChatGptPort(port, port.sender?.tab?.id);
    port.postMessage({ type: "PECO_CHATGPT_PORT_READY" });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    const state = tabState[tabId];
    if (state) {
        for (const timer of state.debounceTimers.values()) clearTimeout(timer);
        for (const controller of state.requestControllers.values()) controller.abort();
        delete tabState[tabId];
    }
    for (const key of recentEssayDrafts.keys()) {
        if (key.includes(`_${tabId}_`)) recentEssayDrafts.delete(key);
    }
});
