function findQuestionContainer(element) {
    let current = element;
    while (current && current !== document.body) {
        if (current.classList?.contains("display_question")) return current;
        current = current.parentElement;
    }
    return null;
}

function simpleHash(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
        hash = (hash << 5) - hash + value.charCodeAt(index);
        hash &= hash;
    }
    return Math.abs(hash).toString(36);
}

function findEssayAnswerEditor(container) {
    const answers = container.querySelector(".answers");
    if (!answers) return null;

    const iframe = answers.querySelector('iframe.tox-edit-area__iframe, iframe[id$="_ifr"]');
    if (iframe?.contentDocument?.body) return iframe;
    return answers.querySelector('[contenteditable="true"], textarea');
}

function extractQuestionData(container) {
    const questionEl = container.querySelector(".question_text");
    if (!questionEl) return null;

    const question = questionEl.textContent.trim();
    const questionId = container.id || `q_${Date.now()}`;
    const answerEditor = findEssayAnswerEditor(container);
    const options = [...container.querySelectorAll(
        '.answers input[type="radio"], .answers input[type="checkbox"]'
    )].map((input) => {
        const label = input.closest("label") || (input.id
            ? container.querySelector(`.answers label[for="${CSS.escape(input.id)}"]`)
            : null);
        const answer = input.closest(".answer");
        const text = label?.querySelector(".answer_label, .answer_text")?.textContent?.trim() ||
            answer?.querySelector(".answer_label, .answer_text")?.textContent?.trim() ||
            answer?.getAttribute("title")?.trim();
        return text && input.id ? { id: input.id, text, inputType: input.type } : null;
    }).filter(Boolean);

    if (!options.length) {
        const isEssay = container.classList.contains("essay_question") ||
            container.querySelector(".question_type")?.textContent.trim() === "essay_question";
        if (!isEssay || !answerEditor || !question) return null;
        return {
            questionId,
            question,
            type: "essay",
            answerEditorId: answerEditor.id,
            options: [],
            contentHash: simpleHash(`${question}:essay`),
        };
    }

    const isMultipleAnswers = options.some((option) => option.inputType === "checkbox") ||
        container.classList.contains("multiple_answers_question") ||
        container.querySelector(".question_type")?.textContent.trim() === "multiple_answers_question";
    const type = isMultipleAnswers ? "multiple_answers" : "multiple_choice";
    return {
        questionId,
        question,
        type,
        options: options.map(({ id, text }) => ({ id, text })),
        contentHash: simpleHash(`${type}:${question}:${options.map((option) => option.id + option.text).join("")}`),
    };
}

globalThis.QuizAIContent = {
    extractQuestionData,
    findEssayAnswerEditor,
    findQuestionContainer,
};
