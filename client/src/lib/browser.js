export function prefersReducedMotion(matchMedia = globalThis.matchMedia) {
  return Boolean(matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export async function copyText(text, navigatorObject = globalThis.navigator) {
  if (!navigatorObject?.clipboard?.writeText) throw new Error("当前浏览器不支持剪贴板");
  await navigatorObject.clipboard.writeText(text);
}

export function downloadText(text, filename, documentObject = globalThis.document, urlObject = globalThis.URL) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const link = documentObject.createElement("a");
  link.href = urlObject.createObjectURL(blob);
  link.download = filename;
  link.click();
  urlObject.revokeObjectURL(link.href);
}
