function applyEssaySuggestion(questionId, editorId, answer) {
    const container = document.getElementById(questionId);
    if (!container) return { ok: false, error: "QUESTION_CONTAINER_NOT_FOUND" };
    if (!answer) return { ok: false, error: "EMPTY_ANSWER" };

    const editor = globalThis.QuizAIContent.findEssayAnswerEditor(container);
    if (!editor || (editorId && editor.id !== editorId)) {
        return {
            ok: false,
            error: "ESSAY_EDITOR_NOT_FOUND",
            foundEditorId: editor?.id || null,
        };
    }

    const doc = editor.tagName === "IFRAME" ? editor.contentDocument : document;
    const body = editor.tagName === "IFRAME" ? doc?.body : editor;
    if (!body) {
        return { ok: false, error: "ESSAY_EDITOR_BODY_NOT_READY" };
    }

    const existingText = body.innerText?.trim() || body.value?.trim() || "";
    if (editor.tagName === "TEXTAREA") {
        editor.value = existingText ? `${editor.value.trim()}\n${answer}` : answer;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        editor.dispatchEvent(new Event("change", { bubbles: true }));
        editor.focus();
        return { ok: true, editorTag: editor.tagName, editorId: editor.id || null };
    }

    const paragraph = doc.createElement("p");
    paragraph.textContent = answer;
    if (existingText) body.append(paragraph);
    else body.replaceChildren(paragraph);

    const InputEventConstructor = doc.defaultView?.InputEvent;
    const EventConstructor = doc.defaultView?.Event || Event;
    const inputEvent = InputEventConstructor
        ? new InputEventConstructor("input", {
            bubbles: true,
            inputType: "insertText",
            data: answer,
        })
        : new EventConstructor("input", { bubbles: true });
    body.dispatchEvent(inputEvent);
    body.dispatchEvent(new EventConstructor("change", { bubbles: true }));
    body.focus();
    return { ok: true, editorTag: editor.tagName, editorId: editor.id || null };
}

globalThis.QuizAIContent.applyEssaySuggestion = applyEssaySuggestion;
