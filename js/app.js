let selectedChapters = [];
let selectedQuestions = [];
let showAnswers = false;
let logoData = '';
let selectedQuestionsData = {};
let editedQuestions = {};
let customQuestions = {}; // key => { type, text, marks, options, answer, imageData }
let customQuestionCounter = 0;
let _editImageData = ''; // temporary base64 image data for edit modal

// Default blank line shown whenever a question's text ("question" field) is empty,
// so the printed paper still has a writing line for the student instead of nothing.
const DEFAULT_BLANK_LINE = '_'.repeat(77);

const QUESTION_TYPE_OPTIONS = [
    { value: 'mcq', label: 'Multiple Choice Questions' },
    { value: 'tick', label: 'Tick the Correct Answers' },
    { value: 'fillblanks', label: 'Fill in the Blanks' },
    { value: 'truefalse', label: 'True or False' },
    { value: 'matching', label: 'Match the Following' },
    { value: 'vshort', label: 'Very Short Answer Questions' },
    { value: 'short', label: 'Short Answer Questions' },
    { value: 'long', label: 'Long Answer Questions' },
    { value: 'ar', label: 'Assertion-Reason Questions' },
    { value: 'case', label: 'Case-based Questions' },
    { value: 'numericals', label: 'Numerical Questions' },
    { value: 'picturebased', label: 'Picture-based Questions' },
    { value: 'grammar', label: 'Grammar-based Questions' },
    { value: 'circleodd', label: 'Circle/Underline/Odd' },
    { value: 'rewrite', label: 'Rewrite the Sentences' },
    { value: 'miscellaneous', label: 'Miscellaneous' }
];

/** `<img>` tags stripped from the current edit field (single-question body), re-appended on save */
let _editEmbeddedImages = [];

/**
 * Pull `<img>` tags out so they are not shown as raw HTML in text fields; restored on save.
 * @returns {{ text: string, imgs: string[] }}
 */
function extractImgTagsFromHtml(html) {
    if (!html || typeof html !== 'string') return { text: '', imgs: [] };
    const imgs = [];
    const text = html.replace(/<img\b[^>]*>/gi, (m) => {
        imgs.push(m);
        return '\n';
    });
    return { text, imgs };
}

/**
 * Plain, readable text for textareas (no raw HTML tags / entities visible).
 * Preserves `[[ num || den ]]` fraction markup. Uses the DOM for reliable decoding.
 */
function htmlToPlainEditText(html) {
    if (html == null || html === '') return '';
    const str = String(html);
    const tmp = document.createElement('div');
    tmp.innerHTML = str.trim() ? str : '';
    let out = tmp.innerText || tmp.textContent || '';
    out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    out = out.replace(/\u00a0/g, ' ');
    out = out.replace(/\u2002|\u2003|\u2009/g, ' ');
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Convert editor plain text back to stored HTML (line breaks + minimal entity escaping).
 */
function plainEditToStoredQuestionHtml(plain) {
    if (plain == null || plain === '') return '';
    return String(plain)
        .replace(/\r\n/g, '\n')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

/** Re-attach `<img>` tags removed during edit (instruction or question body). */
function appendExtractedImgTags(html, imgsOrJson) {
    let imgs = imgsOrJson;
    if (!imgs) return html || '';
    if (typeof imgs === 'string') {
        try {
            imgs = JSON.parse(imgs);
        } catch (e) {
            return html || '';
        }
    }
    if (!Array.isArray(imgs) || !imgs.length) return html || '';
    const suffix = imgs.join('<br>');
    if (!html) return suffix;
    return html + '<br>' + suffix;
}

function _clearInstructionImagePreviewStrip() {
    const el = document.getElementById('edit-instruction-img-strip');
    if (el) el.remove();
}

/** Shows images stripped from grouped block instruction so paths are not the only feedback in edit mode. */
function _showInstructionImagePreviewStrip(imgsJson) {
    _clearInstructionImagePreviewStrip();
    if (!imgsJson) return;
    let imgs;
    try {
        imgs = JSON.parse(imgsJson);
    } catch (e) {
        return;
    }
    if (!Array.isArray(imgs) || !imgs.length) return;
    const ta = document.getElementById('edit-question-text');
    if (!ta || !ta.parentNode) return;
    const strip = document.createElement('div');
    strip.id = 'edit-instruction-img-strip';
    strip.style.cssText = 'margin-top:10px;padding:8px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa;';
    const cap = document.createElement('div');
    cap.textContent = 'Images in this instruction (kept when you save):';
    cap.style.cssText = 'font-size:0.85em;color:#555;margin-bottom:6px;';
    strip.appendChild(cap);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;';
    imgs.forEach(tag => {
        const m = String(tag).match(/src=["']([^"']+)["']/i);
        const src = m ? m[1] : '';
        if (!src) return;
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.style.cssText = 'max-height:100px;max-width:180px;border-radius:4px;border:1px solid #ccc;object-fit:contain;';
        row.appendChild(img);
    });
    strip.appendChild(row);
    ta.parentNode.insertBefore(strip, ta.nextSibling);
}

/** Same pipeline as preview: fractions + question images (unchanged for output). */
function formatQuestionBodyHtml(text) {
    const safe = (text || '').replace(/<img(?![^>]*class=["'][^"']*question-image)/g, '<img class="question-image"');
    return renderFractions(safe);
}

function getGroupedBlockForEdit(questionKey) {
    const info = parseQuestionKey(questionKey);
    if (info.blockIdx === undefined) return null;
    const qData = questions[info.chapter] && questions[info.chapter][info.type];
    return qData && qData[info.blockIdx];
}

/**
 * Use instruction + sub-field(s) edit UI for this key.
 * - vshort/short/long/ar/case: several items in the block, or several keys selected.
 * - fillblanks: several blanks, OR one blank row that still has a separate instruction plus body (blank/image text).
 */
function blockNeedsGroupedSubEditor(questionKey, currentType) {
    if (!questionKey || questionKey.startsWith('custom|')) return false;
    if (!['vshort', 'short', 'long', 'ar', 'case', 'fillblanks', 'grammar', 'picturebased'].includes(currentType)) return false;
    const block = getGroupedBlockForEdit(questionKey);
    if (!block) return false;
    if (currentType === 'fillblanks') {
        const items = block.items || [];
        if (items.length > 1) return true;
        if (items.length === 1) {
            const it = items[0];
            const hasInstr = !!(block.instruction && String(block.instruction).trim());
            const hasBody = !!(String(it.blank || '').trim() || String(it.image || '').trim());
            return hasInstr && hasBody;
        }
        return false;
    }
    const n = (block.items && block.items.length) || (block.questions && block.questions.length) || 0;
    return n > 1;
}

/**
 * Block-level instruction for grouped types (vshort/short/long/fillblanks/ar/case).
 * Uses `blockInstruction` when present; legacy saves used `question` on the first sub-key.
 */
function getEditedGroupedInstruction(type, chapter, blockIdx, block, questionKeys) {
    const q0 = (questionKeys && questionKeys[0]) || `${type}|${chapter}|${blockIdx}|0`;
    const ed0 = editedQuestions[q0] || {};
    if (ed0.blockInstruction !== undefined) {
        return formatQuestionBodyHtml(ed0.blockInstruction);
    }
    const subList = block.items !== undefined ? (block.items || []) : (block.questions || []);
    let multi = (questionKeys && questionKeys.length > 1) || (subList.length > 1);
    if (type === 'fillblanks' && subList.length === 1) {
        const it = subList[0];
        const hasSplit = !!(block.instruction && String(block.instruction).trim()) &&
            !!(it && (String(it.blank || '').trim() || String(it.image || '').trim()));
        if (hasSplit) multi = true;
    }
    if (multi && ed0.question !== undefined) {
        return formatQuestionBodyHtml(ed0.question);
    }
    return getEditedQuestionText(q0, block.instruction || '');
}

/**
 * Sub-line body: avoids legacy bug where first sub-key's `question` held the block instruction.
 */
function getEditedSubItemBodyHtml(key, itemDefault, isMultiBlock, isFirstItem) {
    const ed = editedQuestions[key];
    const def = itemDefault || '';
    if (!ed || ed.question === undefined) {
        return formatQuestionBodyHtml(def);
    }
    // Always use the stored edited question text — whether saved via flat save or grouped editor.
    return formatQuestionBodyHtml(ed.question);
}

function parseQuestionKey(questionKey) {
    const parts = questionKey.split('|');
    const type = parts[0];
    const chapter = parts[1];
    if (parts.length === 3) {
        return { type, chapter, idx: parseInt(parts[2], 10) };
    }
    return {
        type,
        chapter,
        blockIdx: parseInt(parts[2], 10),
        itemIdx: parseInt(parts[3], 10)
    };
}

function getOriginalQuestionText(questionKey) {
    const info = parseQuestionKey(questionKey);
    const qData = questions[info.chapter] && questions[info.chapter][info.type];
    if (!qData) return '';

    if (info.idx !== undefined) {
        const qObj = qData[info.idx];
        return (qObj && (qObj.question || qObj.instruction)) || '';
    }

    const block = qData[info.blockIdx];
    if (!block) return '';

    if (info.type === 'ar' || info.type === 'case') {
        const qArr = block.questions || [];
        return (qArr[info.itemIdx] && qArr[info.itemIdx].question) || block.instruction || '';
    }

    if (info.type === 'fillblanks') {
        const items = block.items || [];
        if (items.length === 1 && info.itemIdx === 0) {
            const it = items[0];
            const hasBody = String(it.blank || '').trim() || String(it.image || '').trim();
            if (!hasBody) return block.instruction || '';
        }
        return (items[info.itemIdx] && items[info.itemIdx].blank) || '';
    }

    if (['vshort','short','long','picturebased','grammar','circleodd', 'rewrite', 'miscellaneous', 'tick', 'truefalse'].includes(info.type)) {
        const items = block.items || [];
        return (items[info.itemIdx] && items[info.itemIdx].question) || block.instruction || '';
    }

    const qArr = block.questions || [];
    return (qArr[info.itemIdx] && qArr[info.itemIdx].question) || block.instruction || '';
}

function getEditedQuestionText(questionKey, defaultText) {
    const edited = editedQuestions[questionKey];
    const text = edited && edited.question !== undefined ? edited.question : defaultText;
    if (!text) return '';
    const safe = (text || '').replace(/<img(?![^>]*class=["'][^"']*question-image)/g, '<img class="question-image"');
    return renderFractions(safe);
}

function createPreviewActions(questionKey, questionKeys, type, chapter) {
    const actions = document.createElement('div');
    actions.className = 'question-actions';
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.flexShrink = '0';

    const createButton = (label, extraClass, cb) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.className = `action-btn ${extraClass}`;
        btn.onclick = e => { e.stopPropagation(); cb(); };
        return btn;
    };

    actions.appendChild(createButton('Edit', 'edit-btn', () => openEditModal(questionKeys[0] || questionKey, questionKeys)));
    actions.appendChild(createButton('Remove', 'remove-btn', () => removePreviewQuestion(questionKeys)));
    actions.appendChild(createButton('Replace', 'replace-btn', () => openReplaceModal(questionKeys[0] || questionKey, type, chapter)));

    return actions;
}

function appendPreviewActions(element, questionKey, questionKeys, type, chapter) {
    const actions = createPreviewActions(questionKey, questionKeys, type, chapter);
    element.appendChild(actions);
}

function openEditModal(questionKey, allKeys) {
    const modal = document.getElementById('edit-modal');
    const textarea = document.getElementById('edit-question-text');
    const keyInput = document.getElementById('edit-question-key');
    const typeInput = document.getElementById('edit-question-type');
    const optionsWrapper = document.getElementById('edit-options-wrapper');
    const matchingWrapper = document.getElementById('edit-matching-wrapper');
    const imageWrapper = document.getElementById('edit-image-wrapper');

    const keys = (allKeys && allKeys.length) ? allKeys : [questionKey];
    modal.dataset.embeddedInstructionImages = '';
    _editEmbeddedImages = [];
    _clearInstructionImagePreviewStrip();

    let currentType = null;
    let originalText = '';
    let options = [];
    let imageSrc = '';
    let useGroupedEditor = false;
    const edited = editedQuestions[questionKey] || {};

    if (questionKey.startsWith('custom|')) {
        const cq = customQuestions[questionKey];
        if (!cq) return;
        currentType = cq.type;
        originalText = cq.text || '';
        options = Array.isArray(edited.options) ? edited.options : (cq.options || []);
        if (cq.type === 'picturebased') {
            imageSrc = edited.imageData || cq.imageData || '';
        }
    } else {
        const info = parseQuestionKey(questionKey);
        currentType = info.type;
        const qData = questions[info.chapter] && questions[info.chapter][info.type];
        const groupedTypes = ['vshort', 'short', 'long', 'ar', 'case', 'fillblanks', 'grammar', 'picturebased'];
        const blockMulti = groupedTypes.includes(currentType) && blockNeedsGroupedSubEditor(questionKey, currentType);
        useGroupedEditor = keys.length > 1 || blockMulti;

        if (useGroupedEditor) {
            const block = getGroupedBlockForEdit(questionKey);
            const ed0 = editedQuestions[keys[0]] || {};
            let mainRaw = (block && block.instruction) || '';
            if (ed0.blockInstruction !== undefined) {
                // Previously saved — may already have <img> tags appended; extract cleanly.
                mainRaw = ed0.blockInstruction;
            } else if (ed0.question !== undefined) {
                mainRaw = ed0.question;
            }
            // Always extract imgs from whatever source we use so save can re-attach exactly once.
            const ext = extractImgTagsFromHtml(mainRaw);
            modal.dataset.embeddedInstructionImages = JSON.stringify(ext.imgs);
            originalText = htmlToPlainEditText(ext.text);
        } else if (currentType === 'picturebased') {
            let rawQuestion = '';
            if (info.blockIdx !== undefined) {
                const block = qData && qData[info.blockIdx];
                const items = block && (block.items || []);
                rawQuestion = (items[info.itemIdx] && items[info.itemIdx].question) || (block && block.instruction) || '';
            } else {
                const qObj = qData && qData[info.idx];
                rawQuestion = (qObj && qObj.question) || '';
            }
            imageSrc = edited.imageData || '';
            if (!imageSrc) {
                const imageMatch = rawQuestion.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
                imageSrc = imageMatch ? imageMatch[1] : '';
            }
            // Images extract karo original source se (stripped text se nahi)
            const sourceForImgs = edited.question !== undefined ? edited.question : rawQuestion;
            const extPb = extractImgTagsFromHtml(sourceForImgs);
            _editEmbeddedImages = extPb.imgs;
            // Clean text: imgs already extracted, ab strip karo display ke liye
            originalText = htmlToPlainEditText(extPb.text);
        } else {
            const savedEdit = editedQuestions[questionKey];

            if (savedEdit && savedEdit.question !== undefined) {
                // Already-saved question may have <img> tags appended by a previous save.
                // Extract them so they round-trip correctly without duplicating on next save.
                const ext = extractImgTagsFromHtml(savedEdit.question);
                _editEmbeddedImages = ext.imgs;
                originalText = htmlToPlainEditText(ext.text);
            } else {
                const rawOrig = getOriginalQuestionText(questionKey);
                const ext = extractImgTagsFromHtml(rawOrig);
                _editEmbeddedImages = ext.imgs;
                originalText = htmlToPlainEditText(ext.text);
            }
        }

        if (currentType === 'mcq' || currentType === 'matching') {
            const qObj = qData && qData[info.idx];
            options = Array.isArray(edited.options) ? edited.options : (qObj && qObj.options) || [];
        }
    }

    modal.dataset.allKeys = useGroupedEditor ? JSON.stringify(keys) : '';

    if (questionKey.startsWith('custom|')) {
        // cq.text se extract karo (original HTML source), na ki already plain-text bane originalText se
        const cq = customQuestions[questionKey];
        const rawCustomText = (cq && cq.text) || originalText;
        const extC = extractImgTagsFromHtml(rawCustomText);
        _editEmbeddedImages = extC.imgs;
        originalText = htmlToPlainEditText(extC.text);
    }

    keyInput.value = questionKey;
    typeInput.value = currentType;
    textarea.value = originalText;
    _editImageData = '';

    // ── Load existing answer into the answer field ──────────────────────────
    const answerTA = document.getElementById('edit-answer-text');
    const answerHint = document.getElementById('edit-answer-hint');
    if (answerTA) {
        let existingAnswer = '';
        if (questionKey.startsWith('custom|')) {
            const cq = customQuestions[questionKey];
            existingAnswer = (cq && cq.answer) || '';
        } else {
            const info2 = parseQuestionKey(questionKey);
            const qData2 = questions[info2.chapter] && questions[info2.chapter][info2.type];
            // Check editedQuestions first, then original data
            const edAns = editedQuestions[questionKey];
            if (edAns && edAns.answer !== undefined) {
                existingAnswer = edAns.answer;
            } else if (info2.idx !== undefined) {
                const qObj2 = qData2 && qData2[info2.idx];
                existingAnswer = (qObj2 && (qObj2.answer || qObj2.answers || qObj2.correctAnswer)) || '';
                if (Array.isArray(existingAnswer)) existingAnswer = existingAnswer.join(', ');
            } else if (info2.blockIdx !== undefined) {
                const block2 = qData2 && qData2[info2.blockIdx];
                const subList2 = block2 && (block2.items || block2.questions || []);
                const item2 = subList2 && subList2[info2.itemIdx];
                existingAnswer = (item2 && (item2.answer || item2.answers || item2.correctAnswer)) || '';
                if (Array.isArray(existingAnswer)) existingAnswer = existingAnswer.join(', ');
            }
        }
        answerTA.value = htmlToPlainEditText(existingAnswer);
        // Hide the answer textarea for MCQ (correct answer chosen via radio instead)
        const ansWrapper = document.getElementById('edit-answer-wrapper');
        if (currentType === 'mcq') {
            if (ansWrapper) ansWrapper.style.display = 'none';
        } else {
            if (ansWrapper) ansWrapper.style.display = 'block';
        }
    }

    // Update modal title and label dynamically
    const modalTitle = document.getElementById('edit-modal-title');
    const qLabel = document.getElementById('edit-question-label');
    if (['vshort', 'short', 'long', 'ar', 'case', 'fillblanks'].includes(currentType) && useGroupedEditor) {
        if (modalTitle) modalTitle.textContent = 'Edit Question';
        if (qLabel) qLabel.textContent = 'Main Instruction / Question Text';
    } else if (currentType === 'picturebased') {
        if (modalTitle) modalTitle.textContent = 'Edit Picture-Based Question';
        if (qLabel) qLabel.textContent = 'Question Text (Image shown below)';
    } else {
        if (modalTitle) modalTitle.textContent = 'Edit Question';
        if (qLabel) qLabel.textContent = 'Question Text';
    }

    optionsWrapper.style.display = 'none';
    matchingWrapper.style.display = 'none';
    imageWrapper.style.display = 'none';

    // Hide sub-items wrapper
    const subItemsWrapper = document.getElementById('edit-subitems-wrapper');
    if (subItemsWrapper) subItemsWrapper.style.display = 'none';

    if (currentType === 'mcq') {
        optionsWrapper.style.display = 'block';
        [0, 1, 2, 3].forEach(i => {
            const input = document.getElementById(`edit-q-opt-${i}`);
            if (input) input.value = htmlToPlainEditText(extractImgTagsFromHtml(options[i] || '').text);
            // Reset radio highlight
            const radio = document.getElementById(`edit-mcq-radio-${i}`);
            if (radio) radio.checked = false;
        });
        // Find and pre-select the correct answer radio
        let correctAnswerText = '';
        if (questionKey.startsWith('custom|')) {
            correctAnswerText = (customQuestions[questionKey] && customQuestions[questionKey].answer) || '';
        } else {
            const infoMcq = parseQuestionKey(questionKey);
            const edMcq = editedQuestions[questionKey];
            if (edMcq && edMcq.answer !== undefined) {
                correctAnswerText = edMcq.answer;
            } else {
                const qDataMcq = questions[infoMcq.chapter] && questions[infoMcq.chapter][infoMcq.type];
                const qObjMcq = qDataMcq && qDataMcq[infoMcq.idx];
                const rawAns = qObjMcq && (qObjMcq.answer || qObjMcq.answers || qObjMcq.correctAnswer);
                correctAnswerText = Array.isArray(rawAns) ? rawAns.join(', ') : (rawAns || '');
            }
        }
        // Try to match by option text or by option index letter (A/B/C/D or क/ख/ग/घ)
        if (correctAnswerText) {
            const hindiLetters = ['क','ख','ग','घ'];
            const alphaLetters = ['a','b','c','d'];
            const ctLower = correctAnswerText.trim().toLowerCase();
            let matched = false;
            for (let i = 0; i < 4; i++) {
                const optEl = document.getElementById(`edit-q-opt-${i}`);
                const optVal = (optEl && optEl.value) || (options[i] || '');
                const optPlain = htmlToPlainEditText(extractImgTagsFromHtml(optVal).text).toLowerCase();
                if (optPlain && optPlain === ctLower) {
                    const radio = document.getElementById(`edit-mcq-radio-${i}`);
                    if (radio) { radio.checked = true; matched = true; }
                    break;
                }
            }
            if (!matched) {
                // Try matching by label: "A", "B", "क", "ख" etc.
                for (let i = 0; i < 4; i++) {
                    if (ctLower === alphaLetters[i] ||
                        correctAnswerText.trim() === alphaLetters[i] ||
                        ctLower === `option ${alphaLetters[i]}` ||
                        ctLower === `(${alphaLetters[i]})`) {
                        const radio = document.getElementById(`edit-mcq-radio-${i}`);
                        if (radio) { radio.checked = true; matched = true; }
                        break;
                    }
                }
            }
        }
        // Update row highlight based on radio state
        _updateMcqRadioHighlights();
    } else if (currentType === 'matching') {
        matchingWrapper.style.display = 'block';
        _renderEditMatchingOptions(options);
    } else if (currentType === 'picturebased') {
        imageWrapper.style.display = 'block';
        const preview = document.getElementById('edit-img-preview');
        const placeholder = document.getElementById('edit-img-placeholder');
        const removeRow = document.getElementById('edit-img-remove-row');
        const input = document.getElementById('edit-img-input');
        if (input) input.value = '';
        if (preview) {
            preview.src = imageSrc || '';
            preview.style.display = imageSrc ? 'block' : 'none';
        }
        if (placeholder) placeholder.style.display = imageSrc ? 'none' : 'block';
        if (removeRow) removeRow.style.display = imageSrc ? 'block' : 'none';
    } else if (['vshort', 'short', 'long', 'ar', 'case', 'fillblanks'].includes(currentType) && useGroupedEditor) {
        _showInstructionImagePreviewStrip(modal.dataset.embeddedInstructionImages);
        _renderSubItemsEditor(currentType, keys);
    }

    modal.classList.add('active');
}

// ── Render sub-item textareas for grouped question editing ─────────────────
function _renderSubItemsEditor(type, allKeys) {
    let wrapper = document.getElementById('edit-subitems-wrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'edit-subitems-wrapper';
        const mainTextarea = document.getElementById('edit-question-text');
        mainTextarea.parentNode.insertBefore(wrapper, mainTextarea.nextSibling);
    }
    wrapper.style.display = 'block';
    wrapper.textContent = '';

    const outer = document.createElement('div');
    outer.style.cssText = 'margin-top:14px;border-top:1px solid #e0e0e0;padding-top:12px;';
    const secLabel = document.createElement('label');
    secLabel.textContent = type === 'fillblanks' ? 'Sub-questions / Options' : 'Sub-questions / Options';
    secLabel.style.cssText = 'font-weight:600;display:block;margin-bottom:10px;color:#2c3e50;';
    outer.appendChild(secLabel);

    const multi = allKeys.length > 1 || blockNeedsGroupedSubEditor(allKeys[0], type);
    const ed0 = editedQuestions[allKeys[0]] || {};

    allKeys.forEach((key, idx) => {
        const info = parseQuestionKey(key);
        const qData = questions[info.chapter] && questions[info.chapter][info.type];
        let rawText = '';

        if (info.blockIdx !== undefined) {
            const block = qData && qData[info.blockIdx];
            if (type === 'fillblanks') {
                const items = block && (block.items || []);
                const item = items[info.itemIdx];
                rawText = (item && item.blank) || '';
                // item.image (<img> tag) ko plain text mein convert mat karo
                // woh itemImage dataset se preserve hoga
            } else if (type === 'ar' || type === 'case') {
                const qArr = block && (block.questions || []);
                rawText = (qArr && qArr[info.itemIdx] && qArr[info.itemIdx].question) || '';
            } else {
                const items = block && (block.items || []);
                rawText = (items[info.itemIdx] && items[info.itemIdx].question) || '';
            }
        }

        
        let displayText = rawText;
        const savedEdit = editedQuestions[key];
        if (savedEdit && savedEdit.question !== undefined) {
            // Pehle sub-item (idx=0) ka bhi edited question use karo —
            // sirf tab rawText use karo jab blockInstruction nahi hai AUR question bhi nahi hai
            // (purana legacy case tha jab instruction aur question same field mein tha)
            if (multi && idx === 0 && ed0.blockInstruction === undefined && savedEdit.question === ed0.question) {
                displayText = rawText;
            } else {
                displayText = savedEdit.question;
            }
        }

        const ext = extractImgTagsFromHtml(displayText);
        const plain = htmlToPlainEditText(ext.text);

        const row = document.createElement('div');
        row.style.marginBottom = '12px';
        /* const lab = document.createElement('div');
        lab.style.cssText = 'font-weight:600;margin-bottom:4px;color:#3498db;';
        lab.textContent = hindiLabel(idx); */
        const ta = document.createElement('textarea');
        ta.id = `edit-subitem-${idx}`;
        ta.dataset.key = key;
        ta.value = plain;
        ta.style.cssText = 'width:100%;min-height:60px;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;resize:vertical;font-size:0.95em;';
        if (ext.imgs.length) {
            ta.dataset.embeddedImages = JSON.stringify(ext.imgs);
        }
        // fillblanks: item.image preserve karo taaki save ke baad bhi dikhe
        if (type === 'fillblanks' && info.blockIdx !== undefined) {
            const blk = questions[info.chapter] && questions[info.chapter][info.type] && questions[info.chapter][info.type][info.blockIdx];
            const blkItems = blk && (blk.items || []);
            const blkItem = blkItems[info.itemIdx];
            const savedItemImg = (editedQuestions[key] && editedQuestions[key].itemImage) || '';
            const origItemImg = (blkItem && blkItem.image) || '';
            if (savedItemImg || origItemImg) {
                ta.dataset.itemImage = savedItemImg || origItemImg;
            }
        }
        /* row.appendChild(lab); */
        row.appendChild(ta);
        outer.appendChild(row);
    });

    wrapper.appendChild(outer);
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    modal.classList.remove('active');
    modal.dataset.embeddedInstructionImages = '';
    _editEmbeddedImages = [];
    _clearInstructionImagePreviewStrip();
}

/** Highlight the row whose radio is checked green, un-highlight others */
function _updateMcqRadioHighlights() {
    for (let i = 0; i < 4; i++) {
        const radio = document.getElementById(`edit-mcq-radio-${i}`);
        const input = document.getElementById(`edit-q-opt-${i}`);
        const row = input && input.closest('.edit-option-row');
        if (!row) continue;
        if (radio && radio.checked) {
            row.style.background = '#eaffea';
            row.style.borderRadius = '6px';
            row.style.outline = '2px solid #27ae60';
        } else {
            row.style.background = '';
            row.style.outline = '';
        }
    }
}

function saveEditedQuestion() {
    const keyInput = document.getElementById('edit-question-key');
    const textarea = document.getElementById('edit-question-text');
    const typeInput = document.getElementById('edit-question-type');
    const questionKey = keyInput.value;
    const questionType = typeInput.value;
    const modal = document.getElementById('edit-modal');
    const isCustom = modal.dataset.isCustom === '1';
    const allKeysRaw = modal.dataset.allKeys || '';
    const allKeys = allKeysRaw ? JSON.parse(allKeysRaw) : [];

    if (isCustom && customQuestions[questionKey]) {
        const cq = customQuestions[questionKey];
        let body = plainEditToStoredQuestionHtml(textarea.value.trim());
        body = appendExtractedImgTags(body, _editEmbeddedImages);
        cq.text = body;
        if (questionType === 'mcq') {
            cq.options = [0, 1, 2, 3].map((_, i) =>
                plainEditToStoredQuestionHtml((document.getElementById(`edit-q-opt-${i}`)?.value || '').trim())
            ).filter(Boolean);
            // Save correct answer from selected radio
            const checkedRadio = document.querySelector('input[name="edit-mcq-correct"]:checked');
            if (checkedRadio) {
                const optIdx = parseInt(checkedRadio.value);
                const optEl = document.getElementById(`edit-q-opt-${optIdx}`);
                cq.answer = (optEl && optEl.value.trim()) || '';
            }
        } else if (questionType === 'matching') {
            cq.options = _collectEditMatchingOptions();
            const ansTA = document.getElementById('edit-answer-text');
            if (ansTA) cq.answer = plainEditToStoredQuestionHtml(ansTA.value.trim());
        } else if (questionType === 'picturebased') {
            if (_editImageData) {
                cq.imageData = _editImageData;
            }
            const ansTA = document.getElementById('edit-answer-text');
            if (ansTA) cq.answer = plainEditToStoredQuestionHtml(ansTA.value.trim());
        } else {
            const ansTA = document.getElementById('edit-answer-text');
            if (ansTA) cq.answer = plainEditToStoredQuestionHtml(ansTA.value.trim());
        }
        delete modal.dataset.isCustom;
        delete modal.dataset.refreshFinal;
        delete modal.dataset.allKeys;
        closeEditModal();
        showFinalPreview();
        return;
    }

    const instrImgsJson = modal.dataset.embeddedInstructionImages || '';
    const groupedInstructionTypes = ['vshort', 'short', 'long', 'ar', 'case', 'fillblanks', 'grammar', 'picturebased'];
    const useBlockInstructionSave = allKeys.length > 0 &&
        groupedInstructionTypes.includes(questionType) &&
        (allKeys.length > 1 || blockNeedsGroupedSubEditor(questionKey, questionType));

    if (useBlockInstructionSave) {
        const mainStored = appendExtractedImgTags(
            plainEditToStoredQuestionHtml(textarea.value.trim()),
            instrImgsJson
        );
        const ansTA = document.getElementById('edit-answer-text');
        const savedBlockAnswer = ansTA ? plainEditToStoredQuestionHtml(ansTA.value.trim()) : '';
        allKeys.forEach((key, idx) => {
            const subTA = document.getElementById(`edit-subitem-${idx}`);
            const rawSub = (subTA && subTA.value) ? subTA.value.trim() : '';
            let subStored = plainEditToStoredQuestionHtml(rawSub);
            subStored = appendExtractedImgTags(subStored, subTA && subTA.dataset.embeddedImages);
            const prev = editedQuestions[key] || {};
            // fillblanks: item.image preserve karo
            const itemImageToSave = (subTA && subTA.dataset.itemImage) || prev.itemImage || '';
            if (idx === 0) {
                editedQuestions[key] = {
                    ...prev,
                    blockInstruction: mainStored,
                    question: subStored,
                    ...(savedBlockAnswer !== '' ? { answer: savedBlockAnswer } : {}),
                    ...(itemImageToSave ? { itemImage: itemImageToSave } : {})
                };
            } else {
                editedQuestions[key] = {
                    ...prev,
                    question: subStored,
                    ...(itemImageToSave ? { itemImage: itemImageToSave } : {})
                };
            }
        });
        delete modal.dataset.refreshFinal;
        delete modal.dataset.isCustom;
        delete modal.dataset.allKeys;
        closeEditModal();
        if (document.querySelector('.preview-popup.active')) {
            showFinalPreview();
        } else {
            showPreview();
        }
        return;
    }

    // Preserve previously saved fields (e.g. imageData for picturebased) so
    // they are not lost when the user edits text without re-uploading an image.
    const edited = { ...(editedQuestions[questionKey] || {}) };
    const ansTA2 = document.getElementById('edit-answer-text');
    if (questionType === 'mcq') {
        const options = [0, 1, 2, 3].map((_, i) =>
            plainEditToStoredQuestionHtml((document.getElementById(`edit-q-opt-${i}`)?.value || '').trim())
        ).filter(Boolean);
        if (options.length) edited.options = options;
        edited.question = appendExtractedImgTags(
            plainEditToStoredQuestionHtml(textarea.value.trim()),
            _editEmbeddedImages
        );
        // Save correct answer from selected radio → store as the option text
        const checkedRadio = document.querySelector('input[name="edit-mcq-correct"]:checked');
        if (checkedRadio) {
            const optIdx = parseInt(checkedRadio.value);
            const optEl = document.getElementById(`edit-q-opt-${optIdx}`);
            edited.answer = (optEl && optEl.value.trim()) || '';
        }
    } else if (questionType === 'matching') {
        edited.options = _collectEditMatchingOptions();
        edited.question = appendExtractedImgTags(
            plainEditToStoredQuestionHtml(textarea.value.trim()),
            _editEmbeddedImages
        );
        if (ansTA2) edited.answer = plainEditToStoredQuestionHtml(ansTA2.value.trim());
    } else if (questionType === 'picturebased') {
        edited.question = appendExtractedImgTags(
            plainEditToStoredQuestionHtml(textarea.value.trim()),
            _editEmbeddedImages
        );
        if (_editImageData) {
            edited.imageData = _editImageData;
        }
        if (ansTA2) edited.answer = plainEditToStoredQuestionHtml(ansTA2.value.trim());
    } else {
        edited.question = appendExtractedImgTags(
            plainEditToStoredQuestionHtml(textarea.value.trim()),
            _editEmbeddedImages
        );
        if (ansTA2) edited.answer = plainEditToStoredQuestionHtml(ansTA2.value.trim());
    }

    editedQuestions[questionKey] = edited;
    delete modal.dataset.refreshFinal;
    delete modal.dataset.isCustom;
    delete modal.dataset.allKeys;
    closeEditModal();

    if (document.querySelector('.preview-popup.active')) {
        showFinalPreview();
    } else {
        showPreview();
    }
}

function openReplaceModal(questionKey, type, chapter) {
    const modal = document.getElementById('replace-modal');
    const candidates = getReplacementCandidates(type, chapter, questionKey);

    if (!candidates.length) {
        alert('No replacement questions available for this category.');
        return;
    }

    // Build the full scrollable list — each item is a row with number, text, checkbox
    const listEl = document.getElementById('replace-list');
    listEl.innerHTML = '';

    candidates.forEach((item, idx) => {
        const isUsed = selectedQuestions.includes(item.key);

        const row = document.createElement('div');
        row.className = 'rp-row' + (isUsed ? ' rp-row--used' : '');
        row.dataset.key = item.key;

        row.innerHTML = `
            <div class="rp-row-num">${idx + 1}.</div>
            <div class="rp-row-body">
                <div class="rp-row-label">${item.label}</div>
                <div class="rp-row-text">${item.html}</div>
                ${isUsed ? '<div class="rp-row-used-tag">Already in test</div>' : ''}
            </div>
            <div class="rp-row-check">
                ${!isUsed ? `<input type="radio" name="rp-pick" class="rp-radio" value="${item.key}" title="Select this question">` : ''}
            </div>`;

        if (!isUsed) {
            // clicking anywhere on the row selects its radio
            row.onclick = () => {
                const radio = row.querySelector('.rp-radio');
                if (radio) radio.checked = true;
                document.querySelectorAll('.rp-row').forEach(r => r.classList.remove('rp-row--selected'));
                row.classList.add('rp-row--selected');
            };
        }

        listEl.appendChild(row);
    });

    // Wire up the Use Selected button
    const useBtn = document.getElementById('rp-use-btn');
    useBtn.onclick = () => {
        const picked = document.querySelector('input[name="rp-pick"]:checked');
        if (!picked) { alert('Please select a question first.'); return; }
        replacePreviewQuestion(questionKey, picked.value);
    };

    modal.dataset.currentKey = questionKey;
    modal.classList.add('active');
}

function closeReplaceModal() {
    const modal = document.getElementById('replace-modal');
    modal.classList.remove('active');
}

function replacePreviewQuestion(currentKey, replacementKey) {
    if (currentKey === replacementKey) return;
    if (selectedQuestions.includes(replacementKey)) {
        alert('That question is already in the preview.');
        return;
    }

    const index = selectedQuestions.indexOf(currentKey);
    if (index === -1) return;

    selectedQuestions[index] = replacementKey;
    if (selectedQuestionsData[currentKey] !== undefined) {
        selectedQuestionsData[replacementKey] = selectedQuestionsData[currentKey];
        delete selectedQuestionsData[currentKey];
    }
    delete editedQuestions[currentKey];
    closeReplaceModal();

    // Refresh whichever view is currently visible
    if (document.querySelector('.preview-popup.active')) {
        showFinalPreview();
    } else {
        showPreview();
    }
}

function removePreviewQuestion(questionKeys) {
    const keys = Array.isArray(questionKeys) ? questionKeys : [questionKeys];
    selectedQuestions = selectedQuestions.filter(q => !keys.includes(q));
    keys.forEach(k => {
        delete selectedQuestionsData[k];
        delete editedQuestions[k];
    });
    calculateTotalMarks();
    if (document.querySelector('.preview-popup.active')) {
        showFinalPreview();
    } else {
        showPreview();
    }
}

function getReplacementCandidates(type, chapter, currentKey) {
    const qData = questions[chapter] && questions[chapter][type];
    if (!qData) return [];
    const candidates = [];

    if ((type === 'ar' || type === 'case') && Array.isArray(qData)) {
        qData.forEach((block, blockIdx) => {
            const qArr = block.questions || [];
            if (!qArr.length) {
                const key = `${type}|${chapter}|${blockIdx}|0`;
                if (key === currentKey) return;
                candidates.push({ key, label: `Passage ${blockIdx + 1}`, html: renderFractions((block.instruction || '').replace(/<img/g, '<img class="question-image"')) });
            } else {
                qArr.forEach((qObj, idx) => {
                    const key = `${type}|${chapter}|${blockIdx}|${idx}`;
                    if (key === currentKey) return;
                    candidates.push({ key, label: `Passage ${blockIdx + 1} ${subLabel(type, idx, qArr.length)}`, html: renderFractions(((qObj.question || '') || block.instruction).replace(/<img/g, '<img class="question-image"')) });
                });
            }
        });
    } else if (type === 'fillblanks' && Array.isArray(qData)) {
        qData.forEach((block, blockIdx) => {
            const items = block.items || [];
            if (items.length === 1) {
                const key = `${type}|${chapter}|${blockIdx}|0`;
                if (key === currentKey) return;
                candidates.push({ key, label: `Blank ${blockIdx + 1}`, html: getEditedQuestionText(key, block.instruction) });
            } else {
                items.forEach((item, itemIdx) => {
                    const key = `${type}|${chapter}|${blockIdx}|${itemIdx}`;
                    if (key === currentKey) return;
                    candidates.push({ key, label: `Blank ${blockIdx + 1} ${subLabel(type, itemIdx, items.length)}`, html: getEditedQuestionText(key, item.blank || '') });
                });
            }
        });
    } else if (['vshort','short','long','picturebased','grammar','circleodd','rewrite', 'miscellaneous', 'tick', 'truefalse'].includes(type) && Array.isArray(qData)) {
        qData.forEach((block, blockIdx) => {
            (block.items || []).forEach((item, itemIdx) => {
                const key = `${type}|${chapter}|${blockIdx}|${itemIdx}`;
                if (key === currentKey) return;
                candidates.push({ key, label: `Question ${blockIdx + 1}${subLabel(type, itemIdx, (block.items || []).length)}`, html: getEditedQuestionText(key, item.question || block.instruction || '') });
            });
        });
    } else {
        (qData || []).forEach((qObj, idx) => {
            const key = `${type}|${chapter}|${idx}`;
            if (key === currentKey) return;
            candidates.push({
                key,
                label: `Question ${idx + 1}`,
                html: renderReplacementCandidateHtml(type, qObj)
            });
        });
    }

    return candidates;
}

function renderReplacementCandidateHtml(type, qObj) {
    const questionHtml = renderFractions(((qObj.question || '')).replace(/<img/g, '<img class="question-image"'));
    let html = `<div>${questionHtml}</div>`;

    if (type === 'mcq' && Array.isArray(qObj.options) && qObj.options.length) {
        const optionsHtml = qObj.options.map((opt, optIdx) =>
            `<div class="rp-choice">${subLabel('mcq', optIdx, qObj.options.length)} ${renderFractions(opt)}</div>`
        ).join('');
        html += `<div class="rp-choices"><div class="rp-choice-title">Options:</div>${optionsHtml}</div>`;
    } else if (type === 'matching' && Array.isArray(qObj.options)) {
        const pairs = qObj.options.slice(2);
        const left = pairs.filter((_, i) => i % 2 === 0);
        const right = pairs.filter((_, i) => i % 2 === 1);
        const rows = left.map((leftItem, i) =>
            `<div style="margin-left:16px;">${renderFractions(leftItem)} ⇄ ${renderFractions(right[i] || '')}</div>`
        ).join('');
        html += `<div style="margin-top:8px;">${rows}</div>`;
    } else if (type === 'truefalse') {
        /* if (qObj.options && qObj.options.length) {
            html += `<div style="margin-top:8px;margin-left:16px;">${qObj.options.map(opt => renderFractions(opt)).join(' / ')}</div>`;
        } */
    }

    return html;
}

// ── Sub-question label style ───────────────────────────────────────────────
// Controls labels for: fillblanks, vshort, short, long, ar, case sub-items.
// 'alpha' → (a) (b) (c) ...   |   'roman' → (i) (ii) (iii) ...
// MCQ, truefalse, matching are NOT touched — their format is fixed.
let subLabelStyle = {
    mcq        : 'english',   // (a)(b)(c)(d)
    fillblanks : 'english',   // (a)(b)(c)(d)
    vshort     : 'english',   // (a)(b)(c)(d)
    short      : 'english',   // (a)(b)(c)(d)
    long       : 'english',   // (a)(b)(c)(d)
    ar         : 'english',   // (a)(b)(c)(d)
    case       : 'english',   // (a)(b)(c)(d)
    grammar    : 'english',   // (A)(B)(C)(D)
    circleodd  : 'english',   // (a)(b)(c)(d)
    rewrite    : 'english'    // (a)(b)(c)(d)
};

// Main question label style: 'numeric' => 1. 2. 3.    'hindi' => क) ख) ग)
let mainLabelStyle = 'numeric';

function mainLabel(n) {
    if (mainLabelStyle === 'english') {
        const letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
        const idx = n - 1;
        return `${letters[idx] || n})`;
    }
    return `${n}.`;
}

// Initialize the page
document.getElementById('chapter-selection').style.display = 'block';
initializeChapterList();

function initializeChapterList() {
    const chapterList = document.getElementById('chapter-list');
    chapterList.innerHTML = '';
    Object.keys(questions).forEach(chapter => {
        const div = document.createElement('div');
        div.className = 'question-item';
        div.textContent = chapter;
        div.onclick = () => toggleChapter(div, chapter);
        chapterList.appendChild(div);
    });
}

function toggleChapter(element, chapter) {
    if (selectedChapters.includes(chapter)) {
        selectedChapters = selectedChapters.filter(c => c !== chapter);
        element.classList.remove('selected');
    } else {
        selectedChapters.push(chapter);
        element.classList.add('selected');
    }
    updateSelectAllButtonText();
}

function updateSelectAllButtonText() {
    const chapterItems = document.querySelectorAll('#chapter-list .question-item');
    const allSelected = [...chapterItems].every(item => item.classList.contains('selected'));
    const btn = document.getElementById('select-all-lessons-btn');
    
    if (btn) {
        btn.textContent = allSelected ? 'Deselect All' : 'Select All';
    }
}

function filterQuestions() {
    const type = document.getElementById('question-type').value;
    showQuestionsByType(type);
    updateSelectAllCategoryBtn();
}

/**
 * Select / deselect all questions in the currently selected category.
 * Toggles: if all are selected → deselect all; otherwise → select all.
 */
function selectAllCurrentCategory() {
    const questionItems = document.querySelectorAll('#question-list .question-item');
    if (!questionItems.length) return;

    const allSelected = [...questionItems].every(item => item.classList.contains('selected'));

    questionItems.forEach(item => {
        const marksInput = item.querySelector('.marks-input');
        if (!marksInput) return;

        const onchange = marksInput.getAttribute('onchange') || '';
        const match = onchange.match(/updateMarks\('([^']+)'/);
        if (!match) return;
        const questionKey = match[1];

        if (allSelected) {
            selectedQuestions = selectedQuestions.filter(q => q !== questionKey);
            delete selectedQuestionsData[questionKey];
            item.classList.remove('selected');
        } else {
            if (!selectedQuestions.includes(questionKey)) {
                selectedQuestions.push(questionKey);
                selectedQuestionsData[questionKey] = parseInt(marksInput.value) || 1;
            }
            item.classList.add('selected');
        }
    });

    calculateTotalMarks();
    updateSelectAllCategoryBtn();
}

/** Update Select All button label based on current selection state. */
function updateSelectAllCategoryBtn() {
    const btn = document.getElementById('select-all-category-btn');
    if (!btn) return;
    const questionItems = document.querySelectorAll('#question-list .question-item');
    if (!questionItems.length) {
        btn.innerHTML = '☑ Select All';
        btn.style.background = 'linear-gradient(135deg,#27ae60,#1e8449)';
        return;
    }
    const allSelected = [...questionItems].every(item => item.classList.contains('selected'));
    btn.innerHTML = allSelected ? '☐ Deselect All' : '☑ Select All';
    btn.style.background = allSelected
        ? 'linear-gradient(135deg,#e74c3c,#c0392b)'
        : 'linear-gradient(135deg,#27ae60,#1e8449)';
}

// ── Label helpers ──────────────────────────────────────────────────────────
// alpha:  (a) (b) (c) ...   used for fillblanks, vshort, short
// roman:  (i) (ii) (iii) ... used for long, ar, case
// hindi:  (क) (ख) (ग) ...   used for MCQ
function alphaLabel(i) {
    return `(${String.fromCharCode(97 + i)})`;
}
function romanLabel(i) {
    const vals = ['i','ii','iii','iv','v','vi','vii','viii','ix','x',
                  'xi','xii','xiii','xiv','xv','xvi','xvii','xviii','xix','xx', 'xxi','xxii','xxiii','xxiv','xxv','xxvi','xxvii','xxviii','xxix','xxx', 'xxxi','xxxii','xxxiii','xxxiv','xxxv','xxxvi','xxxvii','xxxviii','xxxix','xl', 'xli','xlii','xliii','xliv','xlv','xlvi','xlvii','xlviii','xlix','l'];
    return `(${vals[i] || (i + 1)})`;
}
function hindiLabel(i) {
    const letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
    return `(${letters[i] || (i + 1)})`;
}
function subLabel(type, i, totalCount) {
    // when only a single sub-item exists, skip labeling entirely
    if (typeof totalCount === 'number' && totalCount <= 1) {
        return '';
    }
    const style = (subLabelStyle && subLabelStyle[type]) || 'alpha';
    if (style === 'hindi') return hindiLabel(i);
    if (style === 'roman') return romanLabel(i);
    return alphaLabel(i);
}

// ── showQuestionsByType ────────────────────────────────────────────────────
function showQuestionsByType(type) {
    const questionList = document.getElementById('question-list');
    questionList.innerHTML = '';

    selectedChapters.forEach(chapter => {
        if (!questions[chapter] || !questions[chapter][type]) return;

        const section = document.createElement('div');
        section.className = 'question-section';
        section.innerHTML = `<div class="section-title">${chapter}</div>`;

        const qList = questions[chapter][type];

        // ── AR / CASE ──────────────────────────────────────────────
        if ((type === 'ar' || type === 'case') && Array.isArray(qList)) {
            qList.forEach((block, blockIdx) => {
                const instrDiv = document.createElement('div');
                instrDiv.className = 'question-instruction';
                instrDiv.innerHTML = `<strong>Passage / Instruction:</strong><br>${renderFractions(block.instruction || '')}`;
                section.appendChild(instrDiv);

                const qArr = block.questions || [];
                if (qArr.length === 0) {
                    // no sub-questions – make the whole passage selectable
                    const questionKey = `${type}|${chapter}|${blockIdx}|0`;
                    const questionDiv = document.createElement('div');
                    questionDiv.className = 'question-item';
                    if (selectedQuestions.includes(questionKey)) questionDiv.classList.add('selected');

                    let marks = selectedQuestionsData[questionKey] || 2;
                    let safeQ = block.instruction.replace(/<img/g, '<img class="question-image"');
                    safeQ = renderFractions(safeQ);

                    const marksInput = `<div class="marks-container">
                        <input type="number" class="marks-input" value="${marks}" min="1"
                            style="width:40px;padding:3px;"
                            onchange="updateMarks('${questionKey}', this.value)"
                            onclick="event.stopPropagation()"> marks
                    </div>`;

                    questionDiv.innerHTML = `
                        <div class="question-display" style="flex:1;">
                            ${safeQ}
                        </div>${marksInput}`;
                    questionDiv.style.cssText = 'display:flex;align-items:center;';
                    questionDiv.onclick = e => { if (!e.target.classList.contains('marks-input')) toggleSelection(questionDiv, questionKey); };
                    section.appendChild(questionDiv);
                } else {
                    qArr.forEach((qObj, idx) => {
                        const questionKey = `${type}|${chapter}|${blockIdx}|${idx}`;
                        const questionDiv = document.createElement('div');
                        questionDiv.className = 'question-item';
                        if (selectedQuestions.includes(questionKey)) questionDiv.classList.add('selected');

                        let marks = selectedQuestionsData[questionKey] || 2;
                        let safeQ = (qObj.question || '').replace(/<img/g, '<img class="question-image"');
                        // fallback to block text if sub-question blank
                        if (!safeQ && block.instruction) safeQ = block.instruction;
                        safeQ = renderFractions(safeQ);

                        const marksInput = `<div class="marks-container">
                            <input type="number" class="marks-input" value="${marks}" min="1"
                                style="width:40px;padding:3px;"
                                onchange="updateMarks('${questionKey}', this.value)"
                                onclick="event.stopPropagation()"> marks
                        </div>`;

                        questionDiv.innerHTML = `
                            <div class="question-display" style="flex:1;">
                                <span style="font-weight:bold;margin-right:4px;">${subLabel(type, idx)}</span>${safeQ}
                            </div>${marksInput}`;
                        questionDiv.style.cssText = 'display:flex;align-items:center;';
                        questionDiv.onclick = e => { if (!e.target.classList.contains('marks-input')) toggleSelection(questionDiv, questionKey); };
                        section.appendChild(questionDiv);
                    });
                }
            });

        // ── FILLBLANKS ─────────────────────────────────────────────
        } else if (type === 'fillblanks' && Array.isArray(qList)) {
            qList.forEach((block, blockIdx) => {
                const itemsArr = block.items || [];
                const totalItems = itemsArr.length;
                const singleBlankEmpty = totalItems === 1 && !itemsArr[0].blank && !itemsArr[0].image;

                if (!singleBlankEmpty) {
                    const instrDiv = document.createElement('div');
                    instrDiv.className = 'question-instruction';
                    instrDiv.innerHTML = `<strong>${renderFractions(block.instruction || '')}</strong>`;
                    section.appendChild(instrDiv);
                }

                if (singleBlankEmpty) {
                    // show the instruction itself as the selectable question
                    const questionKey = `fillblanks|${chapter}|${blockIdx}|0`;
                    const questionDiv = document.createElement('div');
                    questionDiv.className = 'question-item';
                    if (selectedQuestions.includes(questionKey)) questionDiv.classList.add('selected');

                    let marks = selectedQuestionsData[questionKey] || 1;
                    let safeQ = renderFractions(block.instruction || '');
                    const marksInput = `<div class="marks-container">
                        <input type="number" class="marks-input" value="${marks}" min="1"
                            style="width:40px;padding:3px;"
                            onchange="updateMarks('${questionKey}', this.value)"
                            onclick="event.stopPropagation()"> marks
                </div>`;

                    questionDiv.innerHTML = `<div class="question-display" style="flex:1;">${safeQ}</div>${marksInput}`;
                    questionDiv.style.cssText = 'display:flex;align-items:center;';
                    questionDiv.onclick = e => { if (!e.target.classList.contains('marks-input')) toggleSelection(questionDiv, questionKey); };
                    section.appendChild(questionDiv);
                } else {
                    itemsArr.forEach((item, itemIdx) => {
                        const questionKey = `fillblanks|${chapter}|${blockIdx}|${itemIdx}`;
                        const questionDiv = document.createElement('div');
                        questionDiv.className = 'question-item';
                        if (selectedQuestions.includes(questionKey)) questionDiv.classList.add('selected');

                        let marks = selectedQuestionsData[questionKey] || 1;
                        const imgHtml = item.image ? item.image.replace(/<img/g, '<img class="question-image"') : '';

                        const marksInput = `<div class="marks-container">
                            <input type="number" class="marks-input" value="${marks}" min="1"
                                style="width:40px;padding:3px;"
                                onchange="updateMarks('${questionKey}', this.value)"
                                onclick="event.stopPropagation()"> marks
                        </div>`;

                        questionDiv.innerHTML = `
                            <div class="question-display" style="flex:1;">
                                <span style="font-weight:bold;margin-right:4px;">${subLabel('fillblanks', itemIdx, totalItems)}</span>
                                ${imgHtml}
                                <span>${renderFractions(item.blank || '')}</span>
                            </div>${marksInput}`;
                        questionDiv.style.cssText = 'display:flex;align-items:center;';
                        questionDiv.onclick = e => { if (!e.target.classList.contains('marks-input')) toggleSelection(questionDiv, questionKey); };
                        section.appendChild(questionDiv);
                    });
                }
            });

        // ── VSHORT / SHORT / LONG (grouped) ───────────────────────
        } else if (['vshort','short','long', 'picturebased', 'grammar','circleodd', 'rewrite', 'miscellaneous', 'tick', 'truefalse'].includes(type) && Array.isArray(qList) && qList[0] && qList[0].items) {
            qList.forEach((block, blockIdx) => {
                const itemsArr = block.items || [];
                const totalItems = itemsArr.length;
                const singleEmpty = totalItems === 1 && !itemsArr[0].question;

                if (block.instruction && !singleEmpty) {
                    const instrDiv = document.createElement('div');
                    instrDiv.className = 'question-instruction';
                    instrDiv.innerHTML = `<strong>${renderFractions(block.instruction || '')}</strong>`;
                    section.appendChild(instrDiv);
                }
                {
                    itemsArr.forEach((item, itemIdx) => {
                        const questionKey = `${type}|${chapter}|${blockIdx}|${itemIdx}`;
                        const questionDiv = document.createElement('div');
                        questionDiv.className = 'question-item';
                        if (selectedQuestions.includes(questionKey)) questionDiv.classList.add('selected');

                        const defaultMarks = type === 'long' ? 5 : ['short','circleodd','rewrite','miscellaneous'].includes(type) ? 2 : 1;
                        let marks = selectedQuestionsData[questionKey] || defaultMarks;
                        // prefer item.question; if empty and block has instruction, use instruction
                        let safeQ = item.question || '';
                        if (!safeQ && block.instruction) safeQ = block.instruction;
                        safeQ = safeQ.replace(/<img/g, '<img class="question-image"');
                        safeQ = renderFractions(safeQ);

                        const marksInput = `<div class="marks-container">
                            <input type="number" class="marks-input" value="${marks}" min="1"
                                style="width:40px;padding:3px;"
                                onchange="updateMarks('${questionKey}', this.value)"
                                onclick="event.stopPropagation()"> marks
                        </div>`;

                        questionDiv.innerHTML = `
                            <div class="question-display" style="flex:1;">
                                <span style="font-weight:bold;margin-right:4px;">${subLabel(type, itemIdx, totalItems)}</span>${safeQ}
                            </div>${marksInput}`;
                        questionDiv.style.cssText = 'display:flex;align-items:center;';
                        questionDiv.onclick = e => { if (!e.target.classList.contains('marks-input')) toggleSelection(questionDiv, questionKey); };
                        section.appendChild(questionDiv);
                    });
                }
            });

        // ── MCQ / TRUEFALSE / MATCHING / PICTUREBASED / flat types ─
        } else {
            qList.forEach((qObj, idx) => {
                const questionKey = `${type}|${chapter}|${idx}`;
                const questionDiv = document.createElement('div');
                questionDiv.className = 'question-item';
                if (selectedQuestions.includes(questionKey)) questionDiv.classList.add('selected');

                let marks = selectedQuestionsData[questionKey] ||
                    (type === 'matching' || type === 'long' ? 5 : ['short','circleodd','rewrite','miscellaneous'].includes(type) ? 2 : 1);
                let safeQ = (qObj.question || '').replace(/<img/g, '<img class="question-image"');
                safeQ = renderFractions(safeQ);

                const marksInput = `<div class="marks-container">
                    <input type="number" class="marks-input" value="${marks}" min="1"
                        style="width:40px;padding:3px;"
                        onchange="updateMarks('${questionKey}', this.value)"
                        onclick="event.stopPropagation()"> marks
                </div>`;

                let displayContent = '';
                if (type === 'mcq') {
                    const opts = qObj.options || [];
                    const optionsHtml = opts.map((opt, i) =>
                        `<span style="display:inline-block;margin-right:16px;">${subLabel('mcq', i, opts.length)} ${renderFractions(opt)}</span>`).join('');
                    displayContent = `<div class="question-display" style="flex:1;">
                        <div class="question-text">${safeQ}</div>
                        <div class="options-list" style="margin-top:4px;">${optionsHtml}</div>
                    </div>${marksInput}`;
                } else if (type === 'matching') {
                    const opts = qObj.options || [];
                    const hasImageOption = opts.some(opt => /<img\b/i.test(opt));
                    if (hasImageOption && opts.length <= 2) {
                        const promptHtml = opts.map(opt => `<div>${renderFractions(opt)}</div>`).join('');
                        displayContent = `<div class="question-display" style="flex:1;">
                            <div class="question-text">${safeQ}</div>
                            ${promptHtml}
                        </div>${marksInput}`;
                    } else {
                        const colA = opts[0] || 'Column A', colB = opts[1] || 'Column B';
                        const pairs = opts.slice(2);
                        const leftItems = pairs.filter((_, i) => i % 2 === 0);
                        const rightItems = pairs.filter((_, i) => i % 2 === 1);
                        displayContent = `<div class="question-display" style="flex:1;">
                            <div class="question-text">${safeQ}</div>
                            <table class="matching-preview">
                                ${!hasImageOption ? `<tr><th>${renderFractions(colA)}</th><th>${renderFractions(colB)}</th></tr>` : ''}
                                ${leftItems.map((l, i) => `<tr><td>${renderFractions(l)}</td><td>${renderFractions(rightItems[i] || '')}</td></tr>`).join('')}
                            </table>
                        </div>${marksInput}`;
                    }
                } else {
                    displayContent = `<div class="question-display" style="flex:1;">
                        <div class="question-text">${safeQ}</div>
                    </div>${marksInput}`;
                }
                questionDiv.innerHTML = displayContent;
                questionDiv.style.cssText = 'display:flex;align-items:center;';
                questionDiv.onclick = e => { if (!e.target.classList.contains('marks-input')) toggleSelection(questionDiv, questionKey); };
                section.appendChild(questionDiv);
            });
        }

        questionList.appendChild(section);
    });

    if (!questionList.children.length) {
        questionList.innerHTML = '<div class="question-item" style="border:none;background:#fff;color:#555;cursor:default;">No questions found for this type. Please select another question type.</div>';
    }
}

function updateMarks(questionKey, value) {
    selectedQuestionsData[questionKey] = parseInt(value) || 0;
    calculateTotalMarks();
}

function showQuestions() {
    if (selectedChapters.length === 0) { alert('Please select at least one chapter.'); return; }
    const select = document.getElementById('question-type');
    const availableTypes = getAvailableQuestionTypes();
    if (availableTypes.length === 0) {
        alert('No questions are available for the chapters you selected. Please choose different chapters.');
        return;
    }
    populateQuestionTypesDropdown(availableTypes);
    if (!availableTypes.includes(select.value)) {
        select.value = availableTypes[0];
    }
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById('question-selection').style.display = 'block';
    filterQuestions();
}

function populateQuestionTypesDropdown(availableTypes) {
    const select = document.getElementById('question-type');
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = QUESTION_TYPE_OPTIONS
        .filter(opt => availableTypes.includes(opt.value))
        .map(opt => `<option value="${opt.value}">${opt.label}</option>`)
        .join('');
    if (availableTypes.includes(currentValue)) {
        select.value = currentValue;
    }
}

function getAvailableQuestionTypes() {
    const types = new Set();
    selectedChapters.forEach(chapter => {
        const chapterData = questions[chapter];
        if (!chapterData) return;
        Object.entries(chapterData).forEach(([type, qList]) => {
            if (Array.isArray(qList) && qList.length > 0) {
                types.add(type);
            }
        });
    });
    return Array.from(types);
}

function toggleSelection(element, questionKey) {
    if (selectedQuestions.includes(questionKey)) {
        selectedQuestions = selectedQuestions.filter(q => q !== questionKey);
        delete selectedQuestionsData[questionKey];
        element.classList.remove('selected');
    } else {
        selectedQuestions.push(questionKey);
        const marksInput = element.querySelector('.marks-input');
        selectedQuestionsData[questionKey] = parseInt(marksInput.value) || 0;
        element.classList.add('selected');
    }
    calculateTotalMarks();
    updateSelectAllCategoryBtn();
}

function previewLogo(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = e => {
            logoData = e.target.result;
            const preview = document.getElementById('logo-preview');
            preview.src = logoData;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

function getFullQuestionKey(type, chapter, index) { return `${type}|${chapter}|${index}`; }

function renderFractions(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\[\[\s*(.*?)\s*\|\|\s*(.*?)\s*\]\]/g, (_, n, d) =>
        `<span class="fraction"><span class="fraction-top">${n}</span><span class="fraction-line"></span><span class="fraction-bottom">${d}</span></span>`
    );
}

// ── TOTAL MARKS for a block (sum of selected item marks) ──────────────────
function blockTotalMarks(type, chapter, blockIdx, itemIndices) {
    let total = 0;
    itemIndices.forEach(iIdx => {
        const k = `${type}|${chapter}|${blockIdx}|${iIdx}`;
        total += selectedQuestionsData[k] || 0;
    });
    return total;
}

// ── formatFillBlanksBlock ─────────────────────────────────────────────────
// Renders the whole block as Q.N. with sub-items (a)(b)(c)
function formatFillBlanksBlock(block, chapter, blockIdx, selectedItemIndices, mainNum, questionKeys = []) {
    const itemsToRender = selectedItemIndices
        ? selectedItemIndices.map(i => ({ item: block.items[i], itemIdx: i }))
        : (block.items || []).map((item, i) => ({ item, itemIdx: i }));
    if (itemsToRender.length === 0) return '';

    const totalMarks = blockTotalMarks('fillblanks', chapter, blockIdx, itemsToRender.map(x => x.itemIdx));

    let html = `<div style="margin-bottom:14px;">
        <div style="margin-bottom:6px;">
            ${mainLabel(mainNum)} ${getEditedGroupedInstruction('fillblanks', chapter, blockIdx, block, questionKeys)}
        </div>
        <div style="display:grid;grid-template-columns:repeat(1,1fr);gap:10px;margin-top:6px;">`;

    const blockItemCount = (block.items || []).length;
    const b0 = block.items && block.items[0];
    const hasSplitBody = blockItemCount === 1 && b0 &&
        (String(b0.blank || '').trim() || String(b0.image || '').trim());
    const isMulti = itemsToRender.length > 1 || (questionKeys && questionKeys.length > 1) || blockItemCount > 1 || !!hasSplitBody;

    itemsToRender.forEach(({ item, itemIdx }, localIdx) => {
        const key = questionKeys[localIdx] || `fillblanks|${chapter}|${blockIdx}|${itemIdx}`;
        const ed = editedQuestions[key];

        // isBlankEmpty: blank bhi nahi aur image bhi nahi — tab hi skip karo
        const isBlankEmpty = !String(item.blank || '').trim() && !String(item.image || '').trim();
        if (isBlankEmpty && itemsToRender.length === 1) {
            // Instruction mein full question hai — sirf answer line dikhao agar zaroorat ho
            if (showAnswers) {
                const edFB = editedQuestions[key];
                const fbAns = (edFB && edFB.answer !== undefined && edFB.answer !== '')
                    ? edFB.answer
                    : item.answer;
                if (fbAns) {
                    html += `<div style="padding:4px 8px;color:#1a7a4a;font-size:0.85em;"><strong>Ans:</strong> ${fbAns}</div>`;
                }
            }
            return;
        }

        // Image resolve karo — item.image mein <img> tag ya plain URL dono handle karo
        const resolvedItemImage = (ed && ed.itemImage) || item.image || '';
        let imgHtml = '';
        if (resolvedItemImage) {
            // Agar pehle se <img> tag hai to sirf class add karo
            if (/<img/i.test(resolvedItemImage)) {
                imgHtml = resolvedItemImage.replace(/<img/gi, '<img class="question-image" style="max-width:200px;display:block;margin:6px 0;"');
            } else {
                // Plain URL/path hai — <img> tag banaao
                imgHtml = `<img src="${resolvedItemImage}" class="question-image" style="max-width:200px;display:block;margin:6px 0;">`;
            }
        }
        let blankDisplay = getEditedSubItemBodyHtml(key, item.blank || '', isMulti, localIdx === 0);
        blankDisplay = blankDisplay.replace(/(?![^<]*>)(_{10,})/g, '<u>&emsp;&emsp;</u>'); // 10 ya usse zyada underscores ko underline mein convert karo, lekin agar wo <img> tag ke andar hain to unko skip karo
        const edFBItem = editedQuestions[key];
        const fbItemAns = (edFBItem && edFBItem.answer !== undefined && edFBItem.answer !== '')
            ? edFBItem.answer
            : item.answer;
        const fbItemMarks = selectedQuestionsData[key] || 0;
        html += `<div class="sub-item-row" data-subkey="${key}" data-subtype="fillblanks" data-subchapter="${chapter}" style="padding:8px;display:flex;align-items:flex-start;gap:8px;">
            <div style="flex:1;min-width:0;">
                <span style="font-weight:bold;">${subLabel('fillblanks', localIdx, itemsToRender.length)}</span>
                ${imgHtml}
                <span>${blankDisplay}</span>
                <span class="marks-right" style="float:right;color:#555;font-size:0.85em;">[${fbItemMarks} marks]</span>
                ${showAnswers && fbItemAns ? `<div style="color:#1a7a4a;font-size:0.85em;margin-top:4px;"><strong>Ans:</strong> ${fbItemAns}</div>` : ''}
            </div>
            <div class="sub-item-actions no-print" style="display:flex;flex-direction:column;gap:3px;flex-shrink:0;"></div>
        </div>`;
    });

    html += `</div></div>`;
    return html;
}

// ── formatGroupedBlock ────────────────────────────────────────────────────
// Renders vshort/short/long/ar/case block as Q.N. with sub-items (a)(b) or (i)(ii)
function formatGroupedBlock(type, block, chapter, blockIdx, selectedItemIndices, mainNum, questionKeys = []) {
    const isSubItems = block.items !== undefined;
    const rawList = isSubItems ? (block.items || []) : (block.questions || []);

    const itemsToRender = selectedItemIndices
        ? selectedItemIndices.map(i => ({ item: rawList[i], itemIdx: i }))
        : rawList.map((item, i) => ({ item, itemIdx: i }));
    if (itemsToRender.length === 0) return '';

    // Total marks
    let totalMarks = 0;
    itemsToRender.forEach(({ itemIdx }) => {
        const k = `${type}|${chapter}|${blockIdx}|${itemIdx}`;
        totalMarks += selectedQuestionsData[k] || 0;
    });

    const instruction = getEditedGroupedInstruction(type, chapter, blockIdx, block, questionKeys);
    const defaultLines = type === 'long' ? 4 : ['short','circleodd','rewrite','miscellaneous'].includes(type) ? 3 : type === 'grammar' ? 2 : 1;

    // if there is just one selected item and its question is empty, we don't
    // render a secondary line with empty text – the instruction already covers it.
    const singleEmpty = itemsToRender.length === 1 && !(itemsToRender[0].item && itemsToRender[0].item.question);

    // question blank ho (singleEmpty) to instruction ke samne hi marks badge dikhao,
    // kyunki is case mein koi alag sub-item row render nahi hota jahan marks dikhe.
    const instructionMarksHtml = singleEmpty
        ? `<span class="marks-right" style="float:right;color:#555;font-size:0.85em;">[${totalMarks} marks]</span>`
        : '';

    let html = `<div style="margin-bottom:16px;">
        <div style="margin-bottom:6px;">
            ${mainLabel(mainNum)} ${instruction}${instructionMarksHtml}
        </div>`;

    const blockSubCount = isSubItems ? (block.items || []).length : (block.questions || []).length;
    const isMulti = itemsToRender.length > 1 || (questionKeys && questionKeys.length > 1) || blockSubCount > 1;

    if (singleEmpty) {
        // just output the answer lines for this question, or the answer if showAnswers
        if (showAnswers) {
            const singleKey = questionKeys[0] || `${type}|${chapter}|${blockIdx}|${itemsToRender[0].itemIdx}`;
            const edSingle = editedQuestions[singleKey];
            const singleItem = itemsToRender[0] && itemsToRender[0].item;
            // Prefer edited answer, then original item answer
            let ans = (edSingle && edSingle.answer !== undefined && edSingle.answer !== '')
                ? edSingle.answer
                : (singleItem && (singleItem.answer || singleItem.answers || singleItem.correctAnswer));
            if (ans) {
                if (Array.isArray(ans) && ans.length) {
                    html += `<div style="margin:4px 0 8px 16px;color:#1a7a4a;font-size:0.9em;"><strong>Ans:</strong> ${ans.join(', ')}</div>`;
                } else if (typeof ans === 'string' && ans.trim()) {
                    html += `<div style="margin:4px 0 8px 16px;color:#1a7a4a;font-size:0.9em;"><strong>Ans:</strong> ${ans}</div>`;
                }
            }
        } else {
            html += `<div style="margin:4px 0 8px 16px;">${DEFAULT_BLANK_LINE}</div>`;
        }
    } else {
        itemsToRender.forEach(({ item, itemIdx }, localIdx) => {
            const label = subLabel(type, localIdx, itemsToRender.length);
            const key = questionKeys[localIdx] || `${type}|${chapter}|${blockIdx}|${itemIdx}`;
            const edItem = editedQuestions[key];
            // Prefer edited answer, then original item answer
            const answer = (edItem && edItem.answer !== undefined && edItem.answer !== '')
                ? edItem.answer
                : (item.answer || '');
            const itemQ = item.question || DEFAULT_BLANK_LINE;
            let safeQ = getEditedSubItemBodyHtml(key, itemQ, isMulti, localIdx === 0);

            const itemMarks = selectedQuestionsData[key] || 0;
            const answerHtml = (showAnswers && answer)
                ? `<div style="margin:2px 0 8px 0;color:#1a7a4a;font-size:0.9em;"><strong>Ans:</strong> ${answer}</div>`
                : /* Array(defaultLines).fill('<div style="border-bottom:1px solid #ccc;margin:5px 0 0;height:16px;"></div>').join(''); */ '';
            html += `<div class="sub-item-row" data-subkey="${key}" data-subtype="${type}" data-subchapter="${chapter}" style="margin:6px 0 4px 0;display:flex;align-items:flex-start;gap:8px;">
                <div style="flex:1;min-width:0;margin-left:16px;">
                    <span style="font-weight:bold;">${label}</span> ${safeQ}
                    <span class="marks-right" style="float:right;color:#555;font-size:0.85em;">[${itemMarks} marks]</span>
                    ${answerHtml}
                </div>
                <div class="sub-item-actions no-print" style="display:flex;flex-direction:column;gap:3px;flex-shrink:0;"></div>
            </div>`;
        });
    }

    html += `</div>`;
    return html;
}

// ── formatQuestion ────────────────────────────────────────────────────────
// MCQ, truefalse, matching: ORIGINAL format — completely unchanged.
// Other flat types (picturebased, numericals): answer lines only.
function formatQuestion(type, qObj, qIndex, chapter, questionKey) {
    let marksKey = questionKey || qObj._questionKey || `${type}|${chapter}|${qIndex - 1}`;
    let marks = selectedQuestionsData[marksKey] ||
        (type === 'matching' || type === 'long' ? 5 : ['short','circleodd','rewrite','miscellaneous'].includes(type) ? 2 : 1);

    let safeQ = getEditedQuestionText(marksKey, (qObj.question || '').replace(/<img(?![^>]*class=["'][^"']*question-image)/g, '<img class="question-image"'));

    // Original header format — plain text, no extra wrapper div
    let formatted = `${mainLabel(qIndex)} ${safeQ} <span class="marks-right">[${marks} marks]</span><br>`;

    if (type === 'mcq') {
        // Original: a) b) c) each on new line with indent (uses subLabel style)
        const edited = editedQuestions[marksKey] || {};
        const options = Array.isArray(edited.options) && edited.options.length ? edited.options : (qObj.options || []);
        formatted += options.map((opt, i) =>
            `&nbsp;&nbsp;&nbsp;&nbsp;${subLabel('mcq', i, options.length)} ${renderFractions(opt)}`
        ).join('<br>');

    } else if (type === 'truefalse') {
        // nothing additional here; answer will be appended below when showAnswers is true

    } else if (type === 'matching') {
        const edited = editedQuestions[marksKey] || {};
        const opts = Array.isArray(edited.options) && edited.options.length ? edited.options : (qObj.options || []);
        const hasImageOption = opts.some(opt => /<img\b/i.test(opt));
        const pairs = opts.slice(2);
        const left = pairs.filter((_, i) => i % 2 === 0);
        const right = pairs.filter((_, i) => i % 2 === 1);

        if (hasImageOption && opts.length <= 2) {
            formatted += opts.map(opt => `<div>${renderFractions(opt)}</div>`).join('');
        } else if (opts.length > 0) {
            const colA = opts[0] || 'Column A';
            const colB = opts[1] || 'Column B';
            formatted += `<table class="matching-table">`;
            if (!hasImageOption) {
                formatted += `<tr><th>${renderFractions(colA)}</th><th>${renderFractions(colB)}</th></tr>`;
            }
            for (let i = 0; i < left.length; i++) {
                formatted += `<tr><td class="left-column">${renderFractions(left[i])}</td><td class="right-column">${renderFractions(right[i] || '')}</td></tr>`;
            }
            formatted += `</table>`;
        }

    } else if (type === 'picturebased') {
        const edited = editedQuestions[marksKey] || {};
        // Rebuild safeQ: use edited question text + inject image
        const editedText = edited.question !== undefined
            ? edited.question.replace(/<img[^>]*>/gi, '').trim()
            : (qObj.question || '').replace(/<img[^>]*>/gi, '').trim();
        const imgSrc = edited.imageData || (() => {
            const m = (qObj.question || '').match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
            return m ? m[1] : '';
        })();
        safeQ = renderFractions(editedText);
        if (imgSrc) {
            safeQ += `<br><img src="${imgSrc}" class="question-image" style="max-width:420px;display:block;margin:8px 0;">`;
        }
        formatted = `${mainLabel(qIndex)} ${safeQ} <span class="marks-right">[${marks} marks]</span><br>`;
        if (!showAnswers) {
            const lines = 2;
            formatted += Array(lines).fill('<div style="border-bottom:1px solid #ccc;margin:5px 0;height:16px;"></div>').join('');
        }
    } else {
        // picturebased, numericals — answer lines or blanks
        if (!showAnswers) {
            const lines = type === 'long' ? 4 : ['short','circleodd','rewrite','miscellaneous'].includes(type) ? 3 : 1;
            formatted += Array(lines).fill('<div style="border-bottom:1px solid #ccc;margin:5px 0;height:16px;"></div>').join('');
        }
        // answers for these types will be appended below as well
    }

    // append answer text for any type when requested
    if (showAnswers) {
        // Prefer edited answer, then original qObj answer
        const edFQ = editedQuestions[marksKey];
        const ans = (edFQ && edFQ.answer !== undefined && edFQ.answer !== '')
            ? edFQ.answer
            : (qObj.answers || qObj.answer || qObj.correctAnswer || null);
        if (ans) {
            if (Array.isArray(ans) && ans.length) {
                formatted += `<br><span style="color:#1a7a4a;"><strong>Ans:</strong> ${ans.join(', ')}</span>`;
            } else if (typeof ans === 'string' && ans.trim()) {
                formatted += `<br><span style="color:#1a7a4a;"><strong>Ans:</strong> ${ans}</span>`;
            }
        }
    }

    return formatted;
}

// ── showPreview ───────────────────────────────────────────────────────────
function showPreview() {
    if (selectedQuestions.length === 0) { alert('Please select at least one question.'); return; }

    document.getElementById('question-selection').style.display = 'none';
    if (selectedMode === 'auto') {
        document.getElementById('auto-mode').style.display = 'none';
    }
    document.getElementById('test-preview').style.display = 'block';

    const previewContent = document.getElementById('preview-content');
    previewContent.innerHTML = '';

    const groupedQuestions = {};
    selectedQuestions.forEach(key => {
        let type, chapter, extra;
        if (key.startsWith('custom|')) {
            const cq = customQuestions[key];
            type = cq.type;
            chapter = 'Additional';
            extra = [key];
        } else {
            const parts = key.split('|');
            [type, chapter] = parts;
            extra = parts.slice(2);
        }
        if (!groupedQuestions[type]) groupedQuestions[type] = {};
        if (!groupedQuestions[type][chapter]) groupedQuestions[type][chapter] = [];
        groupedQuestions[type][chapter].push(extra);
    });

    Object.entries(groupedQuestions).forEach(([type, chapters]) => {
        const section = document.createElement('div');
        section.className = 'question-section';
        const title = document.createElement('div');
        title.className = 'section-title';
        title.textContent = getQuestionTypeTitle(type);
        section.appendChild(title);

        let mainNum = 1;

        Object.entries(chapters).forEach(([chapter, keysArr]) => {
            const qData = questions[chapter] && questions[chapter][type];

            if ((type === 'ar' || type === 'case') && Array.isArray(qData)) {
                qData.forEach((block, blockIdx) => {
                    const selInBlock = keysArr.filter(k => parseInt(k[0]) === blockIdx);
                    if (!selInBlock.length) return;
                    const itemIndices = selInBlock.map(k => parseInt(k[1]));
                    const questionKeys = itemIndices.map(idx => `${type}|${chapter}|${blockIdx}|${idx}`);
                    const div = document.createElement('div');
                    div.className = 'question-item';
                    div.innerHTML = formatGroupedBlock(type, block, chapter, blockIdx, itemIndices, mainNum, questionKeys);
                    _appendSubItemActions(div, questionKeys, type, chapter);
                    section.appendChild(div);
                    mainNum++;
                });

            } else if (type === 'fillblanks' && Array.isArray(qData)) {
                qData.forEach((block, blockIdx) => {
                    const selInBlock = keysArr.filter(k => parseInt(k[0]) === blockIdx);
                    if (!selInBlock.length) return;
                    const itemIndices = selInBlock.map(k => parseInt(k[1]));
                    const questionKeys = itemIndices.map(idx => `fillblanks|${chapter}|${blockIdx}|${idx}`);
                    const div = document.createElement('div');
                    div.className = 'question-item';
                    div.innerHTML = formatFillBlanksBlock(block, chapter, blockIdx, itemIndices, mainNum, questionKeys);
                    _appendSubItemActions(div, questionKeys, 'fillblanks', chapter);
                    section.appendChild(div);
                    mainNum++;
                });

            } else if (['vshort','short','long','picturebased','grammar','circleodd', 'rewrite', 'miscellaneous', 'tick', 'truefalse'].includes(type) && Array.isArray(qData) && qData[0] && qData[0].items) {
                qData.forEach((block, blockIdx) => {
                    const selInBlock = keysArr.filter(k => parseInt(k[0]) === blockIdx);
                    if (!selInBlock.length) return;
                    const itemIndices = selInBlock.map(k => parseInt(k[1]));
                    const questionKeys = itemIndices.map(idx => `${type}|${chapter}|${blockIdx}|${idx}`);
                    const div = document.createElement('div');
                    div.className = 'question-item';
                    div.innerHTML = formatGroupedBlock(type, block, chapter, blockIdx, itemIndices, mainNum, questionKeys);
                    _appendSubItemActions(div, questionKeys, type, chapter);
                    section.appendChild(div);
                    mainNum++;
                });

            } else {
                if (chapter === 'Additional') {
                    keysArr.forEach(k => {
                        const customKey = k[0];
                        const cq = customQuestions[customKey];
                        const div = document.createElement('div');
                        div.className = 'question-item';
                        div.innerHTML = _renderCustomQuestion(cq, mainNum);
                        appendPreviewActions(div, customKey, [customKey], cq.type, chapter);
                        section.appendChild(div);
                        mainNum++;
                    });
                } else {
                    keysArr.forEach(k => {
                        const qIdx = parseInt(k[0]);
                        const qObj = qData && qData[qIdx];
                        if (!qObj) return;
                        const questionKey = `${type}|${chapter}|${qIdx}`;
                        const div = document.createElement('div');
                        div.className = 'question-item';
                        div.innerHTML = formatQuestion(type, qObj, mainNum, chapter, questionKey);
                        appendPreviewActions(div, questionKey, [questionKey], type, chapter);
                        section.appendChild(div);
                        mainNum++;
                    });
                }
            }
        });

        previewContent.appendChild(section);
    });

    calculateTotalMarks();
}

function getSectionLabel(sectionIndex) {
    const hindiLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    return `Section  ${hindiLetters[sectionIndex] || sectionIndex}`;
}

function getQuestionTypeTitle(type) {
    const titles = {
        mcq: 'Multiple Choice Questions',
        fillblanks: 'Fill in the Blanks',
        truefalse: 'True or False',
        matching: 'Match the Following',
        vshort: 'Very Short Answer Questions',
        short: 'Short Answer Questions',
        long: 'Long Answer Questions',
        ar: 'Assertion-Reason Questions',
        case: 'Case-based Questions',
        picturebased: 'Picture-based Questions',
        grammar: 'Grammar-based Questions',
        circleodd: 'Circle/Underline/Odd',
        rewrite: 'Rewrite the Sentences'
    };
    return titles[type] || type;
}

// ── saveAsDoc ─────────────────────────────────────────────────────────────
function saveAsDoc() {
    alert('Please open downloaded file in Microsoft Word or another word processor.');
    let content = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
            <meta charset="utf-8">
            <title></title>
            <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>90</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
            <style>
                @page Section1 { margin:1.0in 1.0in 1.0in 1.0in; mso-header-margin:.5in; mso-footer-margin:.5in; mso-paper-source:0; }
                div.Section1 {page:Section1;}
                body { font-family: 'Times New Roman', serif; line-height: 1.6; }
                .header { text-align: center; margin-bottom: 20px; }
                .info-table { width: 100%; margin-bottom: 20px; border-collapse: collapse; }
                .info-table td { padding: 8px; border: 1px solid #000; }
                .question-section { margin-bottom: 30px; }
                .section-title { font-weight: bold; margin-bottom: 15px; padding: 8px; background-color: #f0f0f0; border-left: 4px solid #000; }
                .question { margin-bottom: 15px; padding-left: 20px; }
                .instructions { margin: 20px 0; padding: 10px; }
                img { max-width: 500px; height: auto; }
                .marks-right { float: right; margin-left: 10px; }
                .matching-table { width:100%;border-collapse:collapse;margin:8px 0; }
                .matching-table th,.matching-table td { border:1px solid #ccc;padding:6px 10px; }
                .matching-table th { background:#f1f5f9;font-weight:bold; }
            </style>
        </head>
        <body><div class="Section1">`;

    if (logoData) content += `<div class="header"><img src="${logoData}" style="max-width:200px;"></div>`;
    content += `<div class="header"><h2>${document.getElementById('exam-name').value || ''}</h2></div>`;
    content += `<table class="info-table">
        <tr>
            <td width="50%">Student Name: ${document.getElementById('student-name').value || '_________________'}</td>
            <td width="50%">Roll Number: ${document.getElementById('roll-number').value || '_________________'}</td>
        </tr>
        <tr>
            <td>Class & Section: ${document.getElementById('class-name').value || '_________________'}</td>
            <td>Date: ${document.getElementById('test-date').value || '_________________'}</td>
        </tr>
        <tr>
            <td>Duration: ${document.getElementById('test-time').value || '_____'} minutes</td>
            <td>Total Marks: ${document.getElementById('total-marks').value || '_____'}</td>
        </tr>
    </table>`;
    content += `<div class="instructions"><strong>General Instructions:</strong><ol>
        <li>All questions are compulsory.</li>
        <li>Please read each question carefully before answering.</li>
        <li>Write your answers clearly and legibly.</li>
    </ol></div>`;

    const groupedQuestions = {};
    selectedQuestions.forEach(key => {
        let type, chapter, extra;
        if (key.startsWith('custom|')) {
            const cq = customQuestions[key];
            type = cq.type;
            chapter = 'Additional';
            extra = [key];
        } else {
            const parts = key.split('|');
            [type, chapter] = parts;
            extra = parts.slice(2);
        }
        if (!groupedQuestions[type]) groupedQuestions[type] = {};
        if (!groupedQuestions[type][chapter]) groupedQuestions[type][chapter] = [];
        groupedQuestions[type][chapter].push(extra);
    });

    let globalNum = 1;
    Object.entries(groupedQuestions).forEach(([type, chapters]) => {
        Object.entries(chapters).forEach(([chapter, keysArr]) => {
            const qData = questions[chapter] && questions[chapter][type];

            if ((type === 'ar' || type === 'case') && Array.isArray(qData)) {
                qData.forEach((block, blockIdx) => {
                    const selInBlock = keysArr.filter(k => parseInt(k[0]) === blockIdx);
                    if (!selInBlock.length) return;
                    content += `<div class="question">${formatGroupedBlock(type, block, chapter, blockIdx, selInBlock.map(k=>parseInt(k[1])), globalNum)}</div>`;
                    globalNum++;
                });

            } else if (type === 'fillblanks' && Array.isArray(qData)) {
                qData.forEach((block, blockIdx) => {
                    const selInBlock = keysArr.filter(k => parseInt(k[0]) === blockIdx);
                    if (!selInBlock.length) return;
                    const itemIndicesFP = selInBlock.map(k => parseInt(k[1]));
                    const questionKeysFP = itemIndicesFP.map(idx => `fillblanks|${chapter}|${blockIdx}|${idx}`);
                    content += `<div class="question">${formatFillBlanksBlock(block, chapter, blockIdx, itemIndicesFP, globalNum, questionKeysFP)}</div>`;
                    globalNum++;
                });

            } else if (['vshort','short','long','picturebased','grammar','circleodd', 'rewrite', 'miscellaneous', 'tick', 'truefalse'].includes(type) && Array.isArray(qData) && qData[0] && qData[0].items) {
                qData.forEach((block, blockIdx) => {
                    const selInBlock = keysArr.filter(k => parseInt(k[0]) === blockIdx);
                    if (!selInBlock.length) return;
                    content += `<div class="question">${formatGroupedBlock(type, block, chapter, blockIdx, selInBlock.map(k=>parseInt(k[1])), globalNum)}</div>`;
                    globalNum++;
                });

            } else {
                if (chapter === 'Additional') {
                    keysArr.forEach(k => {
                        const customKey = k[0];
                        const cq = customQuestions[customKey];
                        content += `<div class="question">${_renderCustomQuestion(cq, globalNum)}</div>`;
                        globalNum++;
                    });
                } else {
                    keysArr.forEach(k => {
                        const qIdx = parseInt(k[0]);
                        const qObj = qData && qData[qIdx];
                        if (!qObj) return;
                        content += `<div class="question">${formatQuestion(type, qObj, globalNum, chapter)}</div>`;
                        globalNum++;
                    });
                }
            }
        });
    });

    content += `</div></body></html>`;
    const blob = new Blob([content], { type: 'application/msword' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Test_Paper_${document.getElementById('class-name').value || 'Class'}_${new Date().toLocaleDateString()}.doc`;
    link.click();
}

function getAnswerSpace(sectionTitle, item) {
    const qObj = (item && item.questionObj) ? item.questionObj : item;
    if (typeof showAnswers !== 'undefined' && showAnswers && qObj) {
        const ans = qObj.answers || qObj.answer || qObj.correctAnswer || null;
        if (Array.isArray(ans) && ans.length > 0)
            return `<div style="margin:10px 0;"><strong>Answer:</strong> ${ans.join(', ')}</div>`;
        else if (typeof ans === 'string' && ans.trim())
            return `<div style="margin:10px 0;"><strong>Answer:</strong> ${ans}</div>`;
    }
    return '';
}

function calculateTotalMarks() {
    let total = 0;
    for (let key in selectedQuestionsData) {
        if (selectedQuestions.includes(key)) total += selectedQuestionsData[key];
    }
    document.getElementById('total-marks').value = total;
}

let currentStep = 1;
const totalSteps = 3;

function updateStepIndicators() {
    document.querySelectorAll('.step').forEach(step => {
        const stepNum = parseInt(step.dataset.step);
        step.classList.remove('active', 'completed');
        if (stepNum === currentStep) step.classList.add('active');
        else if (stepNum < currentStep) step.classList.add('completed');
    });
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(screenId).style.display = 'block';
    if (screenId === 'chapter-selection') { autoModeConfigState = {}; setTimeout(_refreshDraftBar, 50); }
}

function nextStep() {
    if (currentStep === 1 && selectedChapters.length === 0) { alert('Please select at least one chapter.'); return; }
    if (currentStep < totalSteps) {
        currentStep++;
        updateNavigation();
        switch(currentStep) {
            case 2: showScreen('mode-selection'); break;
            case 3: selectedMode === 'auto' ? showAutoMode() : showQuestions(); break;
        }
    }
}

function previousStep() {
    if (document.getElementById('test-preview').style.display === 'block') {
        selectedMode === 'auto' ? showAutoMode() : showQuestions();
        updateStepIndicators(); updateNavigation(); return;
    }
    if (currentStep > 1) {
        currentStep--;
        updateNavigation();
        switch(currentStep) {
            case 1: showScreen('chapter-selection'); break;
            case 2: selectedMode = ''; showScreen('mode-selection'); break;
        }
    }
}

function updateNavigation() {
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    prevButton.style.display = currentStep === 1 ? 'none' : 'block';
    if (currentStep === 2 || (currentStep === 3 && selectedMode === 'auto')) {
        nextButton.style.display = 'none';
    } else {
        nextButton.textContent = currentStep === totalSteps ? 'Finish' : 'Next';
        nextButton.style.display = currentStep === totalSteps ? 'none' : 'block';
    }
    updateStepIndicators();
}

window.onload = function() {
    showScreen('chapter-selection');
    initializeChapterList();
    document.getElementById('test-date').valueAsDate = new Date();
    updateStepIndicators();
    updateNavigation();
    showWelcomePopup();
};

function showWelcomePopup() { document.querySelector('.popup-overlay').classList.add('active'); }
function hideWelcomePopup() { document.querySelector('.popup-overlay').classList.remove('active'); }

document.querySelector('.popup-close').addEventListener('click', hideWelcomePopup);
document.querySelector('.popup-overlay').addEventListener('click', function(e) { if (e.target === this) hideWelcomePopup(); });

// ── showFinalPreview ──────────────────────────────────────────────────────
function showFinalPreview() {
    // Always recalculate before rendering so header and badge are in sync
    calculateTotalMarks();

    const finalPreviewContent = document.getElementById('final-preview-content');
    const previewPopup = document.querySelector('.preview-popup');

    // Update the live total-marks badge in the preview action bar
    const liveBadge = document.getElementById('preview-live-total');
    if (liveBadge) {
        const tm = document.getElementById('total-marks').value || '0';
        liveBadge.textContent = `Total Marks: ${tm}`;
    }

    // Build the static header HTML (never has action buttons)
    let headerContent = `
        ${logoData ? `<div style="text-align:center;margin-bottom:20px;"><img src="${logoData}" style="max-width:200px;"></div>` : ''}
        <div style="text-align:center;margin-bottom:20px;">
            <h2>${document.getElementById('exam-name').value || ''}</h2>
        </div>
        <table style="width:100%;margin-bottom:20px;border-collapse:collapse;">
            <tr>
                <td style="padding:8px;border:1px solid #ddd;">Student Name: ${document.getElementById('student-name').value || '_________________'}</td>
                <td style="padding:8px;border:1px solid #ddd;">Roll Number: ${document.getElementById('roll-number').value || '_________________'}</td>
            </tr>
            <tr>
                <td style="padding:8px;border:1px solid #ddd;">Class &amp; Section: ${document.getElementById('class-name').value || '_________________'}</td>
                <td style="padding:8px;border:1px solid #ddd;">Date: ${document.getElementById('test-date').value || '_________________'}</td>
            </tr>
            <tr>
                <td style="padding:8px;border:1px solid #ddd;">Duration: ${document.getElementById('test-time').value || '_____'} minutes</td>
                <td style="padding:8px;border:1px solid #ddd;">Total Marks: ${document.getElementById('total-marks').value || '_____'}</td>
            </tr>
        </table>
        <div style="margin:20px 0;padding:10px 20px;background:#f8f9fa;border-left:4px solid #2c3e50;">
            <strong>General Instructions:</strong>
            <ol>
               <li>All questions are compulsory.</li>
               <li>Please read each question carefully before answering.</li>
               <li>Write your answers clearly and legibly.</li>
            </ol>
        </div>`;

    // Build DOM so we can attach real event listeners (action buttons don't work in innerHTML)
    finalPreviewContent.innerHTML = '';

    // Editing hint
    /* const hint = document.createElement('div');
    hint.id = 'preview-edit-hint';
    hint.className = 'no-print';
    hint.textContent = '✏️ Preview directly editable hai — click karke kahi bhi type karo. Images pe hover karo to Replace button dikhe.';
    finalPreviewContent.appendChild(hint); */

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'font-family:Arial,sans-serif;line-height:1.6;padding:0;';
    wrapper.innerHTML = headerContent;
    finalPreviewContent.appendChild(wrapper);

    const groupedQuestions = {};
    selectedQuestions.forEach(key => {
        let type, chapter, extra;
        if (key.startsWith('custom|')) {
            const cq = customQuestions[key];
            type = cq.type;
            chapter = 'Additional';
            extra = [key];
        } else {
            const parts = key.split('|');
            [type, chapter] = parts;
            extra = parts.slice(2);
        }
        if (!groupedQuestions[type]) groupedQuestions[type] = {};
        if (!groupedQuestions[type][chapter]) groupedQuestions[type][chapter] = [];
        groupedQuestions[type][chapter].push(extra);
    });

    let globalNum = 1;

    Object.entries(groupedQuestions).forEach(([type, chapters]) => {
        Object.entries(chapters).forEach(([chapter, keysArr]) => {
            const qData = questions[chapter] && questions[chapter][type];

            if ((type === 'ar' || type === 'case') && Array.isArray(qData)) {
                qData.forEach((block, blockIdx) => {
                    const selInBlock = keysArr.filter(k => parseInt(k[0]) === blockIdx);
                    if (!selInBlock.length) return;
                    const itemIndices = selInBlock.map(k => parseInt(k[1]));
                    const questionKeys = itemIndices.map(idx => `${type}|${chapter}|${blockIdx}|${idx}`);
                    const qDiv = document.createElement('div');
                    qDiv.style.cssText = 'margin-bottom:15px;padding-left:20px;position:relative;';
                    qDiv.innerHTML = formatGroupedBlock(type, block, chapter, blockIdx, itemIndices, globalNum, questionKeys);
                    _appendSubItemActions(qDiv, questionKeys, type, chapter);
                    finalPreviewContent.appendChild(qDiv);
                    globalNum++;
                });
            } else if (type === 'fillblanks' && Array.isArray(qData)) {
                qData.forEach((block, blockIdx) => {
                    const selInBlock = keysArr.filter(k => parseInt(k[0]) === blockIdx);
                    if (!selInBlock.length) return;
                    const itemIndices = selInBlock.map(k => parseInt(k[1]));
                    const questionKeys = itemIndices.map(idx => `fillblanks|${chapter}|${blockIdx}|${idx}`);
                    const qDiv = document.createElement('div');
                    qDiv.style.cssText = 'margin-bottom:15px;padding-left:20px;position:relative;';
                    qDiv.innerHTML = formatFillBlanksBlock(block, chapter, blockIdx, itemIndices, globalNum, questionKeys);
                    _appendSubItemActions(qDiv, questionKeys, 'fillblanks', chapter);
                    finalPreviewContent.appendChild(qDiv);
                    globalNum++;
                });
            } else if (['vshort','short','long','picturebased','grammar','circleodd', 'rewrite', 'miscellaneous', 'tick', 'truefalse'].includes(type) && Array.isArray(qData) && qData[0] && qData[0].items) {
                qData.forEach((block, blockIdx) => {
                    const selInBlock = keysArr.filter(k => parseInt(k[0]) === blockIdx);
                    if (!selInBlock.length) return;
                    const itemIndices = selInBlock.map(k => parseInt(k[1]));
                    const questionKeys = itemIndices.map(idx => `${type}|${chapter}|${blockIdx}|${idx}`);
                    const qDiv = document.createElement('div');
                    qDiv.style.cssText = 'margin-bottom:15px;padding-left:20px;position:relative;';
                    qDiv.innerHTML = formatGroupedBlock(type, block, chapter, blockIdx, itemIndices, globalNum, questionKeys);
                    _appendSubItemActions(qDiv, questionKeys, type, chapter);
                    finalPreviewContent.appendChild(qDiv);
                    globalNum++;
                });
            } else {
                if (chapter === 'Additional') {
                    keysArr.forEach(k => {
                        const customKey = k[0];
                        const cq = customQuestions[customKey];
                        const qDiv = document.createElement('div');
                        qDiv.style.cssText = 'margin-bottom:15px;padding-left:20px;position:relative;';
                        qDiv.dataset.qkey = customKey;
                        qDiv.innerHTML = _renderCustomQuestion(cq, globalNum);
                        _appendFinalActionsForCustom(qDiv, customKey);
                        finalPreviewContent.appendChild(qDiv);
                        globalNum++;
                    });
                } else {
                    keysArr.forEach(k => {
                        const qIdx = parseInt(k[0]);
                        const qObj = qData && qData[qIdx];
                        if (!qObj) return;
                        const questionKey = `${type}|${chapter}|${qIdx}`;
                        const qDiv = document.createElement('div');
                        qDiv.style.cssText = 'margin-bottom:15px;padding-left:20px;position:relative;';
                        qDiv.dataset.qkey = questionKey;
                        qDiv.innerHTML = formatQuestion(type, qObj, globalNum, chapter, questionKey);
                        _appendFinalActions(qDiv, questionKey, [questionKey], type, chapter);
                        finalPreviewContent.appendChild(qDiv);
                        globalNum++;
                    });
                }
            }
        });
    });

    // Make the preview fully editable (direct inline editing)
    finalPreviewContent.contentEditable = 'true';
    finalPreviewContent.style.outline = 'none';
    finalPreviewContent.style.minHeight = '200px';

    // Inject Replace buttons next to every image
    _injectImageReplaceButtons(finalPreviewContent);

    previewPopup.classList.add('active');
}

// ── Inject "Replace" buttons + Resize handle next to every <img> in the preview ──────────
function _injectImageReplaceButtons(container) {
    // Remove any previously injected wrappers to avoid duplicates
    container.querySelectorAll('.img-replace-wrapper').forEach(w => {
        const img = w.querySelector('img');
        if (img) w.parentNode.insertBefore(img, w);
        w.remove();
    });

    container.querySelectorAll('img').forEach(img => {
        // Skip logo / button icons
        if (img.closest('.no-print') || img.closest('.preview-actions')) return;
        // Already wrapped?
        if (img.parentNode.classList && img.parentNode.classList.contains('img-replace-wrapper')) return;

        // Create wrapper
        const wrap = document.createElement('span');
        wrap.className = 'img-replace-wrapper no-print-unwrap';
        wrap.style.cssText = 'position:relative;display:inline-block;';
        img.parentNode.insertBefore(wrap, img);
        wrap.appendChild(img);

        // Hidden file input
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        fileInput.onchange = function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        };
        wrap.appendChild(fileInput);

        // Replace button (top-left corner)
        const replaceBtn = document.createElement('button');
        replaceBtn.textContent = '🔄';
        replaceBtn.title = 'Replace Image';
        replaceBtn.className = 'img-replace-btn no-print';
        replaceBtn.contentEditable = 'false';
        replaceBtn.style.cssText = `
            position:absolute;top:4px;left:4px;
            background:rgba(52,152,219,0.92);color:#fff;
            border:none;border-radius:50%;width:32px;height:32px;
            font-size:1.1em;cursor:pointer;
            box-shadow:0 2px 6px rgba(0,0,0,0.25);
            opacity:0;transition:opacity .2s;
            pointer-events:auto;z-index:10;
        `;
        replaceBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            fileInput.click();
        };
        wrap.appendChild(replaceBtn);

        // Resize handle (bottom-right corner)
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'img-resize-handle no-print';
        resizeHandle.contentEditable = 'false';
        resizeHandle.style.cssText = `
            position:absolute;bottom:0;right:0;
            width:20px;height:20px;
            background:rgba(46,204,113,0.9);
            cursor:se-resize;
            border-radius:2px 0 4px 0;
            opacity:0;transition:opacity .2s;
            pointer-events:auto;z-index:10;
            border:1px solid rgba(26,188,156,1);
        `;

        let isResizing = false;
        let startX, startY, startWidth, startHeight, aspectRatio;

        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = img.offsetWidth;
            startHeight = img.offsetHeight;
            aspectRatio = startWidth / startHeight;
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            const delta = Math.max(deltaX, deltaY);
            
            let newWidth = Math.max(50, startWidth + delta);
            let newHeight = newWidth / aspectRatio;
            
            img.style.width = newWidth + 'px';
            img.style.height = newHeight + 'px';
            img.style.maxWidth = 'none';
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.userSelect = '';
        });

        wrap.appendChild(resizeHandle);

        // Show buttons on hover
        wrap.addEventListener('mouseenter', () => {
            replaceBtn.style.opacity = '1';
            resizeHandle.style.opacity = '1';
        });
        wrap.addEventListener('mouseleave', () => {
            replaceBtn.style.opacity = '0';
            resizeHandle.style.opacity = '0';
        });
    });
}

// ── Render a custom question as HTML string ───────────────────────────────
function _renderCustomQuestion(cq, num) {
    let html = `${mainLabel(num)} ${renderFractions(cq.text || '')} <span style="float:right;color:#555;font-size:0.85em;">[${cq.marks || 1} marks]</span><br>`;
    if (cq.type === 'picturebased' && cq.imageData) {
        html += `<div style="margin:10px 0;"><img src="${cq.imageData}" alt="Question Image"
            style="max-width:100%;max-height:280px;border-radius:6px;border:1px solid #ddd;display:block;"></div>`;
    }
    if (cq.type === 'matching' && cq.options && cq.options.length) {
        const hasImageOption = cq.options.some(opt => /<img\b/i.test(opt));
        if (hasImageOption && cq.options.length <= 2) {
            html += cq.options.map(opt => `<div>${renderFractions(opt)}</div>`).join('');
        } else {
            const colA = cq.options[0] || 'Column A';
            const colB = cq.options[1] || 'Column B';
            const pairs = cq.options.slice(2);
            const leftItems = pairs.filter((_, i) => i % 2 === 0);
            const rightItems = pairs.filter((_, i) => i % 2 === 1);
            html += `<table class="matching-table">`;
            if (!hasImageOption) {
                html += `<tr><th>${renderFractions(colA)}</th><th>${renderFractions(colB)}</th></tr>`;
            }
            for (let i = 0; i < leftItems.length; i++) {
                html += `<tr><td>${renderFractions(leftItems[i])}</td><td>${renderFractions(rightItems[i] || '')}</td></tr>`;
            }
            html += `</table>`;
        }
    }
    if (cq.type === 'mcq' && cq.options && cq.options.length) {
        html += cq.options.map((opt, i) => `&nbsp;&nbsp;&nbsp;${hindiLabel(i)} ${renderFractions(opt)}`).join('<br>');
    }
    if (showAnswers && cq.answer) {
        html += `<br><span style="color:#1a7a4a;"><strong>Ans:</strong> ${cq.answer}</span>`;
    }
    return html;
}

// ── Append action buttons to a question div in the FINAL PREVIEW ──────────
function _appendFinalActions(element, primaryKey, questionKeys, type, chapter) {
    if (typeof showAnswers !== 'undefined' && showAnswers) return;

    // Wrap existing content in a flex row so buttons sit on the right
    const inner = document.createElement('div');
    inner.className = 'fp-question-inner';
    inner.style.cssText = 'display:flex;align-items:flex-start;gap:10px;';

    const contentWrap = document.createElement('div');
    contentWrap.style.cssText = 'flex:1;min-width:0;';
    contentWrap.innerHTML = element.innerHTML;
    element.innerHTML = '';

    const btnCol = document.createElement('div');
    btnCol.className = 'fp-btn-col no-print';
    btnCol.style.cssText = 'display:flex;flex-direction:column;gap:5px;flex-shrink:0;padding-top:2px;';

    const mkBtn = (label, cls, cb) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = `fp-btn fp-${cls} no-print`;
        b.onclick = e => { e.stopPropagation(); cb(); };
        return b;
    };

    /* btnCol.appendChild(mkBtn('✏ Edit', 'edit', () => openEditModal(primaryKey, questionKeys))); */
    /* btnCol.appendChild(mkBtn('🔄 Replace', 'replace', () => openReplaceModal(primaryKey, type, chapter))); */
    btnCol.appendChild(mkBtn('🗑 Remove', 'remove', () => {
        removePreviewQuestion(questionKeys);
        showFinalPreview();
    }));

    inner.appendChild(contentWrap);
    inner.appendChild(btnCol);
    element.appendChild(inner);
}

// ── Append action buttons for CUSTOM questions in final preview ───────────
function _appendFinalActionsForCustom(element, customKey) {
    if (typeof showAnswers !== 'undefined' && showAnswers) return;

    const inner = document.createElement('div');
    inner.className = 'fp-question-inner';
    inner.style.cssText = 'display:flex;align-items:flex-start;gap:10px;';

    const contentWrap = document.createElement('div');
    contentWrap.style.cssText = 'flex:1;min-width:0;';
    contentWrap.innerHTML = element.innerHTML;
    element.innerHTML = '';

    const btnCol = document.createElement('div');
    btnCol.className = 'fp-btn-col no-print';
    btnCol.style.cssText = 'display:flex;flex-direction:column;gap:5px;flex-shrink:0;padding-top:2px;';

    const mkBtn = (label, cls, cb) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = `fp-btn fp-${cls} no-print`;
        b.onclick = e => { e.stopPropagation(); cb(); };
        return b;
    };

    /* btnCol.appendChild(mkBtn('✏ Edit', 'edit', () => openCustomEditModal(customKey))); */
    btnCol.appendChild(mkBtn('🗑 Remove', 'remove', () => {
        delete customQuestions[customKey];
        showFinalPreview();
    }));

    inner.appendChild(contentWrap);
    inner.appendChild(btnCol);
    element.appendChild(inner);
}


// ── _appendSubItemActions ─────────────────────────────────────────────────
// Attaches individual Edit / Replace / Remove buttons to each sub-item row
// (क)(ख)(ग)... within a grouped block (fillblanks, vshort, short, long etc.)
function _appendSubItemActions(blockDiv, questionKeys, type, chapter) {
    if (typeof showAnswers !== 'undefined' && showAnswers) return;
    const rows = blockDiv.querySelectorAll('.sub-item-row');

    const mkSubBtn = (label, cls, cb) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = `sub-item-btn sub-item-${cls} no-print`;
        b.onclick = e => { e.stopPropagation(); cb(); };
        return b;
    };

    if (rows.length > 0) {
        // Normal case: sub-item rows exist — attach buttons to each row
        rows.forEach((row, idx) => {
            const key = row.dataset.subkey || questionKeys[idx];
            const subType = row.dataset.subtype || type;
            const subChapter = row.dataset.subchapter || chapter;
            if (!key) return;
            const actionsDiv = row.querySelector('.sub-item-actions');
            if (!actionsDiv) return;

            /* actionsDiv.appendChild(mkSubBtn('✏ Edit', 'edit', () => openEditModal(key, [key]))); */
            /* actionsDiv.appendChild(mkSubBtn('🔄 Replace', 'replace', () => openReplaceModal(key, subType, subChapter))); */
            actionsDiv.appendChild(mkSubBtn('🗑 Remove', 'remove', () => {
                removePreviewQuestion([key]);
                showFinalPreview();
            }));
        });
    } else {
        // Fallback: no sub-item rows (single question / no sub-parts) —
        // wrap the existing block content in a flex row so buttons sit to the right
        if (!questionKeys || !questionKeys.length) return;
        const primaryKey = questionKeys[0];

        const inner = document.createElement('div');
        inner.className = 'fp-question-inner';
        inner.style.cssText = 'display:flex;align-items:flex-start;gap:10px;';

        const contentWrap = document.createElement('div');
        contentWrap.style.cssText = 'flex:1;min-width:0;';
        contentWrap.innerHTML = blockDiv.innerHTML;

        const btnCol = document.createElement('div');
        btnCol.className = 'fp-btn-col no-print';
        btnCol.style.cssText = 'display:flex;flex-direction:column;gap:5px;flex-shrink:0;padding-top:2px;';
        /* btnCol.appendChild(mkSubBtn('✏ Edit', 'edit', () => openEditModal(primaryKey, questionKeys))); */
        btnCol.appendChild(mkSubBtn('🗑 Remove', 'remove', () => {
            removePreviewQuestion(questionKeys);
            showFinalPreview();
        }));

        inner.appendChild(contentWrap);
        inner.appendChild(btnCol);
        blockDiv.innerHTML = '';
        blockDiv.appendChild(inner);
    }
}

// ── (saveEditedQuestion is defined near the top of this file) ────────────

// ── Custom Question Modal Functions ──────────────────────────────────────
function openAddQuestionModal() {
    document.getElementById('add-q-modal').classList.add('active');
    _resetAddQuestionForm();
}

function closeAddQuestionModal() {
    document.getElementById('add-q-modal').classList.remove('active');
    _customImageData = '';
}

function _resetAddQuestionForm() {
    _customImageData = '';
    document.getElementById('add-q-type').value = 'mcq';
    document.getElementById('add-q-text').value = '';
    document.getElementById('add-q-marks').value = 1;
    document.getElementById('add-q-answer').value = '';
    _renderAddQuestionOptions();
}

function _renderAddQuestionOptions() {
    const type = document.getElementById('add-q-type').value;
    const optContainer = document.getElementById('add-q-options-area');
    optContainer.innerHTML = '';

    if (type === 'mcq') {
        optContainer.innerHTML = `
            <label style="font-weight:600;display:block;margin-bottom:6px;">Options (MCQ)</label>
            ${['A','B','C','D'].map((l,i) => `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="font-weight:bold;min-width:20px;">${l})</span>
                    <input type="text" id="add-q-opt-${i}" placeholder="Option ${l}" style="flex:1;padding:6px;border:1px solid #ccc;border-radius:4px;">
                </div>`).join('')}`;

    } else if (type === 'truefalse') {
        optContainer.innerHTML = `
            <label style="font-weight:600;display:block;margin-bottom:6px;">Answer</label>
            <select id="add-q-tf-ans" style="padding:6px;border:1px solid #ccc;border-radius:4px;width:100%;">
                <option value="सही ">सही</option>
                <option value="गलत ">गलत</option>
            </select>`;

    } else if (type === 'matching') {
        optContainer.innerHTML = `
            <label style="font-weight:600;display:block;margin-bottom:6px;">Match the Following</label>
            <div style="display:flex;gap:10px;margin-bottom:10px;">
                <input type="text" id="add-q-matching-col-a" placeholder="Column A" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:4px;">
                <input type="text" id="add-q-matching-col-b" placeholder="Column B" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:4px;">
            </div>
            <div id="add-q-matching-rows"></div>
            <button type="button" onclick="_addAddMatchingRow()" style="margin-top:10px;padding:8px 14px;border:none;border-radius:6px;background:#3498db;color:#fff;cursor:pointer;">+ Add Row</button>`;
        _addAddMatchingRow();
        _addAddMatchingRow();

    } else if (type === 'picturebased') {
        optContainer.innerHTML = `
            <label style="font-weight:600;display:block;margin-bottom:6px;">📷 Upload Image for Question</label>
            <div id="add-q-img-drop" style="
                border:2px dashed #3498db;border-radius:8px;padding:20px;text-align:center;
                cursor:pointer;background:#f0f8ff;transition:background .2s;position:relative;">
                <input type="file" id="add-q-img-input" accept="image/*"
                    style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;"
                    onchange="_handleCustomImageUpload(event)">
                <div id="add-q-img-placeholder" style="color:#3498db;pointer-events:none;">
                    <div style="font-size:2em;margin-bottom:6px;">🖼</div>
                    <div style="font-weight:600;">Click or drag an image here</div>
                    <div style="font-size:0.82em;color:#888;margin-top:4px;">PNG, JPG, GIF supported</div>
                </div>
                <img id="add-q-img-preview" src="" alt="Preview"
                    style="display:none;max-width:100%;max-height:220px;border-radius:6px;margin-top:6px;pointer-events:none;">
            </div>
            <div id="add-q-img-remove-row" style="display:none;margin-top:6px;text-align:right;">
                <button type="button" onclick="_clearCustomImage()"
                    style="font-size:0.8em;padding:3px 10px;border:1px solid #e74c3c;color:#e74c3c;
                           background:#fff;border-radius:4px;cursor:pointer;">✕ Remove Image</button>
            </div>`;
    }
}

function _addAddMatchingRow(left = '', right = '') {
    const rowsWrapper = document.getElementById('add-q-matching-rows');
    if (!rowsWrapper) return;
    const row = document.createElement('div');
    row.className = 'add-matching-row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.marginBottom = '8px';
    row.innerHTML = `
        <input type="text" class="add-matching-left" placeholder="Left item" value="${left}" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:4px;">
        <input type="text" class="add-matching-right" placeholder="Right item" value="${right}" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:4px;">
        <button type="button" style="padding:6px 10px;border:none;border-radius:6px;background:#e74c3c;color:#fff;cursor:pointer;">✕</button>`;
    row.querySelector('button')?.addEventListener('click', () => row.remove());
    rowsWrapper.appendChild(row);
}

// ── Custom image upload helpers ───────────────────────────────────────────
let _customImageData = ''; // base64 data URL

function _handleCustomImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        _customImageData = e.target.result;
        const preview = document.getElementById('add-q-img-preview');
        const placeholder = document.getElementById('add-q-img-placeholder');
        const removeRow = document.getElementById('add-q-img-remove-row');
        const drop = document.getElementById('add-q-img-drop');
        if (preview) { preview.src = _customImageData; preview.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
        if (removeRow) removeRow.style.display = 'block';
        if (drop) drop.style.background = '#eaffea';
    };
    reader.readAsDataURL(file);
}

function _clearCustomImage() {
    _customImageData = '';
    const preview = document.getElementById('add-q-img-preview');
    const placeholder = document.getElementById('add-q-img-placeholder');
    const removeRow = document.getElementById('add-q-img-remove-row');
    const drop = document.getElementById('add-q-img-drop');
    const input = document.getElementById('add-q-img-input');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'block';
    if (removeRow) removeRow.style.display = 'none';
    if (drop) drop.style.background = '#f0f8ff';
    if (input) input.value = '';
}

function _handleEditImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        _editImageData = e.target.result;
        const preview = document.getElementById('edit-img-preview');
        const placeholder = document.getElementById('edit-img-placeholder');
        const removeRow = document.getElementById('edit-img-remove-row');
        const drop = document.getElementById('edit-img-drop');
        if (preview) { preview.src = _editImageData; preview.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
        if (removeRow) removeRow.style.display = 'block';
        if (drop) drop.style.background = '#eaffea';
    };
    reader.readAsDataURL(file);
}

function _clearEditImage() {
    _editImageData = '';
    const preview = document.getElementById('edit-img-preview');
    const placeholder = document.getElementById('edit-img-placeholder');
    const removeRow = document.getElementById('edit-img-remove-row');
    const drop = document.getElementById('edit-img-drop');
    const input = document.getElementById('edit-img-input');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'block';
    if (removeRow) removeRow.style.display = 'none';
    if (drop) drop.style.background = '#f0f8ff';
    if (input) input.value = '';
}

function _renderEditMatchingOptions(options) {
    const rowsWrapper = document.getElementById('edit-matching-rows');
    const colAInput = document.getElementById('edit-matching-col-a');
    const colBInput = document.getElementById('edit-matching-col-b');
    rowsWrapper.innerHTML = '';

    const colA = options[0] || 'Column A';
    const colB = options[1] || 'Column B';
    if (colAInput) colAInput.value = htmlToPlainEditText(extractImgTagsFromHtml(colA).text);
    if (colBInput) colBInput.value = htmlToPlainEditText(extractImgTagsFromHtml(colB).text);

    const pairs = options.slice(2);
    for (let i = 0; i < pairs.length; i += 2) {
        _addEditMatchingRow(pairs[i] || '', pairs[i + 1] || '');
    }
    if (!pairs.length) {
        _addEditMatchingRow('', '');
        _addEditMatchingRow('', '');
    }
}

function _addEditMatchingRow(left = '', right = '') {
    const rowsWrapper = document.getElementById('edit-matching-rows');
    if (!rowsWrapper) return;
    const row = document.createElement('div');
    row.className = 'edit-matching-row';
    row.style.display = 'flex';
    row.style.gap = '10px';
    row.style.alignItems = 'center';
    row.style.marginBottom = '8px';
    const leftIn = document.createElement('input');
    leftIn.type = 'text';
    leftIn.className = 'edit-matching-left';
    leftIn.placeholder = 'Left item';
    leftIn.value = htmlToPlainEditText(extractImgTagsFromHtml(left).text);
    leftIn.style.cssText = 'flex:1;padding:8px;border:1px solid #ccc;border-radius:6px;';
    const rightIn = document.createElement('input');
    rightIn.type = 'text';
    rightIn.className = 'edit-matching-right';
    rightIn.placeholder = 'Right item';
    rightIn.value = htmlToPlainEditText(extractImgTagsFromHtml(right).text);
    rightIn.style.cssText = 'flex:1;padding:8px;border:1px solid #ccc;border-radius:6px;';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'edit-matching-remove';
    rm.textContent = '✕';
    rm.style.cssText = 'padding:6px 10px;border:none;border-radius:6px;background:#e74c3c;color:#fff;cursor:pointer;';
    rm.onclick = () => row.remove();
    row.appendChild(leftIn);
    row.appendChild(rightIn);
    row.appendChild(rm);
    rowsWrapper.appendChild(row);
}

function _collectEditMatchingOptions() {
    const colA = plainEditToStoredQuestionHtml(document.getElementById('edit-matching-col-a')?.value.trim() || 'Column A');
    const colB = plainEditToStoredQuestionHtml(document.getElementById('edit-matching-col-b')?.value.trim() || 'Column B');
    const rows = Array.from(document.querySelectorAll('#edit-matching-rows .edit-matching-row'));
    const options = [colA, colB];
    rows.forEach(row => {
        const left = plainEditToStoredQuestionHtml(row.querySelector('.edit-matching-left')?.value.trim() || '');
        const right = plainEditToStoredQuestionHtml(row.querySelector('.edit-matching-right')?.value.trim() || '');
        if (left || right) {
            options.push(left, right);
        }
    });
    return options;
}

function _replaceQuestionImageInHtml(html, imageUrl) {
    if (!html) return html;
    if (!/<img[^>]*>/i.test(html)) {
        return `<img src="${imageUrl}" class="question-image"><br>` + html;
    }
    return html.replace(/<img[^>]*src=["'][^"']+["'][^>]*>/i, `<img src="${imageUrl}" class="question-image">`);
}

function saveCustomQuestion() {
    const type = document.getElementById('add-q-type').value;
    const text = document.getElementById('add-q-text').value.trim();
    const marks = parseInt(document.getElementById('add-q-marks').value) || 1;
    let answer = document.getElementById('add-q-answer').value.trim();
    let options = [];
    let imageData = '';

    if (!text) { alert('Please enter the question text.'); return; }

    if (type === 'mcq') {
        options = ['A','B','C','D'].map((_,i) => (document.getElementById(`add-q-opt-${i}`)?.value || '').trim()).filter(Boolean);
        if (options.length < 2) { alert('Please enter at least 2 MCQ options.'); return; }
    } else if (type === 'matching') {
        const colA = document.getElementById('add-q-matching-col-a')?.value.trim() || 'Column A';
        const colB = document.getElementById('add-q-matching-col-b')?.value.trim() || 'Column B';
        const rows = Array.from(document.querySelectorAll('#add-q-matching-rows .add-matching-row'));
        options = [colA, colB];
        rows.forEach(row => {
            const left = row.querySelector('.add-matching-left')?.value.trim() || '';
            const right = row.querySelector('.add-matching-right')?.value.trim() || '';
            if (left || right) {
                options.push(left, right);
            }
        });
    } else if (type === 'truefalse') {
        answer = document.getElementById('add-q-tf-ans')?.value || 'True';
    } else if (type === 'picturebased') {
        imageData = _customImageData || '';
        _customImageData = ''; // reset after capture
    }

    const key = `custom|${++customQuestionCounter}`;
    customQuestions[key] = { type, text, marks, options, answer, imageData };

    selectedQuestions.push(key);
    selectedQuestionsData[key] = marks;
    calculateTotalMarks();

    closeAddQuestionModal();
    if (document.querySelector('.preview-popup.active')) {
        showFinalPreview();
    } else {
        showPreview();
    }
}

function openCustomEditModal(customKey) {
    const cq = customQuestions[customKey];
    if (!cq) return;
    const modal = document.getElementById('edit-modal');
    modal.dataset.isCustom = '1';
    openEditModal(customKey);
}

function closeFinalPreview() { document.querySelector('.preview-popup').classList.remove('active'); }

function printPreview(withAnswers) {
    const fpc = document.getElementById('final-preview-content');

    // ── Answer elements: inject ya remove karo in-place ─────────────────
    // Previously injected answer rows hataao
    fpc.querySelectorAll('.inline-ans-row').forEach(el => el.remove());

    if (withAnswers) {
        // Har question div mein answer dhundho aur inject karo
        selectedQuestions.forEach(key => {
            let ansText = '';
            if (key.startsWith('custom|')) {
                const cq = customQuestions[key];
                ansText = (cq && cq.answer) || '';
            } else {
                const info = parseQuestionKey(key);
                const ed = editedQuestions[key] || {};
                if (ed.answer !== undefined && ed.answer !== '') {
                    ansText = ed.answer;
                } else {
                    const qData = questions[info.chapter] && questions[info.chapter][info.type];
                    if (info.idx !== undefined) {
                        const qObj = qData && qData[info.idx];
                        const raw = qObj && (qObj.answer || qObj.answers || qObj.correctAnswer);
                        ansText = Array.isArray(raw) ? raw.join(', ') : (raw || '');
                    } else if (info.blockIdx !== undefined) {
                        const block = qData && qData[info.blockIdx];
                        const subList = block && (block.items || block.questions || []);
                        const item = subList && subList[info.itemIdx];
                        const raw = item && (item.answer || item.answers || item.correctAnswer);
                        ansText = Array.isArray(raw) ? raw.join(', ') : (raw || '');
                    }
                }
            }
            if (!ansText) return;

            // DOM mein is key ka element dhundho
            const el = fpc.querySelector(`[data-subkey="${key}"]`) ||
                       fpc.querySelector(`[data-qkey="${key}"]`);
            if (el) {
                const ansDiv = document.createElement('div');
                ansDiv.className = 'inline-ans-row';
                ansDiv.style.cssText = 'color:#1a7a4a;font-size:0.9em;margin:10px 0 6px 20px;padding-left:10px;';
                ansDiv.innerHTML = `<strong>Ans:</strong> ${ansText}`;
                el.parentNode.insertBefore(ansDiv, el.nextSibling);
            }
        });
    }

    // ── img-replace-wrappers temporarily unwrap karo (clean print) ──────
    fpc.querySelectorAll('.img-replace-wrapper').forEach(w => {
        const img = w.querySelector('img');
        if (img) w.parentNode.insertBefore(img, w);
        w.remove();
    });

    // ── Current DOM snapshot (saari edits preserved) ─────────────────────
    const printContent = fpc.innerHTML;

    // ── Restore: answer rows hataao, wrappers restore karo ───────────────
    fpc.querySelectorAll('.inline-ans-row').forEach(el => el.remove());
    _injectImageReplaceButtons(fpc);

    const printWindow = window.open('', '', 'height=800,width=800');
    printWindow.document.write(`<html><head><style>
        body { font-family: Arial, sans-serif; line-height: 1.6; padding: 10px 25px; font-size: 16px; }
        .marks-right { float: right; }
        img { max-width: 100%; height: auto; margin-top: 10px; }
        .question-image { max-width: 100%; height: auto; margin-top: 10px; }
        .matching-table { width:100%;border-collapse:collapse;margin:8px 0; }
        .matching-table th,.matching-table td { border:1px solid #ccc;padding:6px 10px;text-align:left; }
        .matching-table th { background:#f1f5f9;font-weight:bold; }
        table { width:100%;border-collapse:collapse; }
        td { padding:8px;border:1px solid #ddd; }
        .fp-btn-col, .fp-action-bar, .fp-btn, .no-print,
        .img-replace-btn, .img-replace-wrapper button,
        .sub-item-btn, .sub-item-actions,
        #preview-edit-hint { display: none !important; }
        .fp-question-inner { display: block !important; }
        [contenteditable] { outline: none !important; }
    </style></head><body>${printContent}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 500);
}

let selectedMode = '';
let autoModeConfigState = {};

function selectMode(mode) {
    selectedMode = mode;
    currentStep = 3;
    selectedQuestions = [];
    selectedQuestionsData = {};
    updateNavigation();
    mode === 'auto' ? showAutoMode() : showQuestions();
}

function showAutoMode() {
    const autoModeScreen = document.getElementById('auto-mode');
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    autoModeScreen.style.display = 'block';

    const configContainer = document.getElementById('auto-question-config');
    configContainer.className = 'auto-config-container';
    configContainer.innerHTML = '';

    const combinedQuestions = {};
    selectedChapters.forEach(chapter => {
        Object.entries(questions[chapter]).forEach(([type, qList]) => {
            if (!combinedQuestions[type]) combinedQuestions[type] = [];
            combinedQuestions[type].push(...qList);
        });
    });

    Object.entries(combinedQuestions).forEach(([type, questionsList]) => {
        let totalQuestions;
        if ((type === 'ar' || type === 'case') && Array.isArray(questionsList)) {
            totalQuestions = questionsList.reduce((s, b) => s + (b.questions ? b.questions.length : 0), 0);
        } else if ((type === 'fillblanks' || ['vshort','short','long','picturebased','grammar','circleodd', 'rewrite', 'miscellaneous', 'tick', 'truefalse'].includes(type)) && Array.isArray(questionsList) && questionsList[0] && questionsList[0].items) {
            totalQuestions = questionsList.reduce((s, b) => s + (b.items ? b.items.length : 0), 0);
        } else {
            totalQuestions = questionsList.length;
        }

        const typeTitle = getQuestionTypeTitle(type);
        const defaultMarks = type === 'matching' || type === 'long' ? 5 : ['short','circleodd','rewrite','miscellaneous'].includes(type) ? 2 : 1;
        const typeConfig = document.createElement('div');
        typeConfig.className = 'question-type-config';

        let prevCount = autoModeConfigState[type]?.count ?? Math.min(1, totalQuestions);
        let prevMarks = autoModeConfigState[type]?.marks ?? defaultMarks;

        const dropdownOptions = Array.from({length: totalQuestions + 1}, (_, i) =>
            `<option value="${i}" ${i === prevCount ? 'selected' : ''}>${i}</option>`).join('');

        typeConfig.innerHTML = `
            <div class="question-type-info">${typeTitle}</div>
            <div class="question-type-controls">
                <label>Select: <select class="question-count" data-type="${type}">${dropdownOptions}</select></label>
                <label>Marks each: <input type="number" min="1" value="${prevMarks}" class="marks-count" data-type="${type}"></label>
            </div>`;
        configContainer.appendChild(typeConfig);
    });

    configContainer.querySelectorAll('.question-count, .marks-count').forEach(input => {
        input.addEventListener('change', function() {
            const type = this.dataset.type;
            const count = parseInt(configContainer.querySelector(`.question-count[data-type="${type}"]`).value);
            const marks = parseInt(configContainer.querySelector(`.marks-count[data-type="${type}"]`).value);
            autoModeConfigState[type] = { count, marks };
        });
    });

    const previewBtn = document.getElementById('auto-preview-btn');
    if (previewBtn) {
        previewBtn.style.display = 'inline-block';
        previewBtn.onclick = () => generateAutoQuestions(true);
    }
}

function generateAutoQuestions(isAutoPreview) {
    selectedQuestions = [];
    selectedQuestionsData = {};
    const questionPool = {};

    selectedChapters.forEach(chapter => {
        Object.entries(questions[chapter] || {}).forEach(([type, qList]) => {
            if (!questionPool[type]) questionPool[type] = [];
            if ((type === 'ar' || type === 'case') && Array.isArray(qList)) {
                qList.forEach((block, blockIdx) => {
                    (block.questions || []).forEach((qObj, subIdx) => {
                        questionPool[type].push({ chapter, blockIdx, subIdx, qObj });
                    });
                });
            } else if ((type === 'fillblanks' || ['vshort','short','long','picturebased','grammar','circleodd', 'rewrite', 'miscellaneous', 'tick', 'truefalse'].includes(type)) && Array.isArray(qList) && qList[0] && qList[0].items) {
                qList.forEach((block, blockIdx) => {
                    (block.items || []).forEach((item, itemIdx) => {
                        questionPool[type].push({ chapter, blockIdx, itemIdx, item });
                    });
                });
            } else {
                qList.forEach((qObj, idx) => questionPool[type].push({ chapter, index: idx, qObj }));
            }
        });
    });

    let hasSelected = false;
    document.querySelectorAll('.question-count').forEach(input => {
        const type = input.dataset.type;
        const count = parseInt(input.value);
        const marks = parseInt(input.closest('.question-type-controls').querySelector('.marks-count').value);
        if (count > 0 && questionPool[type]) {
            hasSelected = true;
            shuffleArray([...questionPool[type]]).slice(0, count).forEach(obj => {
                let key;
                if ((type === 'ar' || type === 'case') && obj.subIdx !== undefined) {
                    key = `${type}|${obj.chapter}|${obj.blockIdx}|${obj.subIdx}`;
                } else if (obj.itemIdx !== undefined) {
                    key = `${type}|${obj.chapter}|${obj.blockIdx}|${obj.itemIdx}`;
                } else {
                    key = `${type}|${obj.chapter}|${obj.index}`;
                }
                selectedQuestions.push(key);
                selectedQuestionsData[key] = marks;
            });
        }
    });

    if (hasSelected) {
        calculateTotalMarks();
        if (isAutoPreview) {
            showFinalPreview();
        } else {
            showPreview();
        }
        currentStep = 3;
        updateStepIndicators();
        updateNavigation();
    } else {
        alert('Please select at least one question to generate.');
    }
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function generateManualQuestions() {
    if (selectedQuestions.length === 0) { alert('Please select at least one question.'); return; }
    calculateTotalMarks(); showPreview(); currentStep = 3;
    updateStepIndicators(); updateNavigation();
}

function displayQuestion(question) {
    let questionHTML = `<div class="question">`;
    if (question.image) questionHTML += `<img src="${question.image}" alt="Question Image" class="question-image">`;
}

document.addEventListener('DOMContentLoaded', function() {
    var helpBtn = document.getElementById('help-btn');
    if (helpBtn) helpBtn.onclick = function() { document.querySelector('.popup-overlay').classList.add('active'); };
});
// ══════════════════════════════════════════════════════════════════════════════
// DRAFT SAVE / LOAD  ──  localStorage key: "testGeneratorDraft"
// ══════════════════════════════════════════════════════════════════════════════

const DRAFT_KEY = 'testGeneratorDraft';

/**
 * Gather all current state and persist it to localStorage.
 * Called from the "💾 Save Draft" button inside the preview popup.
 */
function saveDraft() {
    try {
        const draft = {
            savedAt: new Date().toISOString(),
            // ── selection state ──────────────────────────────────────────────
            selectedChapters:     selectedChapters.slice(),
            selectedQuestions:    selectedQuestions.slice(),
            selectedQuestionsData: JSON.parse(JSON.stringify(selectedQuestionsData)),
            selectedMode:         selectedMode,
            editedQuestions:      JSON.parse(JSON.stringify(editedQuestions)),
            customQuestions:      JSON.parse(JSON.stringify(customQuestions)),
            customQuestionCounter: customQuestionCounter,
            autoModeConfigState:  JSON.parse(JSON.stringify(autoModeConfigState)),
            logoData:             logoData,
            // ── header / exam info fields ────────────────────────────────────
            examName:    document.getElementById('exam-name')?.value  || '',
            className:   document.getElementById('class-name')?.value || '',
            testTime:    document.getElementById('test-time')?.value  || '',
            testDate:    document.getElementById('test-date')?.value  || '',
            studentName: document.getElementById('student-name')?.value || '',
            rollNumber:  document.getElementById('roll-number')?.value  || '',
        };

        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

        // Visual feedback — briefly change button text
        const btn = document.querySelector('button[onclick="saveDraft()"]');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '✅ Draft Saved!';
            btn.style.background = 'linear-gradient(135deg,#27ae60,#1e8449)';
            setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; }, 1800);
        }

        // Refresh the Load Draft bar on the chapter-selection screen
        _refreshDraftBar();

    } catch (e) {
        alert('Draft could not be saved: ' + e.message);
    }
}

/**
 * Load the last saved draft from localStorage and jump straight to the
 * preview popup so the user sees the saved test immediately.
 */
function loadDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) { alert('No saved draft found.'); return; }
        const draft = JSON.parse(raw);

        // ── Restore global state ─────────────────────────────────────────────
        selectedChapters          = draft.selectedChapters      || [];
        selectedQuestions         = draft.selectedQuestions     || [];
        selectedQuestionsData     = draft.selectedQuestionsData || {};
        selectedMode              = draft.selectedMode          || 'manual';
        editedQuestions           = draft.editedQuestions       || {};
        customQuestions           = draft.customQuestions       || {};
        customQuestionCounter     = draft.customQuestionCounter || 0;
        autoModeConfigState       = draft.autoModeConfigState   || {};
        logoData                  = draft.logoData              || '';

        // Restore logo preview
        const logoPreview = document.getElementById('logo-preview');
        if (logoPreview) {
            if (logoData) { logoPreview.src = logoData; logoPreview.style.display = 'block'; }
            else          { logoPreview.style.display = 'none'; }
        }

        // ── Restore header form fields ───────────────────────────────────────
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        setVal('exam-name',    draft.examName);
        setVal('class-name',   draft.className);
        setVal('test-time',    draft.testTime);
        setVal('test-date',    draft.testDate);
        setVal('student-name', draft.studentName);
        setVal('roll-number',  draft.rollNumber);

        // Re-sync chapter checkboxes so the UI reflects loaded chapters
        document.querySelectorAll('.chapter-btn, .chapter-checkbox, input[type=checkbox][data-chapter]').forEach(el => {
            const ch = el.dataset.chapter || el.value;
            if (ch) {
                if (el.type === 'checkbox') el.checked = selectedChapters.includes(ch);
                else el.classList.toggle('selected', selectedChapters.includes(ch));
            }
        });

        // ── Navigate: step 3, test-preview screen visible, open preview popup ─
        currentStep = 3;
        updateStepIndicators();

        // Show test-preview screen (needed before showFinalPreview reads DOM fields)
        document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
        document.getElementById('test-preview').style.display = 'block';

        calculateTotalMarks();
        updateNavigation();

        // Small delay so the DOM settles, then open the final preview popup
        setTimeout(() => {
            showFinalPreview();
        }, 80);

    } catch (e) {
        alert('Could not load draft: ' + e.message);
        console.error(e);
    }
}

/**
 * Show/hide the Load Draft bar on the chapter-selection screen
 * depending on whether a draft exists in localStorage.
 */
function _refreshDraftBar() {
    const bar   = document.getElementById('load-draft-bar');
    const label = document.getElementById('draft-info-label');
    if (!bar) return;

    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) { bar.style.display = 'none'; return; }

    try {
        const draft = JSON.parse(raw);
        bar.style.display = 'block';
        if (label && draft.savedAt) {
            const d = new Date(draft.savedAt);
            const fmt = d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
                      + ' ' + d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
            const qCount = (draft.selectedQuestions || []).length;
            label.textContent = `Last saved: ${fmt}  •  ${qCount} question${qCount !== 1 ? 's' : ''}`;
        }
    } catch (_) {
        bar.style.display = 'none';
    }
}

// Check for a saved draft as soon as the page loads
document.addEventListener('DOMContentLoaded', _refreshDraftBar);

function toggleAllLessons() {
    const chapterItems = document.querySelectorAll(
        '#chapter-list .question-item'
    );

    const allSelected = [...chapterItems].every(item => item.classList.contains('selected'));

    chapterItems.forEach(item => {
        if (allSelected) {
            item.classList.remove('selected');
        } else {
            item.classList.add('selected');
        }
    });

    selectedChapters = [...chapterItems]
        .filter(item => item.classList.contains('selected'))
        .map(item => item.textContent.trim());

    updateSelectAllButtonText();
}