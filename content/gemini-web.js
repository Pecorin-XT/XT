(function () {
    "use strict";

    if (globalThis.__pecoGeminiWebBridgeInstalled) return;
    globalThis.__pecoGeminiWebBridgeInstalled = true;

    const RESPONSE_TIMEOUT_MS = 180000;
    const RESPONSE_POLL_MS = 500;
    const STABLE_RESPONSE_MS = 3000;
    let generationQueue = Promise.resolve();

    function isVisible(element) {
        return Boolean(element && element.getClientRects().length);
    }

    function findComposer() {
        const selectors = [
            'rich-textarea [contenteditable="true"][role="textbox"][aria-label*="prompt for Gemini" i]',
            'rich-textarea [contenteditable="true"][role="textbox"]',
            '[contenteditable="true"][role="textbox"][aria-label*="Gemini" i]',
            'textarea[aria-label*="prompt" i]',
            '[contenteditable="true"][role="textbox"]',
        ];
        for (const selector of selectors) {
            const composer = [...document.querySelectorAll(selector)]
                .find((candidate) =>
                    isVisible(candidate) &&
                    !candidate.disabled &&
                    candidate.getAttribute("aria-disabled") !== "true"
                );
            if (composer) return composer;
        }
        return null;
    }

    function findSendButton() {
        const selectors = [
            'button[aria-label*="Send" i]',
            'button[aria-label*="Enviar" i]',
            'button[data-test-id="send-button"]',
            'button[mattooltip*="Send" i]',
            'button[mattooltip*="Enviar" i]',
            'button[type="submit"]',
        ];
        for (const selector of selectors) {
            const button = [...document.querySelectorAll(selector)]
                .find((candidate) =>
                    isVisible(candidate) &&
                    !candidate.disabled &&
                    !candidate.getAttribute("aria-disabled")
                );
            if (button) return { button, selector };
        }
        return null;
    }

    function getGeminiResponses(promptText = "") {
        const selectorGroups = [
            ["model-response"],
            ['[data-message-author-role="assistant"]'],
            [".model-response-text"],
            ["message-content"],
            ['main [role="article"]'],
        ];
        const normalizedPrompt = promptText.trim();

        for (const selectors of selectorGroups) {
            const elements = [...new Set(selectors.flatMap((selector) =>
                [...document.querySelectorAll(selector)]
            ))];
            const responses = elements
                .map((element) => {
                    const content = element.matches(".model-response-text") || element.matches("message-content")
                        ? element
                        : element.querySelector(".markdown, .model-response-text, message-content") || element;
                    const text = content.innerText?.trim() || content.textContent?.trim() || "";
                    return {
                        element,
                        source: element.tagName.toLowerCase(),
                        text,
                    };
                })
                .filter((entry) => entry.text && entry.text !== normalizedPrompt);
            if (responses.length) return responses;
        }
        return [];
    }

    function isGeneratingResponse() {
        return Boolean(
            [...document.querySelectorAll('button[aria-label]')].some((button) =>
                isVisible(button) && /stop|detener|cancel response/i.test(button.getAttribute("aria-label"))
            ) ||
            [...document.querySelectorAll("mat-icon")].some((icon) =>
                isVisible(icon) && /stop|pause/.test(icon.textContent.trim().toLowerCase())
            )
        );
    }

    function waitForResponse(previousResponses, requestId, prompt) {
        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            let lastText = "";
            let stableSince = 0;
            let sawNewResponse = false;
            let pollTimer = null;
            let stabilityTimer = null;
            const observer = new MutationObserver(() => schedulePoll(100));

            const cleanup = () => {
                observer.disconnect();
                document.removeEventListener("visibilitychange", handleVisibilityChange);
                if (pollTimer) clearTimeout(pollTimer);
                if (stabilityTimer) clearTimeout(stabilityTimer);
            };

            const finish = (text) => {
                cleanup();
                resolve(text);
            };

            function schedulePoll(delay = RESPONSE_POLL_MS) {
                if (pollTimer) clearTimeout(pollTimer);
                pollTimer = setTimeout(() => {
                    pollTimer = null;
                    checkForResponse();
                }, delay);
            }

            function handleVisibilityChange() {
                if (document.visibilityState === "visible") checkForResponse();
            }

            function checkForResponse() {
                const responses = getGeminiResponses(prompt);
                const lastResponse = responses[responses.length - 1];
                const previousResponse = previousResponses[previousResponses.length - 1];
                const isNewResponse = lastResponse && (
                    responses.length > previousResponses.length ||
                    lastResponse.element !== previousResponse?.element ||
                    lastResponse.text !== previousResponse?.text
                );

                if (isNewResponse) {
                    if (!sawNewResponse) {
                        sawNewResponse = true;
                    }
                    if (lastResponse.text !== lastText) {
                        lastText = lastResponse.text;
                        stableSince = Date.now();
                    } else if (!isGeneratingResponse() && Date.now() - stableSince >= STABLE_RESPONSE_MS) {
                        finish(lastText);
                        return;
                    } else if (!isGeneratingResponse()) {
                        if (stabilityTimer) clearTimeout(stabilityTimer);
                        stabilityTimer = setTimeout(checkForResponse, Math.max(
                            0,
                            STABLE_RESPONSE_MS - (Date.now() - stableSince)
                        ));
                    }
                }

                if (Date.now() - startedAt >= RESPONSE_TIMEOUT_MS) {
                    cleanup();
                    reject(new Error("GEMINI_WEB_RESPONSE_TIMEOUT"));
                    return;
                }
                schedulePoll();
            }

            observer.observe(document.body, {
                childList: true,
                characterData: true,
                subtree: true,
            });
            document.addEventListener("visibilitychange", handleVisibilityChange);
            schedulePoll(0);
        });
    }

    function setComposerText(composer, text) {
        composer.focus();
        composer.replaceChildren(document.createElement("p"));
        composer.firstElementChild.textContent = text;
        composer.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
        }));
    }

    async function generateAnswer(prompt, requestId) {
        const composer = findComposer();
        if (!composer) throw new Error("GEMINI_WEB_COMPOSER_NOT_FOUND");
        const previousResponses = getGeminiResponses();
        setComposerText(composer, prompt);
        await new Promise((resolve) => setTimeout(resolve, 150));

        const sendButton = findSendButton();
        if (!sendButton) throw new Error("GEMINI_WEB_SEND_BUTTON_NOT_FOUND");
        sendButton.button.click();
        return waitForResponse(previousResponses, requestId, prompt);
    }

    function handleGenerate(message, respond) {
        if (message?.type !== "PECO_GEMINI_WEB_GENERATE") return false;
        const requestId = message.requestId || `gemini_web_${Date.now()}`;
        if (typeof message.prompt !== "string" || !message.prompt.trim()) {
            respond({ ok: false, error: "GEMINI_WEB_INVALID_PROMPT" });
            return true;
        }

        const request = generationQueue.then(() => generateAnswer(message.prompt, requestId));
        // This request reports its own failure below; keep the queue usable for the next one.
        generationQueue = request.catch(() => {});
        request.then(
            (text) => respond({ ok: true, text }),
            (error) => respond({ ok: false, error: error.message })
        );
        return true;
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === "PECO_GEMINI_WEB_STATUS") {
            sendResponse({ ok: true, ready: Boolean(findComposer()) });
            return;
        }
        return handleGenerate(message, sendResponse);
    });

})();
