import { loadSettings, saveSettings } from "./popup/settings-store.js";

const $ = (selector) => document.querySelector(selector);
const apiKeysList = $("#apiKeysList");
const responseStyleInput = $("#responseStyle");
const colorPicker = $("#highlightColor");
const colorHexInput = $("#colorHex");
const opacitySlider = $("#highlightOpacity");
const opacityValue = $("#opacityVal");
const radiusSlider = $("#highlightRadius");
const radiusValue = $("#radiusVal");
const previewRadio = $("#previewRadio");
const previewPanel = $(".preview-panel");
const previewThemeToggle = $("#previewThemeToggle");
const saveStatus = $("#settingsSaveStatus");
const addKeyButton = $("#addApiKey");
const toggleApiKeysButton = $("#toggleApiKeys");
const apiKeysLabel = $("#apiKeysLabel");
const toggleResponseStyleButton = $("#toggleResponseStyle");
const openGuideButton = $("#openGuide");
const openNoticesButton = $("#openNotices");
const noticesPanel = $("#noticesPanel");
const noticesBadge = $("#noticesBadge");
const setupStatus = $("#setupStatus");
const noticesList = $("#noticesList");
const noticesEmpty = $("#noticesEmpty");
const clearNoticesButton = $("#clearNotices");
const providerInputs = [...document.querySelectorAll('input[name="provider"]')];
let apiKeysExpanded = false;
let noticeHistory = [];
let settingsLoaded = false;
let saveTimer;
let saveQueue = Promise.resolve();
let latestSaveId = 0;
const DEFAULT_RESPONSE_STYLE =
    "Responde en español de forma clara y natural. Ve directo a lo que preguntan y añade solo el contexto útil.";

const extensionVersion = globalThis.chrome?.runtime?.getManifest?.().version;
if (extensionVersion) $("#appVersion").textContent = `v${extensionVersion}`;

function updateApiKeysLabel() {
    const action = apiKeysExpanded ? "Ocultar APIs" : "Ver APIs";
    apiKeysLabel.textContent = `${action} (${readApiKeys().length})`;
}

function updateProviderUI() {
    const provider = providerInputs.find((input) => input.checked)?.value || "gemini";
    $("#geminiKeysSection").hidden = provider !== "gemini";
    const helpMessages = {
        gemini: "Usa tus claves de API de Gemini.",
        "gemini-web": "Se activará Gemini en una pestaña normal. Si no responde, reintenta y usa Gemini API; configura su clave en la opción Gemini.",
        deepseek: "Se activará DeepSeek en una pestaña normal. Si no responde, reintenta y usa Gemini API; configura su clave en la opción Gemini.",
        chatgpt: "Se activará ChatGPT en una pestaña normal. Si no responde, reintenta y usa Gemini API; configura su clave en la opción Gemini.",
    };
    $("#providerHelp").textContent = helpMessages[provider] || helpMessages.gemini;
}

function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
        updateProviderUI();
    });
}

function describeUserNotice(notice) {
    const providers = {
        gemini: "Gemini API",
        "gemini-web": "Gemini web",
        deepseek: "DeepSeek",
        chatgpt: "ChatGPT",
        practice: "La prueba guiada",
    };
    const advice = {
        "missing-api-key": "Configura una clave de Gemini API desde la opción Gemini del popup.",
        "missing-provider-tab": "Abre el sitio del proveedor e inicia sesión.",
        "provider-disconnected": "Vuelve a abrir la pestaña del proveedor. El panel lateral es compatible únicamente con ChatGPT.",
        "provider-unresponsive": "Comprueba que el sitio esté abierto y vuelve a intentarlo.",
        "provider-request-failed": "Comprueba la sesión y la conexión del proveedor antes de reintentar.",
    };
    const provider = providers[notice.provider] || "El proveedor";
    return `${provider}: ${advice[notice.code] || "Revisa la configuración antes de volver a intentarlo."}`;
}

function renderNoticeHistory() {
    noticesList.replaceChildren();
    noticeHistory.slice(0, 5).forEach((notice) => {
        const item = document.createElement("li");
        item.textContent = describeUserNotice(notice);
        noticesList.append(item);
    });
    const hasHistory = noticeHistory.length > 0;
    clearNoticesButton.hidden = !hasHistory;
    noticesEmpty.hidden = hasHistory;
    noticesBadge.hidden = !hasHistory && setupStatus.dataset.state === "ready";
}

async function refreshSetupStatus() {
    setupStatus.textContent = "Comprobando el proveedor...";
    setupStatus.dataset.state = "loading";
    try {
        const status = await sendRuntimeMessage({ type: "PECO_GET_SETUP_STATUS" });
        if (status?.error) throw new Error(status.error);
        noticeHistory = status.notices || [];
        const providerLabels = {
            gemini: "Gemini API",
            "gemini-web": "Gemini web",
            deepseek: "DeepSeek",
            chatgpt: "ChatGPT",
        };
        const selected = status.checks?.[status.provider];
        setupStatus.textContent = selected
            ? `${providerLabels[status.provider]}: ${selected.detail}${selected.ready ? ". Comprueba que la sesión siga iniciada." : "."}`
            : "No se pudo determinar la configuración del proveedor.";
        setupStatus.dataset.state = selected?.ready ? "ready" : "warning";
        noticesBadge.hidden = Boolean(selected?.ready && !noticeHistory.length);
        renderNoticeHistory();
    } catch (error) {
        console.warn("[ PecoXT ] No se pudo comprobar la configuración del proveedor.");
        setupStatus.textContent = "No fue posible comprobar el estado. Abre la guía para revisar la configuración.";
        setupStatus.dataset.state = "error";
        noticesBadge.hidden = false;
        noticesHistoryFallback();
    }
}

function noticesHistoryFallback() {
    noticesList.replaceChildren();
    noticeHistory.slice(0, 5).forEach((notice) => {
        const item = document.createElement("li");
        item.textContent = describeUserNotice(notice);
        noticesList.append(item);
    });
    clearNoticesButton.hidden = noticeHistory.length === 0;
    noticesEmpty.hidden = noticeHistory.length > 0;
}

function renderApiKeys(keys) {
    apiKeysList.replaceChildren();
    keys.forEach((key, index) => {
        const row = document.createElement("div");
        row.className = "api-key-row";

        const input = document.createElement("input");
        input.type = "password";
        input.className = "api-key-input";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.placeholder = `Clave API ${index + 1}`;
        input.value = key;
        input.setAttribute("aria-label", `Clave API ${index + 1}`);

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "icon-button";
        toggle.dataset.action = "toggle";
        toggle.title = "Mostrar u ocultar clave";
        toggle.setAttribute("aria-label", toggle.title);
        toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>';

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-button danger-button";
        remove.dataset.action = "remove";
        remove.title = "Quitar clave";
        remove.setAttribute("aria-label", remove.title);
        remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

        row.append(input, toggle, remove);
        apiKeysList.append(row);
    });
    apiKeysList.hidden = !apiKeysExpanded;
    toggleApiKeysButton.setAttribute("aria-expanded", String(apiKeysExpanded));
    updateApiKeysLabel();
}

function readApiKeys() {
    return [...apiKeysList.querySelectorAll(".api-key-input")]
        .map((input) => input.value.trim())
        .filter(Boolean);
}

function hexToRgba(hex, alpha) {
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function updatePreview() {
    const radius = Number(radiusSlider.value);
    const opacity = Number(opacitySlider.value);
    const rgba = hexToRgba(colorHexInput.value || colorPicker.value, opacity);
    opacityValue.textContent = `${Math.round(opacity * 100)}%`;
    radiusValue.textContent = `${radius}px`;
    previewRadio.style.borderRadius = `${radius}px`;
    previewRadio.style.boxShadow = `0 0 0 3px var(--preview-surface), 0 0 0 6px ${rgba}`;
    $(".preview-check").style.backgroundColor = rgba;
}

function getSettings() {
    return {
        highlightColor: colorPicker.value,
        highlightOpacity: Number(opacitySlider.value),
        highlightRadius: Number(radiusSlider.value),
        provider: providerInputs.find((input) => input.checked)?.value || "gemini",
        responseStyle: responseStyleInput.value.trim() || DEFAULT_RESPONSE_STYLE,
    };
}

function scheduleSave(delay = 400) {
    if (!settingsLoaded) return;
    clearTimeout(saveTimer);
    saveStatus.textContent = "Cambios sin guardar";
    saveTimer = setTimeout(() => {
        const saveId = ++latestSaveId;
        const settings = getSettings();
        const apiKeys = readApiKeys();
        saveStatus.textContent = "Guardando...";
        // A failed save updates the UI below; allow the next settings save to run.
        saveQueue = saveQueue.catch(() => {}).then(async () => {
            await saveSettings(settings, apiKeys);
            if (saveId === latestSaveId) saveStatus.textContent = "";
        }).catch((error) => {
            console.warn("[ PecoXT ] No se pudo guardar la configuración.");
            if (saveId === latestSaveId) saveStatus.textContent = "Error al guardar los cambios";
        });
    }, delay);
}

colorPicker.addEventListener("input", () => {
    colorHexInput.value = colorPicker.value.toUpperCase();
    updatePreview();
    scheduleSave();
});
colorPicker.addEventListener("change", () => scheduleSave(0));
colorHexInput.addEventListener("input", () => {
    if (/^#[0-9a-fA-F]{6}$/.test(colorHexInput.value)) {
        colorPicker.value = colorHexInput.value;
        updatePreview();
        scheduleSave();
    }
});
colorHexInput.addEventListener("change", () => {
    if (/^#[0-9a-fA-F]{6}$/.test(colorHexInput.value)) scheduleSave(0);
});
opacitySlider.addEventListener("input", () => {
    updatePreview();
    scheduleSave();
});
opacitySlider.addEventListener("change", () => scheduleSave(0));
radiusSlider.addEventListener("input", () => {
    updatePreview();
    scheduleSave();
});
radiusSlider.addEventListener("change", () => scheduleSave(0));
previewThemeToggle.addEventListener("click", () => {
    const isLight = previewPanel.dataset.theme !== "light";
    previewPanel.dataset.theme = isLight ? "light" : "dark";
    previewThemeToggle.setAttribute("aria-pressed", String(isLight));
    const action = `Cambiar a modo ${isLight ? "oscuro" : "claro"}`;
    previewThemeToggle.setAttribute("aria-label", action);
    previewThemeToggle.title = action;
});
providerInputs.forEach((input) => input.addEventListener("change", () => {
    updateProviderUI();
    scheduleSave(0);
    if (!noticesPanel.hidden) refreshSetupStatus();
}));
responseStyleInput.addEventListener("input", () => scheduleSave());
responseStyleInput.addEventListener("change", () => scheduleSave(0));
updateProviderUI();

openGuideButton.addEventListener("click", () => {
    try {
        chrome.tabs.create({ url: chrome.runtime.getURL("guide.html") }, () => {
            if (chrome.runtime.lastError) {
                console.warn("[ PecoXT ] No se pudo abrir la guía.");
                saveStatus.textContent = "No se pudo abrir la guía";
            }
        });
    } catch (error) {
        console.warn("[ PecoXT ] No se pudo abrir la guía.");
        saveStatus.textContent = "No se pudo abrir la guía";
    }
});

openNoticesButton.addEventListener("click", () => {
    noticesPanel.hidden = !noticesPanel.hidden;
    openNoticesButton.setAttribute("aria-expanded", String(!noticesPanel.hidden));
    if (!noticesPanel.hidden) refreshSetupStatus();
});

clearNoticesButton.addEventListener("click", async () => {
    try {
        await sendRuntimeMessage({ type: "PECO_CLEAR_USER_NOTICES" });
        noticeHistory = [];
        renderNoticeHistory();
    } catch (error) {
        console.warn("[ PecoXT ] No se pudieron limpiar los avisos.");
        setupStatus.textContent = "No se pudieron limpiar los avisos.";
        setupStatus.dataset.state = "error";
    }
});

addKeyButton.addEventListener("click", () => {
    apiKeysExpanded = true;
    renderApiKeys([...readApiKeys(), ""]);
    apiKeysList.lastElementChild?.querySelector("input").focus();
});

toggleApiKeysButton.addEventListener("click", () => {
    apiKeysExpanded = !apiKeysExpanded;
    apiKeysList.hidden = !apiKeysExpanded;
    toggleApiKeysButton.setAttribute("aria-expanded", String(apiKeysExpanded));
    updateApiKeysLabel();
});

toggleResponseStyleButton.addEventListener("click", () => {
    const expanded = toggleResponseStyleButton.getAttribute("aria-expanded") !== "true";
    toggleResponseStyleButton.setAttribute("aria-expanded", String(expanded));
    $("#responseStylePanel").hidden = !expanded;
});

apiKeysList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const row = button.closest(".api-key-row");
    if (button.dataset.action === "toggle") {
        const input = row.querySelector("input");
        input.type = input.type === "password" ? "text" : "password";
        button.title = input.type === "password" ? "Mostrar clave" : "Ocultar clave";
    } else {
        row.remove();
        updateApiKeysLabel();
        scheduleSave(0);
    }
});

apiKeysList.addEventListener("input", () => {
    updateApiKeysLabel();
    scheduleSave();
});
apiKeysList.addEventListener("change", () => scheduleSave(0));

try {
    const { settings, apiKeys } = await loadSettings();
    renderApiKeys(apiKeys.length ? apiKeys : [""]);
    colorPicker.value = settings.highlightColor;
    colorHexInput.value = settings.highlightColor.toUpperCase();
    opacitySlider.value = settings.highlightOpacity;
    radiusSlider.value = settings.highlightRadius;
    responseStyleInput.value = settings.responseStyle;
    providerInputs.forEach((input) => {
        input.checked = input.value === settings.provider;
    });
    updateProviderUI();
    updatePreview();
    settingsLoaded = true;
    refreshSetupStatus();
} catch (error) {
    console.warn("[ PecoXT ] No se pudo cargar la configuración.");
}
