// Content-script entry point. Feature logic lives in ./content/.
(function () {
    "use strict";

    function isContextValid() {
        return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
    }

    function loadAndApply(callback) {
        if (!isContextValid()) return;
        chrome.storage.sync.get(
            ["highlightColor", "highlightOpacity", "highlightRadius"],
            (cfg) => {
                if (chrome.runtime.lastError) {
                    console.warn("[ PecoXT ] No se pudo cargar la configuración visual; se mantiene el contenido sin cambios.");
                    return;
                }
                globalThis.QuizAIContent.injectHighlightStyles(cfg);
                callback?.(cfg);
            }
        );
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "PECO_LICENSE_NOTICE") {
            const noticeId = "peco-license-feature-notice";
            document.getElementById(noticeId)?.remove();
            const notice = document.createElement("div");
            notice.id = noticeId;
            notice.setAttribute("role", "status");
            notice.setAttribute("aria-live", "polite");
            notice.textContent = message.reason === "PREMIUM_FEATURE_REQUIRED"
                ? "Ctrl+Alt+clic es una función Completa. Abre el popup y entra en Licencias para más información."
                : message.reason === "FREE_PROVIDER_LOCKED"
                    ? "El plan gratuito está asociado a otra IA. Activa Completo para cambiar de proveedor."
                    : "El respaldo entre IAs está incluido en Completo. Reintenta con el proveedor seleccionado.";
            Object.assign(notice.style, {
                position: "fixed",
                zIndex: "2147483647",
                right: "16px",
                bottom: "16px",
                maxWidth: "360px",
                padding: "12px 16px",
                border: "1px solid #67B7E5",
                borderRadius: "10px",
                background: "#17243A",
                color: "#FFFFFF",
                boxShadow: "0 8px 28px rgba(0,0,0,.35)",
                font: "600 13px/1.45 system-ui, sans-serif",
                pointerEvents: "none",
            });
            document.documentElement.append(notice);
            setTimeout(() => notice.remove(), 6500);
        } else if (message.type === "HIGHLIGHT_ANSWER") {
            loadAndApply((cfg) => {
                globalThis.QuizAIContent.applyHighlight(
                    message.correctAnswerIds || [message.correctAnswerId],
                    message.questionId,
                    cfg
                );
            });
        } else if (message.type === "SUGGEST_ESSAY_ANSWER") {
            const requestId = message.requestId || `essay_${Date.now()}`;
            const result = globalThis.QuizAIContent.applyEssaySuggestion(
                message.questionId,
                message.answerEditorId,
                message.answer
            );
            sendResponse({ ...result, requestId });
        }
    });

    document.addEventListener("change", (event) => {
        const target = event.target;
        if (target?.type === "radio" && target.classList.contains("quiz-ai-highlight-radio")) {
            target.classList.remove("quiz-ai-highlight-radio");
        } else if (target?.type === "checkbox" && target.checked && target.id) {
            document.querySelectorAll(".quiz-ai-checkbox-dot[data-answer-id]")
                .forEach((dot) => {
                    if (dot.dataset.answerId === target.id) dot.remove();
                });
        }
    });

    document.addEventListener("click", (event) => {
        if (!event.ctrlKey || event.shiftKey || !isContextValid()) return;
        const container = globalThis.QuizAIContent.findQuestionContainer(event.target);
        if (!container) return;

        const payload = globalThis.QuizAIContent.extractQuestionData(container);
        if (!payload) return;
        payload.forceRefresh = event.altKey;
        event.preventDefault();
        event.stopPropagation();

        chrome.runtime.sendMessage({ type: "ANALYZE_QUESTION", payload }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn("[ PecoXT ] No se pudo iniciar el análisis; vuelve a intentarlo.");
            } else if (!response?.accepted) {
                console.warn("[ PecoXT ] No se pudo iniciar el análisis porque la solicitud no fue aceptada.");
            }
        });
    }, true);

    document.addEventListener("click", (event) => {
        if (!(event.ctrlKey && event.shiftKey) || !isContextValid()) return;
        const container = globalThis.QuizAIContent.findQuestionContainer(event.target);
        if (!container) return;
        const payload = globalThis.QuizAIContent.extractQuestionData(container);
        if (!payload || payload.type !== "multiple_choice") return;

        const input = event.target.closest("label")?.querySelector('input[type="radio"]');
        const answerId = input?.id || payload.options[0]?.id;
        if (!answerId) return;
        event.preventDefault();
        event.stopPropagation();
        loadAndApply((cfg) => {
            globalThis.QuizAIContent.applyHighlight([answerId], payload.questionId, cfg);
        });
    }, true);
})();
