const version = globalThis.chrome?.runtime?.getManifest?.().version;
document.querySelector("#extensionVersion").textContent = version
    ? `Versión de la extensión: ${version}`
    : "Versión de desarrollo";