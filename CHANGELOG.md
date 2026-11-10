# Changelog

## 0.2.0

- Spell check for English while you edit a topic or a note: misspelled words get a wavy underline, and resting the mouse on one offers replacements and **Add to Dictionary**. The dictionary is part of the extension, so it works offline. Settings: `thinkmark.spellCheck.enabled`, `thinkmark.spellCheck.userWords`.
- Drag a topic's outer edge to set the width its text wraps at; double-click the edge to go back to the default.
- `Cmd+B` / `Cmd+I` / `Cmd+U` for bold, italic and underline: on the selected text while editing, or on the whole text of the selected topics.
- Topics grow wider before their text wraps, and the wrap widths are settings (`thinkmark.topicMaxWidth.*`).
- **Expand All** and **Collapse All** in the toolbar; narrow editors get an icon-only toolbar.
- Fixed: undo, redo and select-all now work inside the text being edited, and a topic's text can be cleared.
- Fixed: **Edit Note** and **Add Link** chosen from the right-click menu now put the cursor in the note or link field.
- Fixed: in the Ink theme, branch lines no longer run through the central topic's text.

## 0.1.0

First release.

- Open any Markdown file as a mind map; edits in the map are written back to the Markdown, and edits to the text show up in the map.
- Mind map, logic chart (right or left) and org chart structures; Rainbow, Fresh, Business, Ink, Midnight and Auto themes; curved, elbow or straight branch lines.
- Keyboard-first editing, drag and drop with explicit placement, box selection and group actions.
- Images in topics (insert, paste, drop, resize), notes, task checkboxes, links and inline formatting.
- Side-by-side source with synced selection.
- English and Simplified Chinese interface.
