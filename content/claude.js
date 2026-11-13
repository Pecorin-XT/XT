(function () {
    "use strict";
    if (globalThis.__pecoClaudeBridgeInstalled) return;
    globalThis.__pecoClaudeBridgeInstalled = true;

    const RESPONSE_TIMEOUT_MS = 180000;
    const STABLE_RESPONSE_MS = 800;
    let generationQueue = Promise.resolve();
    let claudePort = null;

    // KEEP-ALIVE
    function installKeepAlive() {
        if (globalThis.__pecoKeepAlive) return;
        globalThis.__pecoKeepAlive = true;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.0001;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            const resume = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };
            document.addEventListener("click", resume);
            document.addEventListener("keydown", resume);
            document.addEventListener("visibilitychange", resume);
            console.log("[PecoXT][keepalive] Pestaña de Claude protegida contra congelamiento.");
        } catch (e) { console.warn("[PecoXT][keepalive] Fallo audio:", e); }
    }
    installKeepAlive();

    function isVisible(element) {
        return Boolean(element && element.getClientRects().length);
    }

    function findComposer() {
        return [...document.querySelectorAll('div[contenteditable="true"][data-testid="chat-input"]')]
            .find(isVisible) || null;
    }

    function setComposerText(composer, text) {
        composer.focus();
        // ProseMirror (Tiptap) maneja la entrada simulando un párrafo
        const p = document.createElement("p");
        p.textContent = text;
        composer.replaceChildren(p);
        composer.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
        }));
    }

    function findSendButton() {
        return [...document.querySelectorAll('button[data-testid="chat-input-send"]')]
            .find(btn => isVisible(btn) && !btn.disabled) || null;
    }

    function getAssistantResponses(promptText = "") {
        const messages = [...document.querySelectorAll('[data-testid="assistant-message"]')];
        return messages.map(el => {
            const content = el.querySelector('[data-perf-reply-text]') || el.querySelector('.standard-markdown') || el;
            return {
                element: el,
                text: content.innerText?.trim() || ""
            };
        }).filter(entry => entry.text && entry.text !== promptText.trim());
    }

    function isGeneratingResponse() {
        const streaming = document.querySelector('[data-is-streaming="true"]');
        if (streaming) return true;
        return Boolean([...document.querySelectorAll('button')].find(b => isVisible(b) && /stop/i.test(b.getAttribute('aria-label') || "")));
    }

    function waitForResponse(previousResponses, prompt) {
        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            let lastText = "";
            let stableSince = 0;
            let pollTimer = null;
            let stabilityTimer = null;

            const cleanup = () => {
                observer.disconnect();
                if (pollTimer) clearTimeout(pollTimer);
                if (stabilityTimer) clearTimeout(stabilityTimer);
            };

            const finish = (text) => {
                cleanup();
                resolve(text);
            };

            function checkForResponse() {
                const responses = getAssistantResponses(prompt);
                const lastResponse = responses[responses.length - 1];
                console.log("[PecoXT][DIAG][page:claude] Check:", { 
                    total: responses.length, 
                    isGenerating: isGeneratingResponse(),
                    lastText: lastResponse ? lastResponse.text.slice(0, 50) : null 
                });
                const isNewResponse = lastResponse &&
                    (responses.length > previousResponses.length ||
                        lastResponse.element !== previousResponses[previousResponses.length - 1]?.element ||
                        lastResponse.text !== previousResponses[previousResponses.length - 1]?.text);

                if (isNewResponse) {
                    if (lastResponse.text !== lastText) {
                        lastText = lastResponse.text;
                        stableSince = Date.now();
                    } else if (!isGeneratingResponse() && Date.now() - stableSince >= STABLE_RESPONSE_MS) {
                        finish(lastText);
                        return;
                    } else if (!isGeneratingResponse()) {
                        if (stabilityTimer) clearTimeout(stabilityTimer);
                        stabilityTimer = setTimeout(checkForResponse, Math.max(0, STABLE_RESPONSE_MS - (Date.now() - stableSince)));
                    }
                }

                if (Date.now() - startedAt >= RESPONSE_TIMEOUT_MS) {
                    cleanup();
                    reject(new Error("CLAUDE_RESPONSE_TIMEOUT"));
                }
            }

            const observer = new MutationObserver(() => {
                if (pollTimer) clearTimeout(pollTimer);
                pollTimer = setTimeout(checkForResponse, 100);
            });
            observer.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-is-streaming'] });
            pollTimer = setTimeout(checkForResponse, 500);
        });
    }

    async function generateAnswer(prompt) {
        const composer = findComposer();
        if (!composer) throw new Error("CLAUDE_CHAT_NOT_READY: inicia sesión y abre un chat de Claude.");

        const previousResponses = getAssistantResponses();
        setComposerText(composer, prompt);
        await new Promise((resolve) => setTimeout(resolve, 200));

        let sendButton = null;
        for (let i = 0; i < 10; i++) {
            sendButton = findSendButton();
            if (sendButton) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        if (sendButton) {
            sendButton.click();
        } else {
            console.warn("[PecoXT][page:claude] Boton de enviar no encontrado, usando fallback a Enter");
            composer.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter", code: "Enter", keyCode: 13, which: 13,
                bubbles: true, cancelable: true
            }));
        }

        return waitForResponse(previousResponses, prompt);
    }

    function handleGenerateRequest(message, sendResponse) {
        if (message?.type !== "PECO_CLAUDE_GENERATE") return false;
        if (typeof message.prompt !== "string" || !message.prompt.trim()) {
            sendResponse({ ok: false, error: "CLAUDE_INVALID_PROMPT" });
            return true;
        }
        const request = generationQueue.then(() => generateAnswer(message.prompt));
        generationQueue = request.catch(() => {});
        request.then(
            (text) => sendResponse({ ok: true, text }),
            (error) => sendResponse({ ok: false, error: error.message })
        );
        return true;
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === "PECO_CLAUDE_PING") {
            sendResponse({ ok: true, url: location.href, composerFound: Boolean(findComposer()) });
            return;
        }
        return handleGenerateRequest(message, sendResponse);
    });

    function connectClaudePort() {
        if (claudePort) return;
        const port = chrome.runtime.connect({ name: "peco-claude" });
        claudePort = port;
        port.onMessage.addListener((message) => {
            if (message?.type === "PECO_CLAUDE_PORT_READY") return;
            handleGenerateRequest(message, (response) => {
                port.postMessage({ type: "PECO_CLAUDE_GENERATE_RESULT", requestId: message.requestId, ...response });
            });
        });
        port.onDisconnect.addListener(() => { claudePort = null; });
    }
    connectClaudePort();
})();