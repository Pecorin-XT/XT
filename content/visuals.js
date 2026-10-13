function hexToRgba(hex, alpha) {
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    return `rgba(${red},${green},${blue},${alpha})`;
}

function injectHighlightStyles(cfg) {
    document.getElementById("quiz-ai-styles")?.remove();
    const color = hexToRgba(
        cfg.highlightColor || "#3478B8",
        cfg.highlightOpacity !== undefined ? cfg.highlightOpacity : 0.85
    );
    const radius = cfg.highlightRadius !== undefined ? cfg.highlightRadius : 4;
    const style = document.createElement("style");
    style.id = "quiz-ai-styles";
    style.textContent = `
        .quiz-ai-highlight-radio {
            position: relative !important;
            outline: none !important;
            box-shadow: none !important;
        }
        .quiz-ai-highlight-radio:focus,
        .quiz-ai-highlight-radio:focus-visible,
        .quiz-ai-highlight-radio:active {
            outline: none !important;
            box-shadow: none !important;
        }
        .quiz-ai-checkbox-dot {
            position: absolute !important;
            z-index: 2147483647 !important;
            width: 6px !important;
            height: 6px !important;
            border-radius: 50% !important;
            transform: translate(-50%, -50%) !important;
            pointer-events: none !important;
        }
        .quiz-ai-highlight-radio::after {
            content: "" !important;
            position: absolute !important;
            inset: -6px !important;
            border: 3px solid ${color} !important;
            border-radius: ${radius}px !important;
            pointer-events: none !important;
            box-sizing: border-box !important;
            display: block !important;
            animation: quizAiFadeIn 0.2s ease-out forwards;
        }
        @keyframes quizAiFadeIn {
            from { opacity: 0; transform: scale(0.8); }
            to { opacity: 1; transform: scale(1); }
        }
    `;
    document.head.appendChild(style);
}

function clearPreviousHighlights() {
    document.querySelectorAll(".quiz-ai-highlight-radio")
        .forEach((element) => element.classList.remove("quiz-ai-highlight-radio"));
    document.querySelectorAll(".quiz-ai-checkbox-dot").forEach((element) => element.remove());
}

function applyHighlight(answerIds, questionId, cfg) {
    const container = document.getElementById(questionId);
    if (!container) return;

    clearPreviousHighlights();
    const color = hexToRgba(
        cfg.highlightColor || "#3478B8",
        cfg.highlightOpacity !== undefined ? cfg.highlightOpacity : 0.85
    );
    answerIds.forEach((answerId) => {
        const input = container.querySelector(`#${CSS.escape(answerId)}`);
        if (!input) return;
        if (input.type === "checkbox") {
            if (input.checked) return;
            const rect = input.getBoundingClientRect();
            const dot = document.createElement("span");
            dot.className = "quiz-ai-checkbox-dot";
            dot.dataset.answerId = answerId;
            dot.style.backgroundColor = color;
            dot.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
            dot.style.top = `${rect.top + window.scrollY + rect.height / 2}px`;
            document.body.append(dot);
        } else if (input.type === "radio") {
            input.classList.add("quiz-ai-highlight-radio");
        }
    });
}

globalThis.QuizAIContent.applyHighlight = applyHighlight;
globalThis.QuizAIContent.clearPreviousHighlights = clearPreviousHighlights;
globalThis.QuizAIContent.injectHighlightStyles = injectHighlightStyles;
