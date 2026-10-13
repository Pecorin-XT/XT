function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
    });
}

function waitForTabLoad(tabId, provider) {
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
            reject(new Error(`${provider}_TAB_CLOSED_DURING_LOAD`));
        };

        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.onRemoved.addListener(onRemoved);
        timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`${provider}_TAB_LOAD_TIMEOUT`));
        }, 30000);
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                cleanup();
                reject(new Error(`${provider}_TAB_LOOKUP_FAILED: ${chrome.runtime.lastError.message}`));
                return;
            }
            if (tab?.status === "complete") {
                cleanup();
                resolve();
            }
        });
    });
}

function injectBridge(tabId, file, provider) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript({ target: { tabId }, files: [file] }, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(`${provider}_BRIDGE_INJECTION_FAILED: ${chrome.runtime.lastError.message}`));
                return;
            }
            resolve();
        });
    });
}

export async function getReadyProviderTab({
    provider,
    urls,
    contentScript,
    statusMessage,
    isReady,
}) {
    const tabs = await new Promise((resolve, reject) => {
        chrome.tabs.query({ url: urls }, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`${provider}_TAB_LOOKUP_FAILED: ${chrome.runtime.lastError.message}`));
                return;
            }
            resolve(result);
        });
    });
    const candidates = tabs
        .filter((tab) => tab.id != null)
        .sort((first, second) =>
            Number(second.status === "complete") - Number(first.status === "complete") ||
            Number(second.active) - Number(first.active)
        );
    if (!candidates.length) throw new Error(`${provider}_TAB_NOT_FOUND`);

    let lastError;
    for (const tab of candidates) {
        try {
            if (tab.status !== "complete") await waitForTabLoad(tab.id, provider);

            let initialStatus;
            try {
                initialStatus = await sendTabMessage(tab.id, statusMessage);
            } catch {
                initialStatus = undefined;
            }

            if (initialStatus?.ok && isReady(initialStatus)) return tab;
            if (!initialStatus?.ok) await injectBridge(tab.id, contentScript, provider);

            const deadline = Date.now() + 15000;
            let lastBridgeError;
            while (Date.now() < deadline) {
                try {
                    const status = await sendTabMessage(tab.id, statusMessage);
                    if (status?.ok) {
                        lastBridgeError = undefined;
                        if (isReady(status)) return tab;
                    }
                } catch (error) {
                    lastBridgeError = error;
                }
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
            if (lastBridgeError) throw new Error(`${provider}_BRIDGE_ERROR: ${lastBridgeError.message}`);
            throw new Error(`${provider}_CHAT_NOT_READY`);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error(`${provider}_CHAT_NOT_READY`);
}
