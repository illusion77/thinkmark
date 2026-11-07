/**
 * Local link / image targets mentioned in Markdown text: `![x](a.png)`, `[x](a.png)`, `<img src="a.png">`.
 * Returned decoded, without query or fragment; URLs with a scheme (https:, data:...) are skipped.
 */
export function localLinkTargets(text: string): string[] {
  const out: string[] = [];
  const re = /\]\(\s*(?:<([^>]+)>|([^)\s]+))|<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let target = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!target || target.startsWith('#') || (/^[a-z][\w+.-]*:/i.test(target) && !/^[a-zA-Z]:[\\/]/.test(target))) continue;
    target = target.replace(/[?#].*$/, '');
    try {
      target = decodeURIComponent(target);
    } catch {
      /* keep as written */
    }
    if (target) out.push(target);
  }
  return out;
}

/** Ways a file name can appear in a Markdown link (as is, or URL-encoded). */
export function fileNameSpellings(name: string): string[] {
  const variants = new Set([name, encodeURI(name), name.replace(/ /g, '%20'), name.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')]);
  return [...variants];
}
