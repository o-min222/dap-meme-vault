/** Meme Vault — persistent, searchable image snippets for DAP. Zero external imports. */

const ITEMS_KEY = "memes-v1";
const RECENT_LIMIT = 20;
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
  const history = ctx.host.clipboardHistory;
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

  async function addLatest(title, tags) {
    const recent = await history.list({ limit: RECENT_LIMIT, kind: "image" });
    const latest = recent[0];
    if (!latest) {
      notice("최근 이미지가 없어요. 이미지를 복사한 뒤 다시 저장해 주세요.", "error");
      return;
    }
    const full = await history.get(latest.id);
    if (!full?.imageBytes) {
      notice("이미지 원본을 읽지 못했어요.", "error");
      return;
    }
    const blobId = await storage.putBlob(full.imageBytes, { mime: "image/png", name: `${latest.id}.png` });
    const items = await readItems();
    const existing = items.find((item) => item.blobId === blobId);
    if (existing) {
      existing.title = cleanText(title) || existing.title;
      existing.tags = parseTags(tags).length ? parseTags(tags) : existing.tags;
      await writeItems(items);
      notice("이미 저장된 짤이라 정보를 갱신했어요.");
    } else {
      items.unshift({
        id: blobId,
        blobId,
        title: cleanText(title) || `새 짤 ${items.length + 1}`,
        tags: parseTags(tags),
        createdAt: Date.now(),
        usedAt: 0,
        useCount: 0,
      });
      await writeItems(items);
      notice("짤을 저장했어요.", "success");
    }
    await pushState();
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
      if (msg.type === "addLatest") void enqueue(() => addLatest(msg.title, msg.tags));
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
