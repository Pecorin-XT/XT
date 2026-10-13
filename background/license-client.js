const LICENSE_API_BASE_URL = "https://pecorin-xt.onrender.com";
const LICENSE_STORAGE_KEYS = ["pecoLicenseKey", "pecoLicenseDeviceId", "pecoLicenseStatus"];
const LICENSE_STATUS_CACHE_MS = 6 * 60 * 60 * 1000;
const LICENSE_OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;
const LICENSE_STATUS_CACHE_VERSION = 2;

function storageGet(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(result);
        });
    });
}

function storageSet(values) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(values, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

function storageRemove(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.remove(keys, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

async function getLicenseApiBaseUrl() {
    if (LICENSE_API_BASE_URL) return LICENSE_API_BASE_URL;

    const { pecoLicenseApiBaseUrl } = await storageGet(["pecoLicenseApiBaseUrl"]);
    if (!pecoLicenseApiBaseUrl) throw new Error("LICENSE_SERVER_NOT_CONFIGURED");
    let url;
    try {
        url = new URL(pecoLicenseApiBaseUrl);
    } catch {
        throw new Error("INVALID_LOCAL_LICENSE_SERVER_URL");
    }
    if (
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash
    ) {
        throw new Error("INVALID_LOCAL_LICENSE_SERVER_URL");
    }
    return url.origin;
}

async function getDeviceId() {
    const { pecoLicenseDeviceId } = await storageGet(["pecoLicenseDeviceId"]);
    if (pecoLicenseDeviceId) return pecoLicenseDeviceId;
    const deviceId = crypto.randomUUID();
    await storageSet({ pecoLicenseDeviceId: deviceId });
    return deviceId;
}

async function callLicenseApi(path, body) {
    let response;
    try {
        const baseUrl = await getLicenseApiBaseUrl();
        response = await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(8000),
        });
    } catch (error) {
        throw new Error(`LICENSE_SERVER_UNAVAILABLE: ${error.message}`);
    }
    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error("LICENSE_SERVER_INVALID_RESPONSE");
    }
    if (!response.ok) throw new Error(result.error || `LICENSE_REQUEST_FAILED_${response.status}`);
    return result;
}

export async function activateLicense(licenseKey) {
    const normalizedKey = licenseKey.trim();
    const deviceId = await getDeviceId();
    const status = await callLicenseApi("/v1/licenses/activate", {
        licenseKey: normalizedKey,
        deviceId,
    });
    await storageSet({
        pecoLicenseKey: normalizedKey,
        pecoLicenseStatus: {
            ...status,
            cacheVersion: LICENSE_STATUS_CACHE_VERSION,
            checkedAt: Date.now(),
        },
    });
    return status;
}

export async function validateLicense() {
    const { pecoLicenseKey, pecoLicenseStatus } = await storageGet([
        "pecoLicenseKey",
        "pecoLicenseStatus",
    ]);
    if (!pecoLicenseKey) return { active: false, plan: "free" };
    const checkedAt = Number(pecoLicenseStatus?.checkedAt) || 0;
    const cacheAge = Date.now() - checkedAt;
    if (
        pecoLicenseStatus?.active &&
        pecoLicenseStatus.cacheVersion === LICENSE_STATUS_CACHE_VERSION &&
        cacheAge >= 0 &&
        cacheAge < LICENSE_STATUS_CACHE_MS
    ) {
        return pecoLicenseStatus;
    }
    const deviceId = await getDeviceId();
    try {
        const status = await callLicenseApi("/v1/licenses/validate", {
            licenseKey: pecoLicenseKey,
            deviceId,
        });
        await storageSet({
            pecoLicenseStatus: {
                ...status,
                cacheVersion: LICENSE_STATUS_CACHE_VERSION,
                checkedAt: Date.now(),
            },
        });
        return status;
    } catch (error) {
        if (
            error.message.startsWith("LICENSE_SERVER_UNAVAILABLE") &&
            pecoLicenseStatus?.active &&
            cacheAge >= 0 &&
            cacheAge < LICENSE_OFFLINE_GRACE_MS
        ) {
            return pecoLicenseStatus;
        }
        throw error;
    }
}

export async function deactivateLicense() {
    const { pecoLicenseKey } = await storageGet(["pecoLicenseKey"]);
    if (!pecoLicenseKey) return { active: false, plan: "free" };
    const deviceId = await getDeviceId();
    await callLicenseApi("/v1/licenses/deactivate", {
        licenseKey: pecoLicenseKey,
        deviceId,
    });
    await storageRemove(LICENSE_STORAGE_KEYS);
    return { active: false, plan: "free" };
}

export async function setLocalLicenseApiUrl(value) {
    if (LICENSE_API_BASE_URL) throw new Error("LOCAL_LICENSE_SERVER_DISABLED_IN_PRODUCTION");

    const normalizedValue = value.trim().replace(/\/+$/, "");
    if (normalizedValue) {
        let url;
        try {
            url = new URL(normalizedValue);
        } catch {
            throw new Error("INVALID_LOCAL_LICENSE_SERVER_URL");
        }
        if (
            url.protocol !== "http:" ||
            !["localhost", "127.0.0.1"].includes(url.hostname) ||
            url.username || url.password || url.pathname !== "/" || url.search || url.hash
        ) {
            throw new Error("INVALID_LOCAL_LICENSE_SERVER_URL");
        }
        const { pecoLicenseKey } = await storageGet(["pecoLicenseKey"]);
        if (pecoLicenseKey) throw new Error("DEACTIVATE_LICENSE_BEFORE_SWITCHING_SERVER");
        const response = await fetch(`${url.origin}/health`, {
            signal: AbortSignal.timeout(3000),
        });
        const health = await response.json();
        if (!response.ok || health?.ok !== true) throw new Error("LOCAL_LICENSE_SERVER_HEALTH_CHECK_FAILED");
        await storageSet({ pecoLicenseApiBaseUrl: url.origin });
        return { local: true, baseUrl: url.origin };
    }

    const { pecoLicenseKey } = await storageGet(["pecoLicenseKey"]);
    if (pecoLicenseKey) throw new Error("DEACTIVATE_LICENSE_BEFORE_SWITCHING_SERVER");
    await storageRemove(["pecoLicenseApiBaseUrl"]);
    return { local: false, baseUrl: LICENSE_API_BASE_URL };
}

export async function getLicenseClientSettings() {
    if (LICENSE_API_BASE_URL) {
        return {
            local: false,
            configured: true,
            baseUrl: LICENSE_API_BASE_URL,
        };
    }

    const { pecoLicenseApiBaseUrl } = await storageGet(["pecoLicenseApiBaseUrl"]);
    return {
        local: Boolean(pecoLicenseApiBaseUrl),
        configured: Boolean(pecoLicenseApiBaseUrl || LICENSE_API_BASE_URL),
        baseUrl: pecoLicenseApiBaseUrl || LICENSE_API_BASE_URL,
    };
}
