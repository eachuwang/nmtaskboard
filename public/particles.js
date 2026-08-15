(() => {
  "use strict";
  // 粒子时序：随机飘动 0.5s → 由慢到快线性聚合「Generating」→ 流式开始后散开到随机状态并淡出
  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function show(container, text) {
    if (!container) return { stop() {} };
    const ov = document.createElement("div");
    ov.className = "particle-overlay";
    const stage = document.createElement("div");
    stage.className = "particle-stage";
    ov.appendChild(stage);
    container.appendChild(ov);

    const fallback = (label) => {
      const d = document.createElement("div");
      d.className = "particle-fallback";
      d.textContent = label + "…";
      stage.appendChild(d);
      return { stop() { ov.remove(); } };
    };
    if (REDUCE) return fallback(text);

    const TW = 340, TH = 110;
    const off = document.createElement("canvas");
    off.width = TW; off.height = TH;
    const octx = off.getContext("2d");
    const textColor = (getComputedStyle(document.body).getPropertyValue("--text-primary") || "#f9fafb").trim();
    octx.fillStyle = textColor;
    octx.font = "700 54px 'Geist Sans', -apple-system, 'Segoe UI', 'PingFang SC', sans-serif";
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    octx.fillText(text, TW / 2, TH / 2);
    const data = octx.getImageData(0, 0, TW, TH).data;

    const px = [];
    const gap = 3;
    for (let y = 0; y < TH; y += gap) {
      for (let x = 0; x < TW; x += gap) {
        const i = (y * TW + x) * 4;
        if (data[i + 3] > 60) px.push({ x, y });
      }
    }
    if (!px.length) return fallback(text);

    const rect = container.getBoundingClientRect();
    const W = Math.max(200, Math.round(rect.width));
    const H = Math.max(120, Math.round(rect.height));
    const canvas = document.createElement("canvas");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    stage.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    let cr = 249, cg = 250, cb = 251;
    const m = textColor.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
    if (m) { cr = +m[1]; cg = +m[2]; cb = +m[3]; }
    else if (textColor.startsWith("#") && textColor.length >= 7) {
      cr = parseInt(textColor.slice(1, 3), 16);
      cg = parseInt(textColor.slice(3, 5), 16);
      cb = parseInt(textColor.slice(5, 7), 16);
    }

    const cx = W / 2, cy = H / 2;
    const ox = cx - TW / 2, oy = cy - TH / 2;

    // 初始：随机散布在编辑区内，随机速度漂移
    const particles = px.map((p) => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 1.2,
      vy: (Math.random() - 0.5) * 1.2,
      sx: 0, sy: 0,
      hx: ox + p.x, hy: oy + p.y,
      repX: 0, repY: 0, inZone: false,
      outDX: 0, outDY: 0
    }));

    const mouse = { x: -99999, y: -99999, active: false };
    const smooth = { x: -99999, y: -99999 };
    const REP_R = 64;
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = (e.clientX - r.left) * (W / r.width);
      mouse.y = (e.clientY - r.top) * (H / r.height);
      mouse.active = true;
    });
    canvas.addEventListener("pointerleave", () => { mouse.active = false; });

    const DRIFT_DUR = 500;
    const IN_DUR = 1000;
    const OUT_DUR = 700;
    let phase = "drift";
    let t0 = performance.now();
    let scatterQueued = false;
    let raf;

    function frame(now) {
      raf = requestAnimationFrame(frame);

      if (mouse.active) {
        if (smooth.x < -9000) { smooth.x = mouse.x; smooth.y = mouse.y; }
        else {
          smooth.x += (mouse.x - smooth.x) * 0.3;
          smooth.y += (mouse.y - smooth.y) * 0.3;
        }
      }

      // 相位推进
      if (phase === "drift" && now - t0 >= DRIFT_DUR) {
        phase = "in";
        t0 = now;
        for (const p of particles) { p.sx = p.x; p.sy = p.y; }
      } else if (phase === "in" && now - t0 >= IN_DUR) {
        phase = "settle";
      }
      if (scatterQueued && phase !== "out") {
        phase = "out";
        t0 = now;
        for (const p of particles) {
          const tx = Math.random() * W;
          const ty = Math.random() * H;
          p.outDX = tx - p.hx;
          p.outDY = ty - p.hy;
        }
      }

      const inT = phase === "in" ? Math.min(1, (now - t0) / IN_DUR) : 1;
      const eIn = Math.pow(inT, 3); // 由慢到快
      const outT = phase === "out" ? Math.min(1, (now - t0) / OUT_DUR) : 0;
      const eOut = 1 - Math.pow(1 - outT, 3);
      const fadeOut = phase === "out" ? 1 - Math.pow(outT, 3) : 1; // 先慢后快淡出

      ov.style.opacity = String(fadeOut);

      ctx.clearRect(0, 0, W, H);
      const shimmer = 0.72 + 0.28 * Math.sin(now / 260);
      // 颜色深化：飘动阶段极淡，随聚合过程由浅渐深到完整颜色
      let deepen;
      if (phase === "drift") deepen = 0.12;
      else if (phase === "in") deepen = 0.12 + 0.88 * eIn;
      else deepen = 1;
      const alpha = 0.92 * deepen * fadeOut * shimmer;
      if (phase === "out" && outT >= 1) { cancelAnimationFrame(raf); ov.remove(); return; }

      ctx.fillStyle = "rgba(" + cr + "," + cg + "," + cb + "," + alpha.toFixed(3) + ")";
      for (const p of particles) {
        let bx, by;
        if (phase === "drift") {
          // 混沌随机漂移（限速 + 软反弹）
          p.vx += (Math.random() - 0.5) * 0.22;
          p.vy += (Math.random() - 0.5) * 0.22;
          const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (sp > 1.6) { p.vx = (p.vx / sp) * 1.6; p.vy = (p.vy / sp) * 1.6; }
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > W) { p.vx *= -1; p.x = Math.min(W, Math.max(0, p.x)); }
          if (p.y < 0 || p.y > H) { p.vy *= -1; p.y = Math.min(H, Math.max(0, p.y)); }
          bx = p.x; by = p.y;
        } else if (phase === "in") {
          bx = p.sx + (p.hx - p.sx) * eIn;
          by = p.sy + (p.hy - p.sy) * eIn;
        } else {
          bx = p.hx; by = p.hy;
        }

        // 斥力（聚合后有效）
        if (phase !== "out" && phase !== "drift" && mouse.active) {
          const dx = bx + p.repX - smooth.x;
          const dy = by + p.repY - smooth.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0 && dist < REP_R) {
            const nx = dx / dist, ny = dy / dist;
            p.repX += (nx * (REP_R - dist) - p.repX) * 0.16;
            p.repY += (ny * (REP_R - dist) - p.repY) * 0.16;
            p.inZone = true;
          } else {
            p.inZone = false;
          }
        } else {
          p.inZone = false;
        }
        if (!p.inZone) { p.repX *= 0.92; p.repY *= 0.92; }

        const x = bx + p.repX + (phase === "out" ? p.outDX * eOut : 0);
        const y = by + p.repY + (phase === "out" ? p.outDY * eOut : 0);
        ctx.fillRect(x, y, 2, 2);
      }
    }
    raf = requestAnimationFrame(frame);

    return {
      // 开始散出（流式首增量到达时调用）；也可作为兜底停止
      stop() { scatterQueued = true; }
    };
  }

  // ---------- 卡片溶解：把 DOM 卡片栅格化为像素，粒子爆散消失 ----------
  function inlineStyles(clone, src) {
    const cQ = [clone], sQ = [src];
    const props = ["color", "background-color", "border-color", "border-width", "border-style", "border-radius",
      "font-family", "font-size", "font-weight", "line-height", "padding", "margin", "display", "white-space", "opacity"];
    while (cQ.length) {
      const cEl = cQ.shift(), sEl = sQ.shift();
      if (!cEl || !sEl || cEl.nodeType !== 1) continue;
      const cs = getComputedStyle(sEl);
      let css = "";
      for (const prop of props) {
        const v = cs.getPropertyValue(prop);
        if (v && v !== "none" && v !== "0px") css += prop + ":" + v + ";";
      }
      cEl.setAttribute("style", css);
      const cKids = Array.from(cEl.children), sKids = Array.from(sEl.children);
      for (let i = 0; i < cKids.length; i++) { cQ.push(cKids[i]); sQ.push(sKids[i]); }
    }
  }

  async function cardToPixels(card) {
    const w = Math.max(40, card.offsetWidth), h = Math.max(24, card.offsetHeight);
    const clone = card.cloneNode(true);
    clone.classList.remove("card-lift");
    inlineStyles(clone, card);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject width="100%" height="100%">' + new XMLSerializer().serializeToString(clone) + '</foreignObject></svg>';
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const off = document.createElement("canvas");
      off.width = w; off.height = h;
      const octx = off.getContext("2d");
      octx.drawImage(img, 0, 0, w, h);
      const data = octx.getImageData(0, 0, w, h).data;
      const pixels = [];
      const gap = 2;
      for (let y = 0; y < h; y += gap) {
        for (let x = 0; x < w; x += gap) {
          const i = (y * w + x) * 4;
          if (data[i + 3] > 12) pixels.push({ x, y, r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] });
        }
      }
      return { w, h, pixels };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function cssRgb(varName, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(varName).trim();
    const m = v.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
    if (m) return [+m[1], +m[2], +m[3]];
    const h = v.replace("#", "");
    const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(f, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // 礼花洒落动画：初速 30-120px/s、重力 360px/s²、空气阻力、2s 生命周期、
  // cubic-bezier(0.4,0,0.2,1) 牛顿迭代淡出、0.12s 长大
  const X1 = 0.4, Y1 = 0, X2 = 0.2, Y2 = 1;
  function fadeEase(t) {
    let s = Math.max(0, Math.min(1, t));
    for (let i = 0; i < 8; i++) {
      const u = 1 - s;
      const cx = 3 * u * u * s * X1 + 3 * u * s * s * X2 + s * s * s - t;
      const dx = 3 * u * u * X1 + 6 * u * s * (X2 - X1) + 3 * s * s * (1 - X2);
      if (Math.abs(dx) < 1e-6) break;
      s -= cx / dx;
      s = Math.max(0, Math.min(1, s));
    }
    const u = 1 - s;
    return 3 * u * u * s * Y1 + 3 * u * s * s * Y2 + s * s * s;
  }

  function windScatter(layer, rect, particles, onDone) {
    const canvas = layer.querySelector("canvas");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const GRAVITY = 360;      // px/s²
    const LIFE = 2000;        // ms
    const GROW = 120;         // ms 长大
    const t0 = performance.now();
    let last = t0;

    const pts = particles.map((p) => {
      const angle = Math.random() * Math.PI * 2;
      const sp = (Math.random() * 3 + 1) * 30; // 30-120 px/s
      return {
        x: p.x, y: p.y, r: p.r, g: p.g, b: p.b,
        vx: Math.cos(angle) * sp,
        vy: Math.sin(angle) * sp
      };
    });

    function frame(now) {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const t = Math.min(1, (now - t0) / LIFE);
      ctx.clearRect(0, 0, rect.width, rect.height);

      for (const p of pts) {
        // 重力 + 空气阻力
        p.vy += GRAVITY * 36 * dt;
        const drag = Math.pow(0.98, dt * 60);
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // 淡出（easeInOut 曲线控制 1→0）
        const alpha = (1 - fadeEase(t)) * 0.95;
        if (alpha <= 0.02) continue;

        // 尺寸：0.12s 长大 → 随寿命轻微缩小
        let sizeMul;
        if (t * LIFE < GROW) {
          sizeMul = 0.6 + 0.4 * ((t * LIFE) / GROW);
        } else {
          sizeMul = 1 - 0.3 * ((t * LIFE - GROW) / (LIFE - GROW));
        }
        const s = 2 * sizeMul;
        ctx.fillStyle = "rgba(" + p.r + "," + p.g + "," + p.b + "," + alpha.toFixed(3) + ")";
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }

      if (t < 1) requestAnimationFrame(frame);
      else { layer.remove(); onDone?.(); }
    }
    requestAnimationFrame(frame);
  }

  function dissolve(card) {
    if (REDUCE || !card) { card.style.visibility = "hidden"; return; }
    const rect = card.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.style.cssText = "position:fixed; left:" + rect.left + "px; top:" + rect.top + "px; width:" + rect.width + "px; height:" + rect.height + "px; z-index:var(--z-float); pointer-events:none;";
    const canvas = document.createElement("canvas");
    layer.appendChild(canvas);
    document.body.appendChild(layer);

    // 降级：栅格化失败时用卡片主色的均匀粒子风
    const fallback = () => {
      card.style.visibility = "hidden";
      const base = cssRgb("--text-secondary", "#61666b");
      const n = 1400;
      const pts = [];
      for (let i = 0; i < n; i++) {
        // 深一点的灰，略带明暗变化
        const v = 0.75 + Math.random() * 0.3;
        pts.push({
          x: Math.random() * rect.width,
          y: Math.random() * rect.height,
          r: Math.min(255, base[0] * v),
          g: Math.min(255, base[1] * v),
          b: Math.min(255, base[2] * v)
        });
      }
      windScatter(layer, rect, pts);
    };

    cardToPixels(card).then(({ pixels }) => {
      if (pixels.length < 24) { fallback(); return; }
      card.style.visibility = "hidden";
      windScatter(layer, rect, pixels);
    }).catch(fallback);
  }

  window.ParticleOverlay = { show, dissolve };
})();
