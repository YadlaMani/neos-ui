import debounce from 'lodash.debounce';
import DecoupledEditor from '@ckeditor/ckeditor5-editor-decoupled/src/decouplededitor';
import {actions} from '@neos-project/neos-ui-redux-store';

// We remove opening and closing span tags that are produced by the inlineMode plugin
/** @param {String} content */
const cleanupContentBeforeCommit = content => {
    // TODO: remove when this is fixed: https://github.com/ckeditor/ckeditor5/issues/401
    if (content.match(/^<([a-z][a-z0-9]*)\b[^>]*>&nbsp;<\/\1>$/)) {
        return '';
    }

    if (content.startsWith('<neos-inline-wrapper>') && content.endsWith('</neos-inline-wrapper>')) {
        const contentWithoutOuterInlineWrapper = content
            .replace(/^<neos-inline-wrapper>/, '')
            .replace(/<\/neos-inline-wrapper>$/, '');

        if (contentWithoutOuterInlineWrapper.includes('<neos-inline-wrapper>')) {
            // in the case, multiple root paragraph elements were inserted into the ckeditor (wich is currently not prevented if the html is modified from outside)
            // we have multiple root elements of type <neos-inline-wrapper>. We will convert all of them into spans.
            return content
                .replace(/<neos-inline-wrapper>/g, '<span>')
                .replace(/<\/neos-inline-wrapper>/g, '</span>');
        }
        return contentWithoutOuterInlineWrapper;
    }
    return content;
};

let currentEditor = null;
let editorConfig = {};

// We cache the "formattingUnderCursor"; to only emit events when it really changed.
// As there is only a single cursor active at any given time, it is safe to do this caching here inside the singleton object.
let lastFormattingUnderCursorSerialized = '';

// We get the state of all commands from CKE5 and serialize it into "formattingUnderCursor"
const handleUserInteractionCallback = () => {
    if (!currentEditor) {
        return;
    }
    const formattingUnderCursor = {};
    [...currentEditor.commands].forEach(commandTuple => {
        const [commandName, command] = commandTuple;
        if (command.value !== undefined) {
            formattingUnderCursor[commandName] = command.value;
        }
    });

    const formattingUnderCursorSerialized = JSON.stringify(formattingUnderCursor);
    if (formattingUnderCursorSerialized !== lastFormattingUnderCursorSerialized) {
        editorConfig.setFormattingUnderCursor(formattingUnderCursor);
        lastFormattingUnderCursorSerialized = formattingUnderCursorSerialized;
    }
};

export const bootstrap = _editorConfig => {
    editorConfig = _editorConfig;
};

export const createEditor = store => async options => {
    const {propertyDomNode, propertyName, editorOptions, globalRegistry, userPreferences, onChange} = options;
    const ckEditorConfig = editorConfig.configRegistry.getCkeditorConfig({
        editorOptions,
        userPreferences,
        globalRegistry,
        propertyDomNode
    });

    return DecoupledEditor
        .create(propertyDomNode, ckEditorConfig)
        .then(editor => {
            editor.ui.focusTracker.on('change:isFocused', event => {
                if (event.source.isFocused) {
                    currentEditor = editor;
                    editorConfig.setCurrentlyEditedPropertyName(propertyName);
                    handleUserInteractionCallback();
                }
            });

            editor.keystrokes.set('Ctrl+K', (_, cancel) => {
                store.dispatch(actions.UI.ContentCanvas.toggleLinkEditor());
                cancel();
            });

            // We attach all options for this editor to the editor DOM node, so it would be easier to access them from CKE plugins
            editor.neos = options;

            editor.model.document.on('change', () => handleUserInteractionCallback());
            editor.model.document.on('change:data', debounce(() => onChange(cleanupContentBeforeCommit(editor.getData())), 500, {maxWait: 5000}));
            return editor;
        }).catch(e => console.error(e));
};

export const executeCommand = (command, argument, reFocusEditor = true) => {
    currentEditor.execute(command, argument);
    if (reFocusEditor) {
        currentEditor.editing.view.focus();
    }
};
