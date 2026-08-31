import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from "react";

const MIN_ROWS = 5;
const MAX_ROWS = 8;

function pixels(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const AutoResizeTextarea = forwardRef(function AutoResizeTextarea({ onInput, ...props }, forwardedRef) {
  const textareaRef = useRef(null);

  useImperativeHandle(forwardedRef, () => textareaRef.current);

  const resize = useCallback((element = textareaRef.current) => {
    if (!element) return;
    const styles = window.getComputedStyle(element);
    const lineHeight = pixels(styles.lineHeight) || 20;
    const chrome = pixels(styles.paddingTop) + pixels(styles.paddingBottom) + pixels(styles.borderTopWidth) + pixels(styles.borderBottomWidth);
    const minHeight = lineHeight * MIN_ROWS + chrome;
    const maxHeight = lineHeight * MAX_ROWS + chrome;
    element.style.height = "0px";
    const nextHeight = Math.min(Math.max(element.scrollHeight + pixels(styles.borderTopWidth) + pixels(styles.borderBottomWidth), minHeight), maxHeight);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight + pixels(styles.borderTopWidth) + pixels(styles.borderBottomWidth) > maxHeight ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => resize(), [props.value, props.defaultValue, resize]);

  return <textarea {...props} ref={textareaRef} rows={MIN_ROWS} data-auto-resize="5-8" onInput={(event) => { resize(event.currentTarget); onInput?.(event); }} />;
});

export default AutoResizeTextarea;
