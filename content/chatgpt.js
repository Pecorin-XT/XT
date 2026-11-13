(function () {
    "use strict";

    if (globalThis.__pecoChatGptBridgeInstalled) return;
    globalThis.__pecoChatGptBridgeInstalled = true;

    const RESPONSE_TIMEOUT_MS = 180000;
    const RESPONSE_POLL_MS = 500;
    const STABLE_RESPONSE_MS = 3000;
    let generationQueue = Promise.resolve();
    let chatGptPort = null;

    // KEEP-ALIVE: Evita que el navegador congele los temporizadores en segundo plano
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
            console.log("[PecoXT][keepalive] Pestaña de ChatGPT protegida contra congelamiento.");
        } catch (e) { console.warn("[PecoXT][keepalive] Fallo audio:", e); }
    }
    installKeepAlive();

    function isVisible(element) {
        return Boolean(element && element.getClientRects().length);
    }

    function findComposer() {
        const selectors = [
            "#prompt-textarea",
            "#mobile-composer-prompt",
            '[data-testid="prompt-textarea"]',
            "textarea[data-mobile-composer-prompt]",
            'textarea[placeholder*="Ask" i]',
            'textarea[placeholder*="Message" i]',
            '[contenteditable="true"][role="textbox"]',
        ];
        for (const selector of selectors) {
            const element = [...document.querySelectorAll(selector)]
                .find((candidate) => isVisible(candidate) && !candidate.disabled);
            if (element) return element;
        }
        return null;
    }

    function setComposerText(composer, text) {
        composer.focus();
        if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
            const prototype = composer instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
            const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
            valueSetter?.call(composer, text);
        } else {
            composer.replaceChildren(document.createTextNode(text));
        }
        composer.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
        }));
    }

    function findSendButton() {
        const selectors = [
            'button[type="submit"]',
            'button[aria-label="Enviar"]',
            'button[aria-label="Send"]',
            "button[data-composer-submit]",
            'button[data-testid="send-button"]',
            'button[aria-label*="Enviar mensaje" i]',
            'button[aria-label*="Send prompt" i]',
            'button[aria-label*="Send message" i]',
        ];
        for (const selector of selectors) {
            const button = [...document.querySelectorAll(selector)]
                .find((candidate) => isVisible(candidate) && !candidate.disabled);
            if (button) return { button, selector };
        }
        return null;
    }

    function getAssistantResponses(promptText = "") {
        // 1. Nuevo motor DIL de ChatGPT (2024+)
        let elements = [...document.querySelectorAll('[data-dil-response]')];
        
        // 2. Fallbacks por si usan otra versión (A/B Testing)
        if (!elements.length) {
            elements = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
        }
        if (!elements.length) {
            elements = [...document.querySelectorAll('[data-assistant-markdown]')];
        }
        if (!elements.length) {
            elements = [...document.querySelectorAll('.markdown')];
        }

        const normalizedPrompt = promptText.trim();
        return elements.map(element => {
            const content = element.querySelector('[data-markdown-copy="contents"]') || element.querySelector('.markdown') || element;
            return {
                element: element,
                text: content.innerText?.trim() || ""
            };
        }).filter(entry => entry.text && entry.text !== normalizedPrompt);
    }

    function isGeneratingResponse() {
        return Boolean(
            [...document.querySelectorAll('button[data-testid="stop-button"]')].some(isVisible) ||
            [...document.querySelectorAll("[data-composer-stop-icon]")].some(isVisible) ||
            [...document.querySelectorAll("button[aria-label]")].some((button) =>
                isVisible(button) && /stop generating|stop streaming|detener generación/i.test(button.getAttribute("aria-label"))
            )
        );
    }

    function waitForResponse(previousResponses, prompt) {
        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            let lastText = "";
            let stableSince = 0;
            let pollTimer = null;

            const cleanup = () => {
                observer.disconnect();
                if (pollTimer) clearTimeout(pollTimer);
            };

            const finish = (text) => {
                cleanup();
                resolve(text);
            };

            const checkForResponse = () => {
                const responses = getAssistantResponses(prompt);
                const lastResponse = responses[responses.length - 1];
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
                    }
                }

                if (Date.now() - startedAt >= RESPONSE_TIMEOUT_MS) {
                    cleanup();
                    reject(new Error("CHATGPT_RESPONSE_TIMEOUT"));
                }
            };

            const observer = new MutationObserver(() => {
                if (pollTimer) clearTimeout(pollTimer);
                pollTimer = setTimeout(checkForResponse, 100);
            });
            observer.observe(document.body, { childList: true, characterData: true, subtree: true });

            const fallbackPoll = () => {
                checkForResponse();
                if (Date.now() - startedAt < RESPONSE_TIMEOUT_MS) {
                    pollTimer = setTimeout(fallbackPoll, 1500);
                }
            };
            fallbackPoll();
        });
    }

    async function generateAnswer(prompt) {
        const composer = findComposer();
        if (!composer) {
            throw new Error("CHATGPT_CHAT_NOT_READY: inicia sesión y abre un chat de ChatGPT.");
        }

        const previousResponses = getAssistantResponses();
        setComposerText(composer, prompt);
        await new Promise((resolve) => setTimeout(resolve, 100));

        let sendButton = null;
        for (let i = 0; i < 10; i++) {
            sendButton = findSendButton();
            if (sendButton) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        if (sendButton) {
            sendButton.button.click();
        } else {
            console.warn("[PecoXT][page:chatgpt] Boton de enviar no encontrado, usando fallback a Enter");
            composer.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter", code: "Enter", keyCode: 13, which: 13,
                bubbles: true, cancelable: true
            }));
        }

        return waitForResponse(previousResponses, prompt);
    }

    function handleGenerateRequest(message, sendResponse) {
        if (message?.type !== "PECO_CHATGPT_GENERATE") return false;
        if (typeof message.prompt !== "string" || !message.prompt.trim()) {
            sendResponse({ ok: false, error: "CHATGPT_INVALID_PROMPT" });
            return true;
        }
        const request = generationQueue.then(() => generateAnswer(message.prompt));
        // This request reports its own failure below; keep the queue usable for the next one.
        generationQueue = request.catch(() => {});
        request.then(
            (text) => sendResponse({ ok: true, text }),
            (error) => sendResponse({ ok: false, error: error.message })
        );
        return true;
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === "PECO_CHATGPT_PING") {
            sendResponse({
                ok: true,
                url: location.href,
                composerFound: Boolean(findComposer()),
            });
            return;
        }
        return handleGenerateRequest(message, sendResponse);
    });

    function connectChatGptPort() {
        if (chatGptPort) return;
        const port = chrome.runtime.connect({ name: "peco-chatgpt" });
        chatGptPort = port;
        port.onMessage.addListener((message) => {
            if (message?.type === "PECO_CHATGPT_PORT_READY") {
                return;
            }

            handleGenerateRequest(message, (response) => {
                port.postMessage({
                    type: "PECO_CHATGPT_GENERATE_RESULT",
                    requestId: message.requestId,
                    ...response,
                });
            });
        });
        port.onDisconnect.addListener(() => {
            chatGptPort = null;
        });
    }

    connectChatGptPort();
})();
