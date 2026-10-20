const practiceQuestions = [
    {
        type: "multiple_choice",
        typeLabel: "Selección única · 1 de 2",
        question: "Una prueba médica detecta una enfermedad presente en el 1% de la población. Tiene una sensibilidad del 99% y una especificidad del 95%. Si una persona obtiene un resultado positivo, ¿cuál es aproximadamente la probabilidad de que realmente tenga la enfermedad?",
        options: [
            { id: "A", text: "99%" },
            { id: "B", text: "95%" },
            { id: "C", text: "16,7%" },
            { id: "D", text: "1%" },
        ],
        expected: ["C"],
        explanation: "Por cada 10 000 personas, unas 100 están enfermas y 99 darán positivo. De las 9 900 sanas, el 5% (495) dará un falso positivo. Entre los positivos, la proporción real es 99 / (99 + 495) ≈ 16,7%.",
    },
    {
        type: "multiple_choice",
        typeLabel: "Selección única · 2 de 2",
        question: "Una inversión crece a una tasa efectiva continua del 8% anual. Aproximadamente, ¿cuánto tarda en duplicarse, suponiendo que la tasa se mantiene constante?",
        options: [
            { id: "A", text: "6,25 años" },
            { id: "B", text: "8,66 años" },
            { id: "C", text: "12,5 años" },
            { id: "D", text: "17,33 años" },
        ],
        expected: ["B"],
        explanation: "Con capitalización continua, el factor de crecimiento es e^(0,08t). Al igualarlo a 2, resulta t = ln(2) / 0,08 ≈ 8,66 años.",
    },
    {
        type: "multiple_answers",
        typeLabel: "Selección múltiple · 1 de 2",
        question: "Una transformación lineal T lleva un espacio vectorial real de dimensión 5 a otro de dimensión 3 y tiene rango 2. ¿Cuáles afirmaciones deben ser verdaderas?",
        options: [
            { id: "A", text: "La dimensión del núcleo de T es 3." },
            { id: "B", text: "T es sobreyectiva." },
            { id: "C", text: "T no puede ser inyectiva." },
            { id: "D", text: "La imagen de T tiene dimensión 2." },
        ],
        expected: ["A", "C", "D"],
        explanation: "Por rango-nulidad, dim(ker T) = 5 − 2 = 3. El rango es menor que la dimensión del codominio, así que no es sobreyectiva. Como el núcleo no es trivial, no es inyectiva. La imagen tiene dimensión igual al rango: 2.",
    },
    {
        type: "multiple_answers",
        typeLabel: "Selección múltiple · 2 de 2",
        question: "Sean X e Y bits independientes y uniformes, y define Z = X XOR Y (XOR vale 1 cuando los bits son distintos). ¿Cuáles afirmaciones son verdaderas?",
        options: [
            { id: "A", text: "Cada par entre X, Y y Z es independiente." },
            { id: "B", text: "X, Y y Z son mutuamente independientes." },
            { id: "C", text: "P(X=1, Y=1, Z=1) = 0." },
            { id: "D", text: "P(Z=1) = 1/2." },
        ],
        expected: ["A", "C", "D"],
        explanation: "XOR de dos bits uniformes también es uniforme. Cada par es independiente, y X=Y=1 obliga a Z=0. Sin embargo, Z queda determinado por X e Y, por lo que los tres no son mutuamente independientes.",
    },
    {
        type: "essay",
        typeLabel: "Desarrollo · 1 de 2",
        question: "Una ciudad observa que los barrios con más patrullajes también reportan más delitos. Un concejal concluye que los patrullajes causan delitos y propone eliminarlos. Explica por qué esa conclusión no se deduce de la correlación y propone un análisis más sólido para estimar el efecto de los patrullajes.",
        criteria: "Una buena respuesta distingue correlación de causalidad, considera causalidad inversa y factores de confusión (por ejemplo, patrullajes asignados a zonas de mayor riesgo), y propone una comparación que controle esos factores, idealmente con asignación aleatoria o un diseño cuasiexperimental creíble.",
    },
    {
        type: "essay",
        typeLabel: "Desarrollo · 2 de 2",
        question: "Un refrigerador doméstico enfría su interior, pero libera calor por la parte trasera y consume electricidad. Explica cómo esto es compatible con la segunda ley de la termodinámica y qué papel cumple el trabajo eléctrico en el proceso.",
        criteria: "La respuesta debe explicar que el refrigerador transfiere calor desde una zona fría a otra más caliente usando trabajo externo; no destruye energía y aumenta la entropía total del sistema más entorno. Conviene diferenciar extraer calor del interior de expulsar calor al ambiente.",
    },
];

const questionList = document.querySelector("#practiceQuestions");
const practiceStatus = document.querySelector("#practiceStatus");
const practiceForm = document.querySelector("#practiceForm");
const validationResults = document.querySelector("#validationResults");
let practiceRequestInProgress = false;
const previousAnswers = new Map();
const providerNames = {
    gemini: "Gemini API",
    "gemini-web": "Gemini web",
    deepseek: "DeepSeek",
    chatgpt: "ChatGPT",
};

function appendText(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
}

function setPracticeStatus(message, state = "") {
    practiceStatus.textContent = message;
    practiceStatus.dataset.state = state;
}

function explainRequestError(code) {
    const messages = {
        "missing-api-key": "Agrega una clave de Gemini API desde el popup antes de probar.",
        "missing-provider-tab": "Abre la pestaña del proveedor seleccionado e inicia sesión.",
        "provider-disconnected": "El proveedor se desconectó. Vuelve a abrir su pestaña o panel e inténtalo otra vez.",
        "provider-unresponsive": "El proveedor no respondió a tiempo. Comprueba que siga abierto e inténtalo de nuevo.",
        "provider-request-failed": "No se pudo completar la consulta. Comprueba el proveedor y su sesión.",
    };
    return messages[code] || "No se pudo completar la prueba. Abre los avisos del popup para ver qué revisar.";
}

function makeQuestionCard(question, index) {
    const card = document.createElement("section");
    card.id = `question_${index + 1}`;
    card.className = `display_question ${question.type}_question practice-card`;
    card.dataset.questionIndex = String(index);
    appendText(card, "div", "question_number", `Pregunta ${index + 1} · ${question.typeLabel}`);
    appendText(card, "div", "question_text", question.question);

    const answers = document.createElement("div");
    answers.className = "answers";
    if (question.options) {
        question.options.forEach((option, optionIndex) => {
            const answer = document.createElement("div");
            answer.className = "answer";
            const inputId = `${card.id}_answer_${optionIndex + 1}`;
            const label = document.createElement("label");
            label.htmlFor = inputId;
            const input = document.createElement("input");
            input.id = inputId;
            input.name = card.id;
            input.type = question.type === "multiple_choice" ? "radio" : "checkbox";
            input.dataset.referenceId = option.id;
            input.addEventListener("change", () => {
                if (input.checked) {
                    label.classList.remove("quiz-ai-highlight-radio", "quiz-ai-checkbox-dot");
                }
            });
            appendText(label, "span", "answer_label", `${option.id}. ${option.text}`);
            label.prepend(input);
            answer.append(label);
            answers.append(answer);
        });
    } else {
        const textarea = document.createElement("textarea");
        textarea.id = `${card.id}_answer`;
        textarea.name = textarea.id;
        textarea.setAttribute("aria-label", "Borrador de respuesta");
        textarea.placeholder = "Escribe tu propia respuesta o usa Ctrl + clic en el enunciado para pedir un borrador.";
        answers.append(textarea);
    }
    card.append(answers);

    if (question.type === "essay") {
        const actions = document.createElement("div");
        actions.className = "practice-actions";
        const referenceButton = document.createElement("button");
        referenceButton.type = "button";
        referenceButton.className = "practice-expected-toggle";
        referenceButton.textContent = "Ver referencia";
        referenceButton.setAttribute("aria-expanded", "false");
        const reference = document.createElement("div");
        reference.className = "practice-reference";
        reference.hidden = true;
        appendText(reference, "p", "", question.criteria);
        referenceButton.addEventListener("click", () => {
            reference.hidden = !reference.hidden;
            referenceButton.setAttribute("aria-expanded", String(!reference.hidden));
            referenceButton.textContent = reference.hidden ? "Ver referencia" : "Ocultar referencia";
        });
        actions.append(referenceButton);
        card.append(actions, reference);
    }

    const response = document.createElement("div");
    response.className = "practice-response";
    response.hidden = true;
    response.setAttribute("role", "status");
    card.append(response);
    return card;
}

function extractPracticeQuestion(card) {
    const question = card.querySelector(".question_text")?.textContent.trim();
    if (!question) return null;
    const options = [...card.querySelectorAll('.answers input[type="radio"], .answers input[type="checkbox"]')]
        .map((input) => ({
            id: input.id,
            text: input.closest("label")?.querySelector(".answer_label")?.textContent
                .replace(/^[A-D]\.\s*/, "")
                .trim(),
        }))
        .filter((option) => option.text);

    if (!options.length) {
        const editor = card.querySelector(".answers textarea");
        if (!editor) return null;
        return { questionId: card.id, question, type: "essay", options: [], answerEditorId: editor.id };
    }
    return {
        questionId: card.id,
        question,
        type: card.classList.contains("multiple_answers_question") ? "multiple_answers" : "multiple_choice",
        options,
    };
}

function requestProvider(payload) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "PECO_RUN_PRACTICE", payload }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error("provider-request-failed"));
                return;
            }
            if (!response?.ok) {
                reject(new Error(response?.error || "provider-request-failed"));
                return;
            }
            resolve(response);
        });
    });
}

function applyPracticeHighlight(card, answerIds) {
    card.querySelectorAll(".answer label").forEach((label) => {
        const input = label.querySelector("input");
        const highlighted = answerIds.includes(input?.id);
        if (input?.type === "radio") {
            label.classList.toggle("quiz-ai-highlight-radio", highlighted);
        } else if (input?.type === "checkbox" && !input.checked) {
            label.classList.toggle("quiz-ai-checkbox-dot", highlighted);
        }
    });
}

function renderAnswer(question, card, payload, result) {
    const responseBox = card.querySelector(".practice-response");
    responseBox.replaceChildren();
    responseBox.hidden = false;
    const providerLabel = providerNames[result.provider] || result.provider;
    appendText(responseBox, "p", "response-label", `Respuesta de ${providerLabel}`);
    if (question.type === "essay") {
        const editor = card.querySelector(".answers textarea");
        editor.value = editor.value.trim()
            ? `${editor.value.trim()}\n${result.answer}`
            : result.answer;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        editor.dispatchEvent(new Event("change", { bubbles: true }));
        editor.focus();
        appendText(responseBox, "p", "response-review", "Borrador insertado en el campo. Revísalo y exprésalo con tus propias palabras.");
        return;
    }

    const validIds = new Set(payload.options.map((option) => option.id));
    const answerIds = result.correctAnswerIds.filter((id) => validIds.has(id));
    if (!answerIds.length) {
        appendText(responseBox, "p", "response-review", "La IA no devolvió opciones reconocibles. Prueba Ctrl + Alt + clic para una consulta nueva.");
        return;
    }
    applyPracticeHighlight(card, answerIds);
    const answerTexts = answerIds.map((id) => {
        const option = payload.options.find((candidate) => candidate.id === id);
        return option ? option.text : id;
    });
    appendText(responseBox, "p", "response-copy", `La IA marcó ${answerTexts.join(" · ")}. No seleccionó ni calificó tu respuesta.`);
}

async function analyzePracticeQuestion(card, forceRefresh) {
    if (practiceRequestInProgress) return;
    const question = practiceQuestions[Number(card.dataset.questionIndex)];
    const payload = extractPracticeQuestion(card);
    if (!question || !payload) {
        setPracticeStatus("No se pudo leer el ejercicio de práctica.", "error");
        return;
    }

    practiceRequestInProgress = true;
    document.querySelectorAll(".question_text").forEach((element) => {
        element.setAttribute("aria-busy", "true");
    });
    setPracticeStatus(
        forceRefresh
            ? "Consulta nueva en curso; la IA intentará variar la redacción sin sacrificar la exactitud."
            : "Consultando a la IA seleccionada. Las respuestas se marcarán, pero no se seleccionarán ni calificarán.",
        "working",
    );
    try {
        const previousAnswer = previousAnswers.get(card.id);
        const result = await requestProvider({
            ...payload,
            forceRefresh,
            ...(forceRefresh && previousAnswer ? { previousAnswer } : {}),
        });
        renderAnswer(question, card, payload, result);
        previousAnswers.set(
            card.id,
            question.type === "essay" ? result.answer : result.correctAnswerIds.join(", "),
        );
        setPracticeStatus("Respuesta recibida. Puedes resolver el ejercicio y validar las preguntas cerradas al final.", "ready");
    } catch (error) {
        const message = explainRequestError(error.message);
        const responseBox = card.querySelector(".practice-response");
        responseBox.replaceChildren();
        responseBox.hidden = false;
        appendText(responseBox, "p", "response-error", message);
        setPracticeStatus(message, "error");
    } finally {
        practiceRequestInProgress = false;
        document.querySelectorAll(".question_text").forEach((element) => {
            element.removeAttribute("aria-busy");
        });
    }
}

function validateAnswers() {
    const closedQuestions = practiceQuestions
        .map((question, index) => ({ question, card: document.querySelector(`#question_${index + 1}`) }))
        .filter(({ question }) => question.options);
    let correctCount = 0;
    closedQuestions.forEach(({ question, card }) => {
        const selected = [...card.querySelectorAll(".answers input:checked")]
            .map((input) => input.dataset.referenceId)
            .sort();
        const expected = [...question.expected].sort();
        const isCorrect = selected.length === expected.length &&
            selected.every((id, index) => id === expected[index]);
        card.dataset.validation = isCorrect ? "correct" : "incorrect";
        correctCount += Number(isCorrect);
        let feedback = card.querySelector(".validation-feedback");
        if (!feedback) feedback = appendText(card, "p", "validation-feedback", "");
        feedback.className = `validation-feedback ${isCorrect ? "response-match" : "response-mismatch"}`;
        feedback.textContent = isCorrect
            ? "Correcta."
            : `Aún no. Referencia: ${expected.join(", ")}.`;
    });
    validationResults.textContent = `Resultado: ${correctCount} de ${closedQuestions.length} preguntas cerradas correctas. Las preguntas abiertas no se califican; consulta su referencia.`;
    validationResults.dataset.state = correctCount === closedQuestions.length ? "ready" : "review";
    setPracticeStatus("");
}

function loadVisualSettings() {
    if (!globalThis.chrome?.storage?.sync) return;
    chrome.storage.sync.get(["highlightColor", "highlightOpacity", "highlightRadius"], (settings) => {
        if (chrome.runtime.lastError) {
            console.warn("[ PecoXT ] No se pudo cargar la vista previa de los indicadores.");
            setPracticeStatus("No se pudo cargar tu configuración visual; se muestran los valores predeterminados.", "error");
            return;
        }
        const color = /^#[\da-f]{6}$/i.test(settings.highlightColor) ? settings.highlightColor : "#3478B8";
        const opacity = Number.isFinite(Number(settings.highlightOpacity))
            ? Math.max(0, Math.min(1, Number(settings.highlightOpacity)))
            : 0.85;
        const radius = Number.isFinite(Number(settings.highlightRadius))
            ? Math.max(0, Math.min(50, Number(settings.highlightRadius)))
            : 4;
        const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
        document.documentElement.style.setProperty("--marker-color", `rgba(${channels.join(", ")}, ${opacity})`);
        document.documentElement.style.setProperty("--marker-radius", `${radius}px`);
    });
}

if (globalThis.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "sync" && ["highlightColor", "highlightOpacity", "highlightRadius"].some((key) => key in changes)) {
            loadVisualSettings();
        }
    });
}

document.addEventListener("click", (event) => {
    if (!event.ctrlKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const questionText = target?.closest(".question_text");
    const card = questionText?.closest(".display_question");
    if (!card) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void analyzePracticeQuestion(card, event.altKey);
}, true);

questionList?.addEventListener("change", (event) => {
    const card = event.target.closest(".display_question");
    if (!card) return;
    delete card.dataset.validation;
    card.querySelector(".validation-feedback")?.remove();
    validationResults.textContent = "";
    delete validationResults.dataset.state;
    setPracticeStatus("");
});

practiceForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    validateAnswers();
});

if (questionList) {
    practiceQuestions.forEach((question, index) => questionList.append(makeQuestionCard(question, index)));
    loadVisualSettings();
}
