(function () {
    "use strict";

    if (globalThis.__pecoDeepSeekBridgeInstalled) return;
    globalThis.__pecoDeepSeekBridgeInstalled = true;

    const RESPONSE_TIMEOUT_MS = 120000;
    const RESPONSE_POLL_MS = 500;
    const STABLE_RESPONSE_MS = 2500;
    let generationQueue = Promise.resolve();

    function isVisible(element) {
        return Boolean(element && element.getClientRects().length);
    }

    function findComposer() {
        const selectors = [
            '[contenteditable="true"][role="textbox"]',
            'textarea[placeholder*="message" i]',
            'textarea[placeholder*="deepseek" i]',
            'textarea[placeholder*="消息"]',
            '[contenteditable="true"]',
        ];
        for (const selector of selectors) {
            const element = [...document.querySelectorAll(selector)]
                .find((candidate) => isVisible(candidate) && !candidate.disabled);
            if (element) return element;
        }

        return [...document.querySelectorAll("textarea")]
            .find((candidate) => isVisible(candidate) && !candidate.disabled &&
                !candidate.closest('form[action*="login" i]') &&
                !candidate.getAttribute("autocomplete")?.includes("username")) || null;
    }

    function setComposerText(composer, text) {
        composer.focus();
        if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
            const prototype = composer instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
            const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
            valueSetter?.call(composer, text);
            composer.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: text,
            }));
            return;
        }

        composer.replaceChildren(document.createTextNode(text));
        composer.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
        }));
    }

    function findSendButton(composer) {
        const sendButtonSelector = [
            'button[aria-label*="send" i]',
            'button[title*="send" i]',
            'button[aria-label*="发送"]',
            'button[title*="发送"]',
        ].join(",");
        const labeledButton = [...document.querySelectorAll(sendButtonSelector)]
            .find((button) => isVisible(button) && !button.disabled);
        if (labeledButton) return labeledButton;

        const form = composer.closest("form");
        if (form) {
            const formButtons = [...form.querySelectorAll("button")]
                .filter((button) => isVisible(button) && !button.disabled);
            if (formButtons.length) return formButtons[formButtons.length - 1];
        }

        let parent = composer.parentElement;
        for (let depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) {
            const buttons = [...parent.querySelectorAll("button")]
                .filter((button) => isVisible(button) && !button.disabled);
            if (buttons.length && buttons.length < 6) return buttons[buttons.length - 1];
        }
        return null;
    }

    function getAssistantResponses() {
        const selectors = [
            '[data-message-author-role="assistant"]',
            ".ds-markdown",
            '[class*="assistant"] [class*="markdown"]',
        ];
        const elements = [...new Set(selectors.flatMap((selector) =>
            [...document.querySelectorAll(selector)]
        ))];
        return elements
            .filter((element) => !elements.some((other) => other !== element && other.contains(element)))
            .map((element) => ({ element, text: element.innerText?.trim() || "" }))
            .filter((entry) => entry.text);
    }

    function waitForResponse(previousResponses, prompt) {
        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
            let lastText = "";
            let stableSince = 0;
            const poll = () => {
                const responses = getAssistantResponses().filter((response) =>
                    response.text.replace(/\s+/g, " ").trim() !== normalizedPrompt
                );
                const lastResponse = responses[responses.length - 1];
                const isNewResponse = lastResponse &&
                    (responses.length > previousResponses.length ||
                        lastResponse.text !== previousResponses[previousResponses.length - 1]);

                if (isNewResponse) {
                    if (lastResponse.text !== lastText) {
                        lastText = lastResponse.text;
                        stableSince = Date.now();
                    } else if (Date.now() - stableSince >= STABLE_RESPONSE_MS) {
                        resolve(lastText);
                        return;
                    }
                }

                if (Date.now() - startedAt >= RESPONSE_TIMEOUT_MS) {
                    reject(new Error("DEEPSEEK_RESPONSE_TIMEOUT"));
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
            throw new Error("DEEPSEEK_CHAT_NOT_READY: inicia sesión y abre una conversación de DeepSeek.");
        }

        const previousResponses = getAssistantResponses().map((response) => response.text);
        setComposerText(composer, prompt);
        await new Promise((resolve) => setTimeout(resolve, 100));

        const sendButton = findSendButton(composer);
        if (sendButton) {
            sendButton.click();
        } else {
            composer.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                bubbles: true,
                cancelable: true,
            }));
        }

        return waitForResponse(previousResponses, prompt);
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === "PECO_DEEPSEEK_STATUS") {
            sendResponse({ ok: true, ready: Boolean(findComposer()) });
            return;
        }
        if (message?.type !== "PECO_DEEPSEEK_GENERATE") return;
        if (typeof message.prompt !== "string" || !message.prompt.trim()) {
            sendResponse({ ok: false, error: "DEEPSEEK_INVALID_PROMPT" });
            return;
        }
        const request = generationQueue.then(() => generateAnswer(message.prompt));
        // This request reports its own failure below; keep the queue usable for the next one.
        generationQueue = request.catch(() => {});
        request.then(
            (text) => sendResponse({ ok: true, text }),
            (error) => sendResponse({ ok: false, error: error.message })
        );
        return true;
    });
})();
