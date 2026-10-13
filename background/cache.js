const CACHE_TTL_MS = 30 * 60 * 1000;

export function getCacheKey(questionId, contentHash, provider = "gemini") {
    const providerSuffix = provider === "gemini" ? "" : `_${provider}`;
    return `cache_${questionId}_${contentHash}${providerSuffix}`;
}

export function getFromCache(key) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get([key], (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            const entry = result[key];
            if (!entry) return resolve(null);
            if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
                chrome.storage.local.remove([key]);
                return resolve(null);
            }
            resolve(entry.correctAnswerId);
        });
    });
}

export function saveToCache(key, correctAnswerIds) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(
            { [key]: { correctAnswerId: correctAnswerIds, timestamp: Date.now() } },
            () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            }
        );
    });
}
