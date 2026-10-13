(function () {
    "use strict";

    if (globalThis.__pecoChatGptBridgeInstalled) return;
    globalThis.__pecoChatGptBridgeInstalled = true;

    const RESPONSE_TIMEOUT_MS = 180000;
    const RESPONSE_POLL_MS = 500;
    const STABLE_RESPONSE_MS = 3000;
    let generationQueue = Promise.resolve();
    let chatGptPort = null;

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
            "button[data-composer-submit]",
            'button[data-testid="send-button"]',
            'button[aria-label="Enviar mensaje"]',
            'button[aria-label="Send prompt"]',
            'button[aria-label="Send message"]',
            'button[aria-label="Send"]',
        ];
        for (const selector of selectors) {
            const button = [...document.querySelectorAll(selector)]
                .find((candidate) => isVisible(candidate) && !candidate.disabled);
            if (button) return { button, selector };
        }
        return null;
    }

    function getAssistantResponses(promptText = "") {
        const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
        const assistantMessages = messages
            .map((element) => {
                const content = element.querySelector(".markdown") || element;
                return {
                    element,
                    source: content === element ? "assistant-message" : ".markdown",
                    text: content.innerText?.trim() || "",
                };
            })
            .filter((entry) => entry.text);

        if (assistantMessages.length) return assistantMessages;

        const assistantMarkdown = [...document.querySelectorAll("[data-assistant-markdown]")]
            .map((element) => ({
                element,
                source: "data-assistant-markdown",
                text: element.innerText?.trim() || "",
            }))
            .filter((entry) => entry.text && entry.text !== promptText.trim());

        if (assistantMarkdown.length) return assistantMarkdown;

        const turnSelectors = [
            'main [data-testid^="conversation-turn-"]',
            '[data-testid^="conversation-turn-"]',
            'main [role="article"]',
        ];
        const turns = [...new Set(turnSelectors.flatMap((selector) =>
            [...document.querySelectorAll(selector)]
        ))];
        const normalizedPrompt = promptText.trim();
        return turns
            .map((element) => ({
                element,
                source: element.getAttribute("data-testid") || "conversation-turn",
                text: (element.querySelector(".markdown") || element).innerText?.trim() || "",
            }))
            .filter((entry) => entry.text && entry.text !== normalizedPrompt);
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

            const poll = () => {
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
                        resolve(lastText);
                        return;
                    }
                }

                if (Date.now() - startedAt >= RESPONSE_TIMEOUT_MS) {
                    reject(new Error("CHATGPT_RESPONSE_TIMEOUT"));
                    return;
                }
                setTimeout(poll, RESPONSE_POLL_MS);
            };
            setTimeout(poll, RESPONSE_POLL_MS);
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

        const sendButton = findSendButton();
        if (!sendButton) {
            throw new Error("CHATGPT_SEND_BUTTON_NOT_READY");
        }
        sendButton.button.click();

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
