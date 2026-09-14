export function uploadStagedFile({ taskId, draftId, file, kind, onProgress = () => {}, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/tasks/${encodeURIComponent(taskId)}/attachments/stage`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Draft-Id", draftId);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-File-Kind", kind);
    xhr.upload.onprogress = (event) => onProgress(event.lengthComputable ? Math.round(event.loaded / event.total * 100) : 0);
    xhr.onerror = () => reject(new Error("上传失败，请检查网络后重试"));
    xhr.onabort = () => reject(Object.assign(new Error("上传已取消"), { code: "UPLOAD_ABORTED" }));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body.attachment);
      else reject(new Error(body.error || `上传失败（HTTP ${xhr.status}）`));
    };
    xhr.send(file);
  });
}
