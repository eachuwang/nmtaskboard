(() => {
  "use strict";
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const toast = (msg) => {
    const t = el("div", "toast", msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  };
  const api = async (path, options) => {
    const res = await fetch(path, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "请求失败");
    return body;
  };
  // 标签颜色选择：点击弹层外空白处关闭（弹层内部点击不关闭，供自定义取色器使用）
  const closeColorPops = (e) => {
    if (e && e.target && e.target.closest(".tag-color-pop")) return;
    document.querySelectorAll(".tag-color-pop").forEach((n) => n.remove());
  };
  document.addEventListener("click", closeColorPops);
  const ICONS = {
    llm: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="5" height="5" rx="1"></rect><path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M12.6 3.4L9.8 6.2M6.2 9.8l-2.8 2.8"></path></svg>',
    appearance: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"></circle><path d="M8 2a6 6 0 0 0 0 12z"></path></svg>',
    data: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="8" cy="3.5" rx="5.5" ry="2"></ellipse><path d="M2.5 3.5v9c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2"></path></svg>',
    tags: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2h6.6a1 1 0 0 1 .7.3l5 5a1 1 0 0 1 0 1.4l-4.6 4.6a1 1 0 0 1-1.4 0l-5-5A1 1 0 0 1 3 8.6V3a1 1 0 0 1 1-1z"></path><circle cx="5.6" cy="5.6" r="1"></circle></svg>'
  };
  const SECTIONS = [
    { id: "llm", label: "LLM 配置" },
    { id: "appearance", label: "个性化" },
    { id: "data", label: "数据" },
    { id: "tags", label: "标签管理" }
  ];

  function open(section = "llm") {
    document.querySelector(".panel-mask")?.remove();
    const mask = el("div", "panel-mask");
    const panel = el("div", "panel");

    // 头部
    const head = el("div", "panel-head");
    head.append(el("h2", null, "设置"));
    const closeBtn = el("button", "icon-btn modal-close", "✕");
    closeBtn.title = "关闭";
    closeBtn.addEventListener("click", () => mask.remove());
    head.append(closeBtn);
    panel.append(head);

    // 主体：左侧分区导航 + 右侧内容
    const body = el("div", "panel-body");
    const nav = el("nav", "panel-nav");
    const content = el("div", "panel-content");
    body.append(nav, content);
    panel.append(body);

    const sections = {};
    for (const s of SECTIONS) {
      const item = el("div", "panel-nav-item");
      item.innerHTML = ICONS[s.id] + "<span>" + s.label + "</span>";
      item.dataset.section = s.id;
      item.addEventListener("click", () => activate(s.id));
      nav.append(item);
      const sec = el("section", "panel-section");
      sec.dataset.section = s.id;
      content.append(sec);
      sections[s.id] = { item, sec };
    }
    function activate(id) {
      for (const s of SECTIONS) {
        sections[s.id].item.classList.toggle("active", s.id === id);
        sections[s.id].sec.classList.toggle("active", s.id === id);
      }
    }

    buildLlm(sections.llm.sec);
    buildAppearance(sections.appearance.sec);
    buildData(sections.data.sec);
    buildTags(sections.tags.sec);

    mask.append(panel);
    window.closeModalOnBackdrop(mask, () => mask.remove());
    document.body.appendChild(mask);
    activate(SECTIONS.some((s) => s.id === section) ? section : "llm");
  }

  // ---------- LLM 配置：提供方管理 ----------
  const PROTOCOL_OPTIONS = [
    ["openai-chat-completions", "OpenAI Chat Completions"],
    ["other", "其他（自定义，按 OpenAI 兼容调用）"]
  ];

  const PRESETS = [
    { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", protocol: "openai-chat-completions", models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1"] },
    { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", protocol: "other", models: ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-20250219"] },
    { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", protocol: "openai-chat-completions", models: ["deepseek-chat", "deepseek-reasoner"] },
    { id: "bigmodel", name: "智谱 BigModel", baseUrl: "https://open.bigmodel.cn/api/paas/v4", protocol: "openai-chat-completions", models: ["glm-4-plus", "glm-4-air"] },
    { id: "moonshot", name: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", protocol: "openai-chat-completions", models: ["kimi-k2-0711-preview", "moonshot-v1-8k"] },
    { id: "qwen", name: "阿里通义 DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", protocol: "openai-chat-completions", models: ["qwen-plus", "qwen-max"] }
  ];

  function confirmModal(title, desc, okLabel) {
    return new Promise((resolve) => {
      const mask = el("div", "modal-mask");
      const card = el("div", "modal-card modal-sm");
      const head = el("div", "modal-head");
      head.append(el("h2", null, title));
      const close = el("button", "icon-btn modal-close", "✕");
      close.title = "关闭";
      close.addEventListener("click", () => { mask.remove(); resolve(false); });
      head.append(close);
      const body = el("div", "modal-body");
      body.append(el("p", "confirm-desc", desc));
      const foot = el("div", "modal-foot");
      const cancel = el("button", "btn btn-ghost", "取消");
      const ok = el("button", "btn btn-danger-solid", okLabel || "删除");
      cancel.addEventListener("click", () => { mask.remove(); resolve(false); });
      ok.addEventListener("click", () => { mask.remove(); resolve(true); });
      foot.append(cancel, ok);
      card.append(head, body, foot);
      mask.append(card);
      window.closeModalOnBackdrop(mask, () => { mask.remove(); resolve(false); });
      document.body.appendChild(mask);
      ok.focus();
    });
  }

  function buildLlm(sec) {
    sec.append(el("p", "sub", "添加提供方后只需填写 API Key 即可使用；点「自定义」可编辑 provider_id（支持选择预设）、协议、地址与模型目录。默认提供方用于智能建任务与周报润色。"));
    const toolbar = el("div", "provider-toolbar");
    const addDefaultBtn = el("button", "btn btn-outline btn-sm", "添加提供方");
    addDefaultBtn.title = "从预设主流提供商开始，只需填写 API Key";
    toolbar.append(addDefaultBtn);
    sec.append(toolbar);

    const listBox = el("div", "provider-list");
    sec.append(listBox);

    let state = { providers: [], defaultProviderId: "" };
    const fetchedModels = new Map();

    async function refresh() {
      const j = await api("/api/settings");
      state = { providers: j.providers, defaultProviderId: j.defaultProviderId };
      render();
    }

    function save() {
      const payload = {
        providers: state.providers.map((p) => ({
          id: p.id, name: p.name, baseUrl: p.baseUrl, protocol: p.protocol,
          defaultModelId: p.defaultModelId,
          models: p.models.map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow, maxOutputTokens: m.maxOutputTokens })),
          // 密钥仅在本次输入/清除时才携带，避免明文常驻 payload
          ...(p.__keyDirty ? { apiKey: p.apiKey } : {}),
          ...(p.clearKey ? { clearKey: true } : {})
        })),
        defaultProviderId: state.defaultProviderId
      };
      return api("/api/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
    }

    function render() {
      listBox.innerHTML = "";
      for (const p of state.providers) listBox.append(providerEl(p));
      for (const p of state.providers) {
        if (p.__expanded) {
          const box = listBox.querySelector('.provider[data-id="' + p.id + '"]');
          box?.classList.add("expanded");
          if (p.__focusKey) {
            const k = box?.querySelector(".p-key");
            if (k) { k.focus(); p.__focusKey = false; }
          }
        }
      }
    }

    function applyPreset(p, preset) {
      p.id = preset.id;
      p.name = preset.name;
      p.baseUrl = preset.baseUrl;
      p.protocol = preset.protocol;
      p.models = preset.models.map((id) => ({ id, name: id, contextWindow: null, maxOutputTokens: null }));
      p.defaultModelId = preset.models[0];
      p.__nameTouched = false;
      render();
    }

    function providerEl(p) {
      const box = el("div", "provider region");
      box.dataset.id = p.id;
      if (p.__expanded) { box.classList.add("expanded", "region-open"); }

      const head = el("div", "provider-head");
      head.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="5" height="5" rx="1"></rect><path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M12.6 3.4L9.8 6.2M6.2 9.8l-2.8 2.8"></path></svg>';
      head.append(el("span", "provider-name", p.name || p.id));
      if (p.id === state.defaultProviderId) head.append(el("span", "badge", "默认"));
      head.append(el("span", "provider-meta", p.protocol + " · " + p.models.length + " 个模型" + (p.hasKey ? " · 已配密钥" : "")));
      const right = el("span", "provider-head-right");
      const setDefault = el("button", "btn btn-ghost btn-sm", "设为默认");
      setDefault.title = "智能建任务与周报润色使用该提供方";
      const del = el("button", "icon-btn", "✕");
      del.title = "删除该提供方";
      right.append(setDefault, del);
      const chev = el("span", "provider-chevron");
      chev.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"></path></svg>';
      right.append(chev);
      head.append(right);
      head.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        p.__expanded = !p.__expanded;
        box.classList.toggle("expanded", p.__expanded);
        box.classList.toggle("region-open", p.__expanded);
        if (p.__expanded) box.querySelector(".provider-detail").style.display = "block";
        else box.querySelector(".provider-detail").style.display = "none";
      });
      setDefault.addEventListener("click", () => { state.defaultProviderId = p.id; render(); });
      del.addEventListener("click", async () => {
        const ok = await confirmModal("删除提供方", "确定删除「" + (p.name || p.id) + "」？该提供方下的模型目录会一并移除。", "删除");
        if (!ok) return;
        state.providers = state.providers.filter((x) => x.id !== p.id);
        if (state.defaultProviderId === p.id) state.defaultProviderId = state.providers[0]?.id || "";
        render();
      });
      box.append(head);

      const detail = el("div", "provider-detail region-detail");
      const expanded = () => !p.__simple;

      // ---- 字段顺序：provider_id → 显示名称 → 协议 → API 地址 →（密钥常显）→ 模型目录 ----
      const fullTop = el("div", "p-full-top");
      fullTop.style.display = expanded() ? "block" : "none";
      const addRow = (labelText, input, hint) => {
        const row = el("div", "form-row");
        row.append(el("label", null, labelText));
        row.append(input);
        if (hint) row.append(el("div", "hint", hint));
        fullTop.append(row);
        return input;
      };
      const idWrap = el("span", "preset-wrap");
      const idInput = el("input", "input");
      idInput.value = p.id; idInput.placeholder = "provider_id";
      idInput.style.width = "200px";
      const presetBtn = el("button", "btn btn-outline btn-sm", "选择预设 ▾");
      presetBtn.title = "点击选择预设好的主流提供商配置";
      idWrap.append(idInput, presetBtn);
      addRow("提供方 id（provider_id）", idWrap, "可点击「选择预设」一键填充，也可手动输入");
      const nameInput = addRow("提供方显示名", el("input", "input"));
      nameInput.value = p.name || "";
      nameInput.placeholder = "默认与 provider_id 一致";
      const protoInput = window.UiSelect.create({
        options: PROTOCOL_OPTIONS.map(([v, label]) => ({ value: v, label })),
        value: p.protocol || "openai-chat-completions"
      });
      addRow("API 协议", protoInput.el);
      const urlInput = addRow("API 地址（base_url）", el("input", "input"), "OpenAI 兼容接口地址，如 https://api.deepseek.com");
      urlInput.value = p.baseUrl || "";
      detail.append(fullTop);

      // 密钥行：两种模式都可见（修复：展开自定义后密钥输入框仍存在）
      const keyRow = el("div", "form-row p-key-row");
      keyRow.append(el("label", null, "API 密钥（api_key）"));
      const keyInput = el("input", "input p-key");
      keyInput.type = "password"; keyInput.autocomplete = "off";
      keyInput.placeholder = p.hasKey ? "已配置（尾号 " + (p.keyTail || "") + "，留空不修改）" : "请输入 API Key";
      keyRow.append(keyInput);
      detail.append(keyRow);

      // 简化模式操作条（仅简化模式显示）
      const simpleBar = el("div", "p-simple-bar");
      simpleBar.style.display = expanded() ? "none" : "block";
      const simpleActions = el("div", "settings-actions");
      const saveSimple = el("button", "btn btn-primary btn-sm", "保存");
      const testSimple = el("button", "btn btn-outline btn-sm", "测试连接");
      const customBtn = el("button", "btn btn-outline btn-sm", "自定义");
      customBtn.title = "展开完整设置（provider_id / 名称 / 协议 / 地址 / 模型目录）";
      simpleActions.append(saveSimple, testSimple, customBtn);
      simpleBar.append(simpleActions);
      const simpleStatus = el("div", "status-line");
      simpleBar.append(simpleStatus);
      detail.append(simpleBar);

      // 完整模式底部（清除密钥 + 操作 + 模型目录）
      const fullBottom = el("div", "p-full-bottom");
      fullBottom.style.display = expanded() ? "block" : "none";
      const clearWrap = el("label", "check-row");
      const clearBox = el("input"); clearBox.type = "checkbox";
      clearWrap.append(clearBox, el("span", null, "清除已保存的密钥"));
      const clearRow = el("div", "form-row");
      clearRow.append(clearWrap);
      fullBottom.append(clearRow);
      const actRow = el("div", "settings-actions");
      const saveBtn = el("button", "btn btn-primary btn-sm", "保存");
      const testBtn = el("button", "btn btn-outline btn-sm", "测试连接");
      actRow.append(saveBtn, testBtn);
      fullBottom.append(actRow);
      const status = el("div", "status-line");
      fullBottom.append(status);

      const mlHead = el("div", "model-list-head");
      mlHead.append(el("h3", null, "模型目录"));
      const fetchBtn = el("button", "btn btn-outline btn-sm", "拉取可用模型");
      const addModelBtn = el("button", "btn btn-outline btn-sm", "添加模型");
      mlHead.append(fetchBtn, addModelBtn);
      fullBottom.append(mlHead);
      const modelList = el("div", "model-list");
      fullBottom.append(modelList);
      detail.append(fullBottom);

      // 预设菜单
      function openPresetMenu() {
        document.querySelectorAll(".preset-menu").forEach((n) => n.remove());
        const menu = el("div", "preset-menu");
        for (const preset of PRESETS) {
          const item = el("div", "preset-menu-item");
          item.append(el("span", "pm-name", preset.name));
          item.append(el("span", "pm-meta", preset.id));
          item.addEventListener("click", () => {
            applyPreset(p, preset);
            idInput.value = p.id;
            nameInput.value = p.name;
            urlInput.value = p.baseUrl;
            protoInput.setValue(p.protocol);
            menu.remove();
          });
          menu.append(item);
        }
        idWrap.append(menu);
      }
      presetBtn.addEventListener("click", (e) => { e.stopPropagation(); openPresetMenu(); });
      document.addEventListener("click", () => document.querySelectorAll(".preset-menu").forEach((n) => n.remove()));

      idInput.addEventListener("input", () => {
        if (!p.__nameTouched) { p.name = idInput.value.trim(); nameInput.value = p.name; }
      });
      nameInput.addEventListener("input", () => { p.__nameTouched = true; p.name = nameInput.value.trim(); });

      function renderModels() {
        modelList.innerHTML = "";
        const dl = el("datalist");
        dl.id = "dl-" + p.id;
        for (const id of fetchedModels.get(p.id) || []) dl.append(el("option", null, id));
        modelList.append(dl);
        p.models.forEach((m, mi) => {
          const row = el("div", "model-row");
          const chev2 = el("span", "model-chevron");
          chev2.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"></path></svg>';
          const idIn = el("input", "input model-id");
          idIn.value = m.id; idIn.setAttribute("list", dl.id);
          idIn.title = "点击输入框可从已拉取的模型列表中选择";
          const nameIn = el("input", "input model-name");
          nameIn.value = m.name || m.id;
          nameIn.placeholder = "显示名（默认与模型 id 一致）";
          // 默认槽：点击切换默认模型（修复：用户可选择默认模型）
          const defSlot = el("span", "model-def-slot");
          const isDef = m.id === p.defaultModelId;
          if (isDef) {
            defSlot.append(el("span", "badge", "默认"));
          } else {
            const setDefHint = el("span", "badge set-default-hint", "设为默认");
            setDefHint.title = "点击设为默认模型";
            defSlot.append(setDefHint);
          }
          defSlot.title = isDef ? "当前默认模型" : "点击设为默认模型";
          defSlot.style.cursor = "pointer";
          defSlot.addEventListener("click", () => {
            if (!isDef) { p.defaultModelId = m.id; renderModels(); }
          });
          const delM = el("button", "icon-btn", "✕");
          delM.title = "删除该模型";
          row.append(chev2, idIn, nameIn, defSlot, delM);
          modelList.append(row);
          const det = el("div", "model-detail");
          const cw = el("input", "input");
          cw.type = "number"; cw.value = m.contextWindow ?? ""; cw.placeholder = "自动";
          const mo = el("input", "input");
          mo.type = "number"; mo.value = m.maxOutputTokens ?? ""; mo.placeholder = "自动";
          const setDefM = el("button", "btn btn-ghost btn-sm", "设为默认模型");
          det.append(el("label", null, "上下文窗口"), cw, el("label", null, "最大输出"), mo, setDefM);
          modelList.append(det);
          chev2.addEventListener("click", () => {
            row.classList.toggle("expanded");
            det.style.display = row.classList.contains("expanded") ? "flex" : "none";
          });
          const wasDef = () => m.id === p.defaultModelId;
          idIn.addEventListener("change", () => {
            m.id = idIn.value.trim();
            if (!m.name || m.name === idIn.defaultValue) { m.name = m.id; nameIn.value = m.id; }
            if (wasDef()) p.defaultModelId = m.id;
            idIn.defaultValue = m.id;
          });
          nameIn.addEventListener("change", () => { m.name = nameIn.value.trim(); });
          cw.addEventListener("change", () => { m.contextWindow = Number(cw.value) || null; });
          mo.addEventListener("change", () => { m.maxOutputTokens = Number(mo.value) || null; });
          delM.addEventListener("click", () => {
            p.models.splice(mi, 1);
            if (p.defaultModelId === m.id) p.defaultModelId = p.models[0]?.id || "";
            renderModels();
          });
          setDefM.addEventListener("click", () => { p.defaultModelId = m.id; renderModels(); });
        });
      }
      renderModels();

      addModelBtn.addEventListener("click", () => {
        p.models.push({ id: "", name: "", contextWindow: null, maxOutputTokens: null });
        renderModels();
        modelList.querySelectorAll(".model-id").forEach((i) => { if (!i.value) i.focus(); });
      });

      fetchBtn.addEventListener("click", async () => {
        fetchBtn.disabled = true;
        status.className = "status-line";
        status.textContent = "拉取中…";
        try {
          // 拉取前先保存（密钥可能刚输入）
          await collect(true);
          const res = await fetch("/api/llm/models?providerId=" + encodeURIComponent(p.id));
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j.error || "拉取失败");
          fetchedModels.set(p.id, j.models);
          openModelPicker(p, j.models);
          renderModels();
          status.className = "status-line";
          status.textContent = "";
        } catch (e) {
          status.className = "status-line err";
          status.textContent = "拉取失败：" + e.message;
        }
        fetchBtn.disabled = false;
      });

      // 展开自定义
      customBtn.addEventListener("click", () => {
        p.__simple = false;
        box.classList.add("region-open");
        simpleBar.style.display = "none";
        fullTop.style.display = "block";
        fullBottom.style.display = "block";
        if (!p.id) idInput.focus();
        else keyInput.focus();
      });

      // 收集表单到 state 并保存；silent=true 时静默（供测试连接/拉取前自动保存）
      async function collect(silent) {
        const keyVal = keyInput.value.trim();
        if (!p.__simple) {
          const newId = idInput.value.trim();
          if (!newId) throw new Error("请填写 provider_id");
          if (state.providers.some((x) => x !== p && x.id === newId)) throw new Error("provider_id 已存在，请换一个");
          p.id = newId;
          if (!p.__nameTouched) { p.name = p.id; nameInput.value = p.name; }
          p.name = nameInput.value.trim() || p.id;
          p.protocol = protoInput.getValue();
          p.baseUrl = urlInput.value.trim();
        }
        if (keyVal) { p.apiKey = keyVal; p.__keyDirty = true; }
        if (clearBox.checked) { p.clearKey = true; p.__keyDirty = false; }
        try {
          await save();
          p.__keyDirty = false;
          p.clearKey = false;
          window.dispatchEvent(new CustomEvent("tb-settings-changed"));
        } catch (e) {
          if (!silent) throw e;
        }
        keyInput.value = "";
        clearBox.checked = false;
        if (p.apiKey) {
          p.hasKey = true;
          p.keyTail = p.apiKey.slice(-4);
          keyInput.placeholder = "已配置（尾号 " + p.keyTail + "，留空不修改）";
        }
        return true;
      }

      async function doSave(btn) {
        btn.disabled = true;
        try {
          await collect(false);
          await refresh();
          toast("已保存");
        } catch (e) {
          toast("保存失败：" + e.message);
        }
        btn.disabled = false;
      }
      saveSimple.addEventListener("click", () => doSave(saveSimple));
      saveBtn.addEventListener("click", () => doSave(saveBtn));

      // 测试连接：先自动保存当前表单（含密钥），再测
      async function doTest(btn, st) {
        btn.disabled = true;
        st.className = "status-line";
        st.textContent = "保存并测试中…";
        try {
          await collect(true);
          const j = await api("/api/llm/test", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerId: p.id })
          });
          st.className = "status-line ok";
          st.textContent = "连接成功（" + j.latencyMs + "ms）：" + j.message;
        } catch (e) {
          st.className = "status-line err";
          st.textContent = "连接失败：" + e.message;
        }
        btn.disabled = false;
      }
      testSimple.addEventListener("click", () => doTest(testSimple, simpleStatus));
      testBtn.addEventListener("click", () => doTest(testBtn, status));

      box.append(detail);
      return box;
    }

    function openModelPicker(p, models) {
      const mask = el("div", "modal-mask");
      const card = el("div", "modal-card modal-sm");
      const head = el("div", "modal-head");
      head.append(el("h2", null, "选择要添加的模型"));
      const close = el("button", "icon-btn modal-close", "✕");
      close.title = "关闭";
      close.addEventListener("click", () => mask.remove());
      head.append(close);
      const body = el("div", "modal-body");
      const existing = new Set(p.models.map((m) => m.id));
      const list = el("div", "model-check-list");
      const checkboxes = [];
      for (const id of models) {
        const row = el("label", "model-check-row");
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = false;
        row.append(cb, el("span", null, id));
        if (existing.has(id)) row.append(el("span", "hint", "已添加"));
        list.append(row);
        checkboxes.push({ cb, id });
      }
      body.append(el("div", "hint", "共 " + models.length + " 个可用模型，默认未勾选。"));
      body.append(list);
      const foot = el("div", "modal-foot");
      const all = el("button", "btn btn-ghost btn-sm", "全选");
      const none = el("button", "btn btn-ghost btn-sm", "取消全选");
      const cancel = el("button", "btn btn-ghost", "取消");
      const addSel = el("button", "btn btn-primary", "添加所选");
      const counter = el("span", "status-line");
      const update = () => { counter.textContent = "已选 " + checkboxes.filter((x) => x.cb.checked).length + " 项"; };
      all.addEventListener("click", () => { checkboxes.forEach((x) => { x.cb.checked = true; }); update(); });
      none.addEventListener("click", () => { checkboxes.forEach((x) => { x.cb.checked = false; }); update(); });
      cancel.addEventListener("click", () => mask.remove());
      addSel.addEventListener("click", () => {
        let added = 0;
        for (const x of checkboxes) {
          if (!x.cb.checked) continue;
          if (!p.models.some((m) => m.id === x.id)) {
            p.models.push({ id: x.id, name: x.id, contextWindow: null, maxOutputTokens: null });
            added++;
          }
        }
        if (!p.defaultModelId && p.models.length) p.defaultModelId = p.models[0].id;
        mask.remove();
        render();
        toast("已添加 " + added + " 个模型");
      });
      foot.append(all, none, counter, cancel, addSel);
      card.append(head, body, foot);
      mask.append(card);
      window.closeModalOnBackdrop(mask, () => mask.remove());
      document.body.appendChild(mask);
      update();
    }

    // 添加提供方：DeepSeek 预设 + 简化模式（只展示密钥），自定义入口在「自定义」按钮
    addDefaultBtn.addEventListener("click", () => {
      const preset = PRESETS.find((x) => x.id === "deepseek");
      state.providers.push({
        id: preset.id, name: preset.name, baseUrl: preset.baseUrl, protocol: preset.protocol,
        apiKey: "", keyTail: "", hasKey: false,
        defaultModelId: preset.models[0],
        models: preset.models.map((id) => ({ id, name: id, contextWindow: null, maxOutputTokens: null })),
        __expanded: true, __focusKey: true, __simple: true, __nameTouched: false
      });
      if (!state.defaultProviderId) state.defaultProviderId = preset.id;
      render();
    });

    refresh().catch((e) => toast("加载失败：" + e.message));
  }

  // ---------- 个性化 ----------
  function buildAppearance(sec) {
    sec.append(el("p", "sub", "主题与界面偏好。"));
    const card = el("div", "settings-card region");
    card.append(el("h2", null, "主题"));
    const row = el("div", "form-row");
    row.append(el("label", null, "外观模式"));
    const seg = el("div", "seg");
    const btns = {};
    for (const t of window.Theme?.ORDER || ["system", "dark", "light"]) {
      const btn = el("button", "seg-btn", window.Theme?.LABELS?.[t] || t);
      btn.addEventListener("click", () => { window.Theme?.set(t); refreshSeg(); });
      seg.append(btn);
      btns[t] = btn;
    }
    const refreshSeg = () => {
      const cur = window.Theme?.get() || "system";
      for (const [t, b] of Object.entries(btns)) b.classList.toggle("active", t === cur);
    };
    row.append(seg);
    card.append(row, el("div", "hint", "跟随系统：随操作系统深色/浅色模式自动切换。"));
    sec.append(card);

    const nameCard = el("div", "settings-card region");
    nameCard.append(el("h2", null, "操作人昵称"));
    const nameRow = el("div", "form-row");
    nameRow.append(el("label", null, "署名"));
    const nameInput = el("input", "input");
    nameInput.value = window.userName ? window.userName() : "我";
    nameInput.placeholder = "用于评论署名与任务轨迹，默认「我」";
    nameInput.addEventListener("change", () => {
      const v = nameInput.value.trim();
      if (v) localStorage.setItem("tb-user-name", v);
      else localStorage.removeItem("tb-user-name");
      toast("已保存：评论与轨迹将以「" + (v || "我") + "」署名");
    });
    nameRow.append(nameInput);
    nameCard.append(nameRow, el("div", "hint", "这条名字会出现在任务轨迹与评论里，例如：张三 将卡片从「待办」移至「进行中」。"));
    sec.append(nameCard);

    refreshSeg();
  }

  // ---------- 数据 ----------
  function buildData(sec) {
    sec.append(el("p", "sub", "整库备份与恢复。导入将整体替换当前看板数据。"));
    const card = el("div", "settings-card region");
    card.append(el("h2", null, "备份"));
    const actions = el("div", "settings-actions");
    const exportBtn = el("button", "btn btn-outline", "导出 JSON");
    const importBtn = el("button", "btn btn-outline", "导入 JSON");
    const fileInput = el("input");
    fileInput.type = "file"; fileInput.accept = ".json,application/json"; fileInput.style.display = "none";
    actions.append(exportBtn, importBtn, fileInput);
    card.append(actions);
    const result = el("div", "status-line");
    card.append(result);
    sec.append(card);

    exportBtn.addEventListener("click", () => { window.location.href = "/api/export"; });
    importBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      if (!confirm("导入将整体替换当前看板数据，确定继续？")) return;
      result.className = "status-line";
      result.textContent = "导入中…";
      try {
        const data = JSON.parse(await file.text());
        const res = await fetch("/api/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: data.tasks ?? data })
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "导入失败");
        result.className = "status-line ok";
        result.textContent = "导入完成：" + j.imported + " 条任务" + (j.skipped ? "（跳过 " + j.skipped + " 条非法条目）" : "");
        toast("导入完成，共 " + j.imported + " 条任务");
        window.BoardApp?.load?.();
      } catch (e) {
        result.className = "status-line err";
        result.textContent = "导入失败：" + e.message;
      }
    });
  }

  // Esc 关闭（最后一个打开的设置窗）
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".panel-mask");
    if (open && document.querySelectorAll(".panel-mask").length === 1) open.remove();
  });


  // ---------- 标签管理：标签列表（名称 / 创建人 / 创建时间），＋ 新增，点击行修改/删除 ----------
  function buildTags(sec) {
    sec.append(el("p", "sub", "自定义任务标签与颜色。新建/编辑任务时可直接点选，看板卡片上以对应颜色的小方块展示。"));
    const card = el("div", "settings-card region");

    const head = el("div", "tag-manage-head");
    head.append(el("h2", null, "标签列表"));
    const addBtn = el("button", "tag-add-btn", "+");
    addBtn.title = "新增标签";
    addBtn.setAttribute("aria-label", "新增标签");
    head.append(addBtn);
    card.append(head);

    const list = el("div", "tag-manage-list");
    card.append(list);

    const editor = el("div", "tag-edit-panel");
    editor.style.display = "none";
    card.append(editor);
    sec.append(card);

    const palette = window.TAG_COLORS || [];
    let state = [];       // [{name,color,creator,createdAt}]
    let editing = null;   // null | { kind: "add" } | { kind: "edit", index }

    const fmt = (iso) => {
      if (!iso) return "—";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      const p = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    };
    const nextColor = () => {
      const used = new Set(state.map((t) => t.color).filter(Boolean));
      for (const c of palette) if (!used.has(c)) return c;
      return palette[used.size % palette.length] || "";
    };
    const nickname = () => (window.userName || (() => "我"))();

    function renderList() {
      list.innerHTML = "";
      if (!state.length) {
        list.append(el("div", "hint", "还没有标签，点右上角 ＋ 新增一个。"));
        return;
      }
      const hd = el("div", "tag-list-head");
      hd.append(el("span", null, ""), el("span", null, "标签名"), el("span", null, "创建人"), el("span", null, "创建时间"));
      list.append(hd);
      state.forEach((t, i) => {
        const row = el("div", "tag-row");
        const sw = el("span", "tag-swatch-static");
        if (t.color) sw.style.setProperty("--tag-color", t.color);
        const nm = el("span", "c-name", t.name);
        const cr = el("span", "c-creator", t.creator || "—");
        cr.title = t.creator || "";
        const tm = el("span", "c-time", fmt(t.createdAt));
        row.append(sw, nm, cr, tm);
        row.addEventListener("click", () => { editing = { kind: "edit", index: i }; renderEditor(); });
        list.append(row);
      });
    }

    function renderEditor() {
      editor.innerHTML = "";
      editor.style.display = editing ? "" : "none";
      if (!editing) return;

      const isEdit = editing.kind === "edit";
      const base = isEdit && state[editing.index] ? state[editing.index] : {
        name: "", color: nextColor(), creator: nickname(), createdAt: new Date().toISOString()
      };
      let localColor = base.color;

      editor.append(el("div", "tag-edit-title", isEdit ? "编辑标签" : "新增标签"));

      const line = el("div", "tag-edit-line");
      const nameInput = el("input", "input");
      nameInput.value = base.name;
      nameInput.placeholder = "标签名（必填，不超过 20 字）";
      nameInput.maxLength = 20;
      const swatch = el("button", "tag-swatch");
      swatch.type = "button";
      swatch.title = "选择标签颜色";
      swatch.setAttribute("aria-label", "选择标签颜色");
      const applyColor = (c) => {
        localColor = c || "";
        swatch.style.setProperty("--tag-color", c || "#7a7f8a");
      };
      applyColor(localColor);
      swatch.addEventListener("click", (e) => {
        e.stopPropagation();
        const existing = line.querySelector(".tag-color-pop");
        if (existing) { existing.remove(); return; }
        closeColorPops();
        const pop = el("div", "tag-color-pop");
        for (const c of palette) {
          const b = el("button", "tag-color-opt");
          b.type = "button";
          b.style.setProperty("--tag-color", c);
          b.title = c;
          if (c === localColor) b.classList.add("sel");
          b.addEventListener("click", () => { applyColor(c); pop.remove(); });
          pop.append(b);
        }
        const custom = el("label", "tag-color-opt tag-color-custom");
        custom.title = "自定义颜色";
        const cin = el("input");
        cin.type = "color";
        cin.value = /^#[0-9a-fA-F]{6}$/.test(localColor) ? localColor : "#4176e6";
        cin.addEventListener("input", () => applyColor(cin.value));
        cin.addEventListener("change", () => pop.remove());
        custom.append(cin);
        pop.append(custom);
        line.append(pop);
      });
      line.append(swatch, nameInput);
      editor.append(line);

      const meta = el("div", "tag-edit-meta");
      meta.append(el("span", null, "创建人：" + (base.creator || "—")));
      meta.append(el("span", null, "创建时间：" + fmt(base.createdAt)));
      editor.append(meta);

      const acts = el("div", "settings-actions");
      const saveBtn = el("button", "btn btn-primary btn-sm", "保存");
      const cancelBtn = el("button", "btn btn-outline btn-sm", "取消");
      acts.append(saveBtn, cancelBtn);
      if (isEdit) {
        const delBtn = el("button", "btn btn-danger btn-sm", "删除");
        delBtn.addEventListener("click", async () => {
          delBtn.disabled = true;
          try {
            state.splice(editing.index, 1);
            await persist();
            editing = null;
            renderEditor();
            renderList();
            toast("已删除");
          } catch (e) { toast("删除失败：" + e.message); delBtn.disabled = false; }
        });
        acts.append(delBtn);
      }
      editor.append(acts);

      saveBtn.addEventListener("click", async () => {
        const v = nameInput.value.trim();
        if (!v) { toast("请输入标签名"); nameInput.focus(); return; }
        const dup = state.find((x, idx) => x.name === v && (editing.kind === "add" || idx !== editing.index));
        if (dup) { toast("已存在同名标签"); nameInput.focus(); return; }
        saveBtn.disabled = true;
        try {
          const entry = { name: v.slice(0, 20), color: localColor, creator: base.creator || "", createdAt: base.createdAt || "" };
          if (editing.kind === "add") state.push(entry);
          else state[editing.index] = entry;
          await persist();
          editing = null;
          renderEditor();
          renderList();
          toast("已保存");
        } catch (e) { toast("保存失败：" + e.message); saveBtn.disabled = false; }
      });

      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); saveBtn.click(); }
      });

      cancelBtn.addEventListener("click", () => { editing = null; renderEditor(); renderList(); });
      nameInput.focus();
      editor.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    async function persist() {
      const j = await api("/api/tags", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: state })
      });
      state = Array.isArray(j.tags) ? j.tags : [];
      window.TagBook?.invalidate?.();
      window.BoardApp?.load?.();
    }

    addBtn.addEventListener("click", () => { editing = { kind: "add" }; renderEditor(); });

    (async () => {
      const j = await api("/api/tags").catch(() => ({ tags: [] }));
      state = Array.isArray(j.tags) ? j.tags : [];
      renderList();
    })().catch((e) => toast("加载失败：" + e.message));
  }

  window.SettingsPanel = { open };
})();
