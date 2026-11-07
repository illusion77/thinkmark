const svg = (body: string, size = 24) =>
  `<svg viewBox="0 0 ${size} ${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  topic: svg('<rect x="4" y="8" width="16" height="8" rx="2.5"/><path d="M12 3.5v2.5M12 18v2.5" opacity=".45"/>'),
  subtopic: svg('<rect x="2.5" y="9" width="8" height="6" rx="1.8"/><rect x="14.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="14.5" y="15.5" width="7" height="5" rx="1.5"/><path d="M10.5 12h1.5a1.5 1.5 0 0 0 1.5-1.5V7.5a1.5 1.5 0 0 1 1-1.5M12 12a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 0 1 1.5"/>'),
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 15.5-4.8-4.8-8.7 8.8"/>'),
  note: svg('<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5M9 12.5h6.5M9 16h4.5"/>'),
  noteSmall: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2h6l3 3v9h-9z"/><path d="M6 8h4.5M6 10.8h3"/></svg>',
  link: svg('<path d="M10.2 13.8a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1.3 1.3"/><path d="M13.8 10.2a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1.3-1.3"/>'),
  linkSmall: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.9.9"/><path d="M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.9-.9"/></svg>',
  task: svg('<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="m8.5 12.2 2.4 2.4 4.8-5"/>'),
  markdown: svg('<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M6 15V9l2.5 3L11 9v6M15.5 9v6m0 0-2-2m2 2 2-2"/>'),
  format: svg('<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h7M15 17.5h5"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="13" cy="17.5" r="2"/>'),
  minus: svg('<path d="M6 12h12"/>'),
  plus: svg('<path d="M12 6v12M6 12h12"/>'),
  fit: svg('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><rect x="8.5" y="9.5" width="7" height="5" rx="1.2"/>'),
  close: svg('<path d="m7 7 10 10M17 7 7 17"/>'),
};

/** Small pictograms for the Structure picker (56 x 36). */
export const layoutIcons: Record<string, string> = {
  map: `<svg viewBox="0 0 56 36"><g fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"><path d="M28 18C36 18 34 8 42 8M28 18C36 18 34 28 42 28M28 18C20 18 22 8 14 8M28 18C20 18 22 28 14 28"/></g><rect x="20" y="14" width="16" height="8" rx="2.5" fill="currentColor"/><g fill="currentColor" opacity=".7"><rect x="42" y="5.5" width="10" height="5" rx="1.5"/><rect x="42" y="25.5" width="10" height="5" rx="1.5"/><rect x="4" y="5.5" width="10" height="5" rx="1.5"/><rect x="4" y="25.5" width="10" height="5" rx="1.5"/></g></svg>`,
  right: `<svg viewBox="0 0 56 36"><g fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"><path d="M18 18C27 18 25 6 34 6M18 18H34M18 18C27 18 25 30 34 30"/></g><rect x="4" y="14" width="14" height="8" rx="2.5" fill="currentColor"/><g fill="currentColor" opacity=".7"><rect x="34" y="3.5" width="12" height="5" rx="1.5"/><rect x="34" y="15.5" width="12" height="5" rx="1.5"/><rect x="34" y="27.5" width="12" height="5" rx="1.5"/></g></svg>`,
  left: `<svg viewBox="0 0 56 36"><g fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"><path d="M38 18C29 18 31 6 22 6M38 18H22M38 18C29 18 31 30 22 30"/></g><rect x="38" y="14" width="14" height="8" rx="2.5" fill="currentColor"/><g fill="currentColor" opacity=".7"><rect x="10" y="3.5" width="12" height="5" rx="1.5"/><rect x="10" y="15.5" width="12" height="5" rx="1.5"/><rect x="10" y="27.5" width="12" height="5" rx="1.5"/></g></svg>`,
  down: `<svg viewBox="0 0 56 36"><g fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"><path d="M28 12V18H12V24M28 18H44V24M28 18V24"/></g><rect x="20" y="3" width="16" height="8" rx="2.5" fill="currentColor"/><g fill="currentColor" opacity=".7"><rect x="6" y="24" width="12" height="6" rx="1.5"/><rect x="22" y="24" width="12" height="6" rx="1.5"/><rect x="38" y="24" width="12" height="6" rx="1.5"/></g></svg>`,
};
