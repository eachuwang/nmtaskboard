import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from "react";

const DEFAULT_MIN_ROWS = 5;
const DEFAULT_MAX_ROWS = 8;

function pixels(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const AutoResizeTextarea = forwardRef(function AutoResizeTextarea({ onInput, minRows = DEFAULT_MIN_ROWS, maxRows = DEFAULT_MAX_ROWS, ...props }, forwardedRef) {
  const textareaRef = useRef(null);

  useImperativeHandle(forwardedRef, () => textareaRef.current);

  const resize = useCallback((element = textareaRef.current) => {
    if (!element) return;
    const styles = window.getComputedStyle(element);
    const lineHeight = pixels(styles.lineHeight) || 20;
    const chrome = pixels(styles.paddingTop) + pixels(styles.paddingBottom) + pixels(styles.borderTopWidth) + pixels(styles.borderBottomWidth);
    const minHeight = lineHeight * minRows + chrome;
    const maxHeight = lineHeight * maxRows + chrome;
    element.style.height = "0px";
    const nextHeight = Math.min(Math.max(element.scrollHeight + pixels(styles.borderTopWidth) + pixels(styles.borderBottomWidth), minHeight), maxHeight);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight + pixels(styles.borderTopWidth) + pixels(styles.borderBottomWidth) > maxHeight ? "auto" : "hidden";
  }, [maxRows, minRows]);

  useLayoutEffect(() => resize(), [props.value, props.defaultValue, resize]);

  return <textarea {...props} ref={textareaRef} rows={minRows} data-auto-resize={`${minRows}-${maxRows}`} onInput={(event) => { resize(event.currentTarget); onInput?.(event); }} />;
});

export default AutoResizeTextarea;
