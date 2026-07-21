/** Meme Vault — persistent, searchable image snippets for DAP. Zero external imports. */

const ITEMS_KEY = "memes-v1";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function cleanText(value, max = 80) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

export function parseTags(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,#\n]/u);
  return [...new Set(raw.map((tag) => cleanText(tag, 24).toLowerCase()).filter(Boolean))].slice(0, 12);
}

export function queryFromUtterance(value) {
  return cleanText(value, 100)
    .replace(/(짤|밈|meme|저장소|보관함|찾아\s*줘|찾아줘|보여\s*줘|보여줘|열어\s*줘|열어줘)/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleFromUtterance(value) {
  return cleanText(value, 100)
    .replace(/(짤|밈|meme|저장소|보관함)/giu, " ")
    .replace(/(만들어\s*줘|만들어|만들|생성해\s*줘|생성해|생성|그려\s*줘|그려|제작해\s*줘|제작)/gu, " ")
    .replace(/(하나|좀|해\s*줘|줘)/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectImageMime(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).match(/^GIF8[79]a$/u)) return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function fileBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function normalizeItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item.blobId === "string" && /^[0-9a-f]{64}$/u.test(item.blobId))
    .map((item) => ({
      id: item.blobId,
      blobId: item.blobId,
      title: cleanText(item.title) || "이름 없는 짤",
      tags: parseTags(item.tags),
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      usedAt: Number.isFinite(item.usedAt) ? item.usedAt : 0,
      useCount: Number.isFinite(item.useCount) ? Math.max(0, Math.trunc(item.useCount)) : 0,
    }));
}

export function activate(ctx) {
  const storage = ctx.host.storage;
  const windows = ctx.host.windows;
  const paste = ctx.host.paste;
  let palette = null;
  let pendingQuery = "";
  // ponytail: serialize the few metadata mutations; a database is unnecessary for a local image list.
  let mutation = Promise.resolve();

  async function readItems() {
    return normalizeItems(await storage.getJson(ITEMS_KEY));
  }

  async function writeItems(items) {
    await storage.setJson(ITEMS_KEY, items);
  }

  function enqueue(task) {
    mutation = mutation.then(task, task).catch((error) => {
      notice(`처리하지 못했어요: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
    return mutation;
  }

  function usablePalette() {
    return palette && !palette.isDestroyed();
  }

  async function buildState() {
    const [items, usage] = await Promise.all([readItems(), storage.usage()]);
    const cards = await Promise.all(
      items
        .sort((a, b) => (b.usedAt || b.createdAt) - (a.usedAt || a.createdAt))
        .map(async (item) => ({ ...item, imageUrl: await storage.blobUrl(item.blobId) })),
    );
    return { items: cards, usage };
  }

  async function pushState() {
    if (!usablePalette()) return;
    const state = await buildState();
    palette.postMessage({ type: "state", ...state, query: pendingQuery });
    pendingQuery = "";
  }

  function notice(message, tone = "info") {
    if (usablePalette()) palette.postMessage({ type: "notice", message, tone });
  }

  async function addFile(file, title, tags) {
    if (!file || typeof file !== "object") return;
    const bytes = fileBytes(file.bytes);
    const mime = bytes && bytes.byteLength <= MAX_FILE_BYTES ? detectImageMime(bytes) : null;
    if (!bytes || !mime) {
      notice("PNG·JPEG·GIF·WebP 이미지(20MB 이하)만 저장할 수 있어요.", "error");
      return;
    }
    const name = cleanText(file.name, 120) || `image-${Date.now()}`;
    const blobId = await storage.putBlob(bytes, { mime, name });
    const items = await readItems();
    const existing = items.find((item) => item.blobId === blobId);
    if (existing) {
      existing.title = cleanText(title) || existing.title;
      existing.tags = parseTags(tags).length ? parseTags(tags) : existing.tags;
      notice("이미 저장된 짤이라 정보를 갱신했어요.");
    } else {
      items.unshift({
        id: blobId,
        blobId,
        title: cleanText(title) || cleanText(name.replace(/\.[^.]+$/u, "")) || `새 짤 ${items.length + 1}`,
        tags: parseTags(tags),
        createdAt: Date.now(),
        usedAt: 0,
        useCount: 0,
      });
      notice("짤을 저장했어요.", "success");
    }
    await writeItems(items);
    await pushState();
  }

  async function editItem(id, title, tags) {
    const items = await readItems();
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    item.title = cleanText(title) || item.title;
    item.tags = parseTags(tags);
    await writeItems(items);
    await pushState();
  }

  async function deleteItem(id) {
    const items = await readItems();
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    await writeItems(items.filter((candidate) => candidate.id !== id));
    await storage.deleteBlob(item.blobId);
    await pushState();
    notice("삭제했어요.");
  }

  async function pasteItem(id) {
    const items = await readItems();
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    const imageUrl = await storage.blobUrl(item.blobId);
    await paste.pasteItem({ kind: "image", blobUrl: imageUrl });
    item.usedAt = Date.now();
    item.useCount += 1;
    await writeItems(items);
    await pushState();
    if (usablePalette()) palette.postMessage({ type: "pasted", id });
  }

  function closePalette() {
    if (usablePalette()) palette.close();
    palette = null;
  }

  function openPalette(query = "") {
    // Reopen so DAP captures the app that should receive the next image paste.
    closePalette();
    pendingQuery = cleanText(query, 100);
    palette = windows.openPalette({
      page: "palette/index.html",
      width: 430,
      height: 620,
      frame: false,
      alwaysOnTop: true,
      visibleOnAllWorkspaces: true,
      level: "pop-up-menu",
      closeOnPetDrop: true,
    });
    palette.onMessage((msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "ready" || msg.type === "refresh") void pushState();
      if (msg.type === "addFile") void enqueue(() => addFile(msg.file, msg.title, msg.tags));
      if (msg.type === "edit") void enqueue(() => editItem(msg.id, msg.title, msg.tags));
      if (msg.type === "delete") void enqueue(() => deleteItem(msg.id));
      if (msg.type === "paste") void enqueue(() => pasteItem(msg.id));
    });
  }

  function togglePalette() {
    if (usablePalette()) closePalette();
    else openPalette();
  }

  ctx.actions.registerAction({ id: "toggleVault", callback: togglePalette });
  ctx.actions.registerAction({
    id: "findMeme",
    callback: (payload) => {
      const query = queryFromUtterance(payload?.text);
      openPalette(query);
      return query ? `'${query}'에 맞는 짤을 열었어!` : "짤 저장소를 열었어!";
    },
  });
  ctx.commands.addCommand({
    id: "findMeme",
    title: "짤 저장소",
    matchers: [{ type: "keyword", patterns: ["짤", "밈", "meme"], priority: 45 }],
    backend: { type: "builtin", handler: "io.github.o-min222.meme_vault.findMeme" },
  });

  // AI 짤 생성 (ctx.host.imageGen, permission image.generate) — 생성은 1~2분 걸리므로 즉시
  // ack를 돌려주고 백그라운드로 만든 뒤 말풍선으로 알린다. 완성본은 vault에 저장된다.
  const imageGen = ctx.host.imageGen;
  let generating = false;

  ctx.actions.registerAction({
    id: "generateMeme",
    callback: (payload) => {
      const text = cleanText(payload?.text, 200);
      if (!imageGen) return "짤 생성은 DAP 업데이트 후에 쓸 수 있어 (이미지 생성 지원 버전이 필요해).";
      if (generating) return "지금 다른 짤을 만들고 있어 — 끝나면 다시 말해줘!";
      generating = true;
      void (async () => {
        try {
          const image = await imageGen.generate(text || "재밌는 밈 이미지");
          const bytes = fileBytes(image.bytes);
          const mime = bytes && bytes.byteLength <= MAX_FILE_BYTES ? detectImageMime(bytes) : null;
          if (!bytes || !mime) throw new Error("생성 결과가 저장할 수 있는 이미지가 아니야");
          const title = titleFromUtterance(text) || "생성된 짤";
          // Serialize the metadata write with the palette's own mutations; `saved` tells us
          // whether it actually landed (enqueue swallows errors into a palette notice).
          let saved = false;
          await enqueue(async () => {
            const blobId = await storage.putBlob(bytes, { mime, name: cleanText(image.name, 120) || `gen-${Date.now()}.png` });
            const items = await readItems();
            if (!items.find((item) => item.blobId === blobId)) {
              items.unshift({ id: blobId, blobId, title, tags: ["생성"], createdAt: Date.now(), usedAt: 0, useCount: 0 });
              await writeItems(items);
            }
            saved = true;
          });
          await pushState();
          ctx.host.bubble?.speak(saved ? `'${title}' 짤 다 만들었어! 저장소에 넣어뒀어~` : "짤은 만들었는데 저장에 실패했어…");
        } catch (error) {
          ctx.host.bubble?.speak(`짤 생성에 실패했어… ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          generating = false;
        }
      })();
      return "좋아, 짤 만들어볼게! 1~2분 걸리니까 다 되면 말해줄게~";
    },
  });
  ctx.commands.addCommand({
    id: "generateMeme",
    title: "짤 생성",
    // findMeme(45)보다 우선 — "…짤 만들어줘"는 열기가 아니라 생성이다.
    matchers: [{ type: "regex", pattern: "(짤|밈|[Mm]eme)[^\\n]*(만들|생성|그려|제작)", priority: 40 }],
    backend: { type: "builtin", handler: "io.github.o-min222.meme_vault.generateMeme" },
  });
  ctx.radialMenu.addItem({
    itemId: "memeVault",
    label: "짤 저장소",
    actionId: "toggleVault",
    icon: "assets/meme.svg",
  });
  const MOD_CONTROL = 2;
  const MOD_SHIFT = 4;
  ctx.shortcuts.registerShortcut({
    actionKey: "toggleVault",
    title: "짤 저장소 열기/닫기",
    defaultModifiers: MOD_CONTROL | MOD_SHIFT,
    defaultVk: 77,
    actionId: "toggleVault",
  });

  return closePalette;
}
