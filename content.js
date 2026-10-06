(() => {
  if (window.__clearViewLoaded) return;
  window.__clearViewLoaded = true;

  const DEFAULTS = { enabled: true, reduction: 100, hiddenSelectors: [] };
  const adjusted = new Map();
  const hostKey = `site:${location.hostname}`;
  let settings = { ...DEFAULTS };
  let scanTimer;
  let pickerCleanup;

  function collectVideos(root, found) {
    if (!root?.querySelectorAll || found.length > 12) return;
    root.querySelectorAll("video").forEach((video) => found.push(video));
    root.querySelectorAll("*").forEach((element) => {
      if (element.shadowRoot) collectVideos(element.shadowRoot, found);
    });
  }

  function visibleVideos() {
    const found = [];
    collectVideos(document, found);
    return found.filter((video) => {
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      const onScreen = rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
      return (
        onScreen &&
        rect.width >= 160 &&
        rect.height >= 90 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0
      );
    });
  }

  function ownsMedia(element, video) {
    let node = video;
    const seen = new Set();
    while (node && !seen.has(node)) {
      seen.add(node);
      if (node === element) return true;
      if (node.parentElement) {
        node = node.parentElement;
        continue;
      }
      const root = node.getRootNode?.();
      node = root instanceof ShadowRoot ? root.host : null;
    }
    return false;
  }

  function mediaContainers(video) {
    const containers = [];
    let node = video;
    const seen = new Set();
    while (node && containers.length < 12 && !seen.has(node)) {
      seen.add(node);
      let next = node.parentElement;
      if (!next) {
        const root = node.getRootNode?.();
        next = root instanceof ShadowRoot ? root.host : null;
      }
      if (!next || next === document.body || next === document.documentElement) break;
      containers.push(next);
      node = next;
    }
    return containers;
  }

  function overlapRatio(a, b) {
    const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return (width * height) / Math.max(1, b.width * b.height);
  }

  function rgba(value) {
    const match = value.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\)/);
    return match
      ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4] ?? 1) }
      : null;
  }

  function hasDarkGradient(image) {
    if (!image || image === "none" || !/gradient/i.test(image)) return false;
    return [...image.matchAll(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\)/g)].some(
      (match) => {
        const alpha = match[4] == null ? 1 : match[4].endsWith("%") ? Number.parseFloat(match[4]) / 100 : Number(match[4]);
        return alpha > 0.08 && Number(match[1]) < 90 && Number(match[2]) < 90 && Number(match[3]) < 90;
      },
    );
  }

  function hasDarkPaint(element, style) {
    const color = rgba(style.backgroundColor);
    const darkColor = color && color.a > 0.05 && color.r < 80 && color.g < 80 && color.b < 80;
    const hint = `${element.id} ${element.className || ""}`.toLowerCase();
    return darkColor || hasDarkGradient(style.backgroundImage) || /(scrim|shade|darken|gradient-overlay|video-overlay)/.test(hint);
  }

  function isScrimLayer(style) {
    const color = rgba(style.backgroundColor);
    const translucentDark = color && color.a > 0.04 && color.a < 0.95 && color.r < 90 && color.g < 90 && color.b < 90;
    return translucentDark || hasDarkGradient(style.backgroundImage);
  }

  function pseudoOverlaySides(element) {
    const host = element.getBoundingClientRect();
    if (host.width < 160 || host.height < 90) return [];
    const sides = [];
    for (const [side, name] of [["::before", "before"], ["::after", "after"]]) {
      const style = getComputedStyle(element, side);
      if (style.content === "none" || style.content === "normal") continue;
      if (style.position !== "absolute" && style.position !== "fixed") continue;
      const width = Number.parseFloat(style.width);
      const height = Number.parseFloat(style.height);
      if (width < host.width * 0.6 || height < host.height * 0.6) continue;
      if (!isScrimLayer(style)) continue;
      sides.push(name);
    }
    return sides;
  }

  function isLikelyOverlay(element, video) {
    if (!(element instanceof HTMLElement) || element.tagName === "VIDEO") return false;
    if (element === document.body || element === document.documentElement) return false;
    if (ownsMedia(element, video)) return false;
    const videoRect = video.getBoundingClientRect();

    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || overlapRatio(rect, videoRect) < 0.45) return false;
    if (rect.width * rect.height > videoRect.width * videoRect.height * 1.8) return false;

    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (!hasDarkPaint(element, style)) return false;

    // Player control containers often cover the video too; preserve anything interactive.
    if (element.matches("button, input, [role='button'], [role='dialog'], [aria-modal='true']")) return false;
    if (element.querySelector("button, input, select, [role='button'], [role='slider'], [role='menu']")) return false;
    if ((element.textContent || "").trim().length > 80) return false;

    return true;
  }

  function candidatesFor(video) {
    const rect = video.getBoundingClientRect();
    const points = [
      [rect.left + rect.width * 0.5, rect.top + rect.height * 0.25],
      [rect.left + rect.width * 0.5, rect.top + rect.height * 0.5],
      [rect.left + rect.width * 0.2, rect.top + rect.height * 0.5],
      [rect.left + rect.width * 0.8, rect.top + rect.height * 0.5],
      [rect.left + rect.width * 0.5, rect.top + rect.height * 0.75],
    ];
    const candidates = new Set();

    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      for (const element of document.elementsFromPoint(x, y)) {
        if (element === video) break;
        candidates.add(element);
      }
    }

    // Pointer-transparent scrims do not appear in elementsFromPoint().
    // Limit this fallback to overlay-like names near the player to avoid a full DOM scan.
    let container = video.parentElement;
    for (let depth = 0; container && depth < 3; depth += 1, container = container.parentElement) {
      container
        .querySelectorAll(
          '[class*="scrim" i], [class*="shade" i], [class*="gradient" i], [class*="video-overlay" i], [id*="scrim" i], [id*="video-overlay" i]',
        )
        .forEach((element) => candidates.add(element));
    }

    return [...candidates].filter((element) => isLikelyOverlay(element, video));
  }

  function restoreAdjusted() {
    for (const [element, original] of adjusted) {
      if (!element.isConnected) continue;
      if (original.kind === "opacity") {
        if (original.value) element.style.setProperty("opacity", original.value.value, original.value.priority);
        else element.style.removeProperty("opacity");
        element.removeAttribute("data-clearview-overlay");
      } else {
        element.removeAttribute("data-clearview-pseudo");
      }
    }
    adjusted.clear();
    document.documentElement.style.removeProperty("--clearview-remaining");
  }

  function rememberOpacity(element) {
    if (adjusted.has(element)) return;
    const value = element.style.getPropertyValue("opacity");
    adjusted.set(element, {
      kind: "opacity",
      value: value ? { value, priority: element.style.getPropertyPriority("opacity") } : null,
    });
    element.setAttribute("data-clearview-overlay", "");
  }

  function rememberPseudo(element) {
    if (adjusted.has(element)) return;
    const sides = pseudoOverlaySides(element);
    if (!sides.length) return;
    adjusted.set(element, { kind: "pseudo", sides });
    element.setAttribute("data-clearview-pseudo", sides.join(" "));
  }

  function applyReduction(reduction = settings.reduction) {
    const remaining = String(Math.max(0, 1 - reduction / 100));
    document.documentElement.style.setProperty("--clearview-remaining", remaining);
    for (const [element, original] of adjusted) {
      if (original.kind === "opacity" && element.isConnected) {
        element.style.setProperty("opacity", remaining, "important");
      }
    }
  }

  function applyHiddenSelectors() {
    document.querySelectorAll("[data-clearview-hidden]").forEach((element) => {
      element.style.removeProperty("display");
      element.removeAttribute("data-clearview-hidden");
    });
    if (!settings.enabled) return;

    for (const selector of settings.hiddenSelectors) {
      try {
        document.querySelectorAll(selector).forEach((element) => {
          element.setAttribute("data-clearview-hidden", "");
          element.style.setProperty("display", "none", "important");
        });
      } catch {
        // Ignore selectors invalidated by a site update.
      }
    }
  }

  function scan() {
    restoreAdjusted();
    applyHiddenSelectors();
    if (!settings.enabled) return 0;

    for (const video of visibleVideos()) {
      for (const element of candidatesFor(video)) rememberOpacity(element);
      for (const container of mediaContainers(video)) rememberPseudo(container);
    }

    applyReduction();
    return adjusted.size;
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 350);
  }

  function stableSelector(element) {
    if (element.id && !/^\d/.test(element.id)) return `#${CSS.escape(element.id)}`;

    const path = [];
    let node = element;
    while (node && node !== document.body && path.length < 5) {
      let part = node.localName;
      const stableClasses = [...node.classList]
        .filter((name) => !/^(active|hover|focus|selected|open|visible|css-|[a-z]{1,3}\d{4,})$/i.test(name))
        .slice(0, 2);
      if (stableClasses.length) part += stableClasses.map((name) => `.${CSS.escape(name)}`).join("");
      const siblings = node.parentElement
        ? [...node.parentElement.children].filter((child) => child.localName === node.localName)
        : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      path.unshift(part);
      node = node.parentElement;
    }
    return path.join(" > ");
  }

  function startPicker() {
    pickerCleanup?.();
    let selected;
    const previousCursor = document.documentElement.style.cursor;

    const move = (event) => {
      if (selected) selected.style.removeProperty("outline");
      selected = event.target;
      selected.style.setProperty("outline", "2px solid #7188ff", "important");
    };

    const cleanup = () => {
      if (selected) selected.style.removeProperty("outline");
      document.documentElement.style.cursor = previousCursor;
      removeEventListener("mousemove", move, true);
      removeEventListener("click", choose, true);
      removeEventListener("keydown", cancel, true);
      pickerCleanup = null;
    };

    const choose = async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const selector = stableSelector(event.target);
      settings.hiddenSelectors = [...new Set([...settings.hiddenSelectors, selector])];
      await chrome.storage.local.set({ [hostKey]: settings });
      cleanup();
      applyHiddenSelectors();
    };

    const cancel = (event) => {
      if (event.key === "Escape") cleanup();
    };

    document.documentElement.style.cursor = "crosshair";
    addEventListener("mousemove", move, true);
    addEventListener("click", choose, true);
    addEventListener("keydown", cancel, true);
    pickerCleanup = cleanup;
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "get-status") respond({ detected: adjusted.size });
    if (message.type === "rescan") respond({ detected: scan() });
    if (message.type === "preview-reduction") {
      applyReduction(message.reduction);
      respond({ detected: adjusted.size });
    }
    if (message.type === "apply-settings") {
      settings = { ...DEFAULTS, ...message.settings };
      respond({ detected: scan() });
    }
    if (message.type === "start-picker") {
      startPicker();
      respond({ started: true });
    }
    if (message.type === "reset-hidden") {
      settings.hiddenSelectors = [];
      applyHiddenSelectors();
      respond({ reset: true });
    }
  });

  chrome.storage.local.get(hostKey).then((stored) => {
    settings = { ...DEFAULTS, ...(stored[hostKey] || {}) };
    scan();
  });

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  addEventListener("resize", scheduleScan, { passive: true });
  document.addEventListener("play", scheduleScan, true);
})();
