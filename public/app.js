const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  avatars: [],
  voices: [],
  selectedAvatar: null,
  selectedVoice: null,
  ratio: "portrait",
  settings: { captions: true, eyeContact: true, music: false, motion: true },
  tasks: new Map(),
  health: null,
  integrations: [],
  sampleAudio: new Audio(),
  pendingAvatarFile: null,
  pendingAvatarData: "",
  promptCustomized: false
};

const script = $("#script");
const title = $("#title");
const statusText = { queued: "排队中", running: "生成中", succeeded: "已完成", failed: "失败", cancelled: "已取消" };

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.message || `请求失败 (${response.status})`);
    error.code = payload.errorCode;
    error.retryable = payload.retryable;
    throw error;
  }
  return payload;
}

function toast(titleText, detail = "", type = "") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  const strong = document.createElement("b");
  const span = document.createElement("span");
  strong.textContent = titleText;
  span.textContent = detail;
  node.append(strong, span);
  $("#toastWrap").append(node);
  setTimeout(() => node.remove(), 3600);
}

function calculateMeta() {
  const chars = script.value.replace(/\s/g, "").length;
  const seconds = Math.max(1, Math.round(chars / 4.2));
  $("#charCount").textContent = `${chars} 字`;
  $("#duration").textContent = `约 ${seconds} 秒`;
  $("#costDuration").textContent = `${seconds} 秒`;
  $("#previewDuration").textContent = `00:${String(seconds).padStart(2, "0")}`;
  $("#modalChars").textContent = chars;
  const sentence = script.value.split(/[。！？!?\n]/).map((item) => item.trim()).filter(Boolean).at(-2) || script.value.slice(0, 24);
  $("#captionPreview").textContent = sentence.slice(0, 24);
}

let promptSyncTimer;
function schedulePromptSync(force = false) {
  clearTimeout(promptSyncTimer);
  promptSyncTimer = setTimeout(() => syncGenerationPrompt(force), 180);
}

async function syncGenerationPrompt(force = false) {
  if (state.promptCustomized && !force) return;
  try {
    const { data } = await api("/api/seedance/prompt-preview", {
      method: "POST",
      body: JSON.stringify({
        script: script.value.trim(),
        avatarId: state.selectedAvatar?.id,
        avatarName: state.selectedAvatar?.name,
        voiceId: state.selectedVoice?.id,
        voiceName: state.selectedVoice?.name,
        language: $("#language").value,
        settings: state.settings
      })
    });
    if (state.promptCustomized && !force) return;
    $("#generationPrompt").value = data.prompt;
    state.promptCustomized = false;
    $("#promptMode").textContent = "自动同步";
  } catch (error) {
    if (!state.promptCustomized) $("#generationPrompt").placeholder = `提示词生成失败：${error.message}`;
  }
}

function setProvider(node, mode, label) {
  node.classList.remove("connected", "warning", "error");
  node.classList.add(mode);
  node.querySelector("small").textContent = label;
}

async function loadHealth() {
  try {
    const { data } = await api("/api/health");
    state.health = data;
    const seedance = data.providers.seedance2;
    const eleven = data.providers.elevenlabs;
    const voicebox = data.providers.voicebox;
    setProvider($("#seedanceStatus"), seedance.connected ? "connected" : "error", seedance.connected ? "API 已连接" : seedance.state === "unauthorized" ? "需重新授权" : "不可用");
    setProvider($("#elevenStatus"), eleven.connected ? "connected" : "error", eleven.connected ? "API 已连接" : "需配置");
    setProvider($("#voiceboxStatus"), voicebox?.connected ? "connected" : "warning", voicebox?.connected ? (voicebox.autoDetected ? "自动检测已连接" : "本机已连接") : voicebox?.modelDownloaded ? "模型已检测" : voicebox?.appInstalled ? "应用已安装" : "未安装");
    $("#cliHint").textContent = seedance.connected
      ? `Seedance 2.0 API 已就绪${seedance.walletBalance ? ` · 剩余 ${seedance.walletBalance} 点` : ""}`
      : "配置你自己的生成通道后即可使用";
  } catch (error) {
    setProvider($("#seedanceStatus"), "error", "检查失败");
    setProvider($("#elevenStatus"), "error", "检查失败");
    toast("连接检查失败", error.message, "error");
  }
}

function integrationStatus(item) {
  if (!item) return { label: "尚未检查", mode: "" };
  if (item.connected) return { label: "已连接", mode: "connected" };
  if (item.configured) return { label: "已配置，连接失败", mode: "error" };
  return { label: "等待配置", mode: "missing" };
}

function renderIntegrationStatus(id, nodeId) {
  const item = state.integrations.find((entry) => entry.id === id);
  const status = integrationStatus(item);
  const node = $(nodeId);
  node.className = `integration-status ${status.mode}`;
  node.textContent = status.label;
}

async function loadIntegrations() {
  try {
    const { data } = await api("/api/integrations");
    state.integrations = data.integrations || [];
    renderIntegrationStatus("video-generation", "#integrationVideoStatus");
    renderIntegrationStatus("cloud-voice", "#integrationVoiceStatus");
    const volcengine = state.integrations.find((entry) => entry.id === "volcengine-seed-tts-2");
    const volcStatus = $("#integrationVolcStatus");
    volcStatus.className = `integration-status ${volcengine?.configured ? "connected" : "missing"}`;
    volcStatus.textContent = volcengine?.configured ? "火山已配置" : "火山可选购";
    const local = state.integrations.find((entry) => entry.id === "local-cloned-voice");
    const localStatus = $("#integrationLocalStatus");
    const localHint = $("#localModelHint");
    const download = $("#localModelDownload");
    if (local?.connected) {
      localStatus.className = "integration-status connected";
      localStatus.textContent = local.detection?.autoDetected ? "已自动检测并连接" : "已连接";
      localHint.textContent = local.detection?.modelLoaded ? "本地模型已加载，可以直接生成克隆配音。" : "Voicebox 已运行，首次生成时会加载本地模型。";
      download.classList.add("hidden");
    } else if (local?.detection?.modelDownloaded) {
      localStatus.className = "integration-status connected";
      localStatus.textContent = "本地模型已检测";
      localHint.textContent = "已找到 Qwen3‑TTS 模型，请启动 Voicebox 后再刷新。";
      download.classList.add("hidden");
    } else {
      localStatus.className = "integration-status missing";
      localStatus.textContent = local?.detection?.appInstalled ? "应用已安装，模型未下载" : "未检测到本地模型";
      localHint.textContent = "推荐 Voicebox + Qwen3‑TTS 1.7B；安装后首次生成会自动下载模型。";
      download.href = local?.downloadUrl || "https://voicebox.sh/download";
      download.classList.remove("hidden");
    }
  } catch (error) {
    ["#integrationVideoStatus", "#integrationVoiceStatus", "#integrationVolcStatus", "#integrationLocalStatus"].forEach((selector) => {
      $(selector).className = "integration-status error";
      $(selector).textContent = "检查失败";
    });
  }
}

async function loadAvatars() {
  try {
    const { data } = await api("/api/avatars");
    state.avatars = data.avatars || [];
    state.selectedAvatar = state.avatars[0] || null;
    renderAvatars();
  } catch (error) {
    $("#avatarList").innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

function renderAvatars() {
  const list = $("#avatarList");
  list.replaceChildren();
  for (const avatar of state.avatars) {
    const button = document.createElement("button");
    button.className = `avatar-card ${avatar.source === "local" ? "local" : ""} ${avatar.id === state.selectedAvatar?.id ? "selected" : ""}`;
    button.title = `${avatar.name} · 人物参考图`;
    const image = document.createElement("img");
    image.src = avatar.image;
    image.alt = avatar.name;
    const label = document.createElement("span");
    label.textContent = avatar.name;
    button.append(image, label);
    button.addEventListener("click", () => {
      state.selectedAvatar = avatar;
      renderAvatars();
      updateAvatarPreview();
      schedulePromptSync();
      toast("数字人已切换", avatar.name, "success");
    });
    list.append(button);
  }
  const add = document.createElement("button");
  add.className = "avatar-add-card";
  add.type = "button";
  add.title = "添加个人图片";
  add.innerHTML = "<b>＋</b><small>个人图片</small>";
  add.addEventListener("click", openAvatarModal);
  list.append(add);
  updateAvatarPreview();
}

function updateAvatarPreview() {
  if (!state.selectedAvatar) return;
  const image = $("#avatarImage");
  image.style.opacity = "0";
  image.onload = () => { image.style.opacity = "1"; };
  image.src = state.selectedAvatar.image;
  image.alt = `${state.selectedAvatar.name} 数字人预览`;
}

async function loadVoices(showToast = false) {
  $("#voiceList").innerHTML = '<div class="voice-skeleton"></div><div class="voice-skeleton"></div><div class="voice-skeleton"></div>';
  try {
    const { data } = await api("/api/voices");
    state.voices = data.voices || [];
    const preferred = state.voices.find((voice) => voice.labels?.language === "zh" || voice.labels?.locale?.startsWith("zh"));
    state.selectedVoice = state.voices.find((voice) => voice.id === state.selectedVoice?.id) || preferred || state.voices[0] || null;
    $("#voiceCount").textContent = String(data.total || state.voices.length);
    renderVoices();
    if (showToast) toast("音色已刷新", `已载入 ${state.voices.length} 个可用音色`, "success");
  } catch (error) {
    $("#voiceList").innerHTML = `<div class="empty-state">ElevenLabs 音色加载失败：${error.message}</div>`;
    toast("音色加载失败", error.message, "error");
  }
}

function renderVoices() {
  const list = $("#voiceList");
  list.replaceChildren();
  const visible = state.voices.slice(0, 5);
  if (!visible.length) {
    list.innerHTML = '<div class="empty-state">当前账号没有可用音色</div>';
    return;
  }
  for (const voice of visible) {
    const card = document.createElement("button");
    card.className = `voice-card ${voice.id === state.selectedVoice?.id ? "selected" : ""}`;
    const top = document.createElement("div");
    top.className = "voice-top";
    const orb = document.createElement("span");
    orb.className = "voice-orb";
    orb.textContent = voice.name.slice(0, 2).toUpperCase();
    const name = document.createElement("span");
    name.className = "voice-name";
    const bold = document.createElement("b");
    bold.textContent = voice.name;
    const small = document.createElement("small");
    const gender = voice.labels?.gender || "AI voice";
    const accent = voice.labels?.accent || voice.category || "voice";
    small.textContent = voice.local ? `我的音色 · ${accent}` : voice.custom ? `已添加 · ${accent}` : `${gender} · ${accent}`;
    name.append(bold, small);
    top.append(orb, name);
    const desc = document.createElement("p");
    desc.className = "voice-desc";
    desc.textContent = voice.description || voice.labels?.use_case || "自然、清晰的口播音色";
    card.append(top, desc);
    if (voice.local || voice.custom || voice.owned) {
      const badge = document.createElement("span");
      badge.className = `voice-badge ${voice.local ? "sample" : ""}`;
      badge.textContent = voice.provider === "voicebox" ? "本机克隆" : voice.local ? "本地样音" : "我的";
      card.append(badge);
    }
    if (voice.previewUrl) {
      const play = document.createElement("button");
      play.className = "voice-play";
      play.textContent = "▶";
      play.title = "播放官方音色样本（不扣费）";
      play.addEventListener("click", (event) => {
        event.stopPropagation();
        state.sampleAudio.pause();
        state.sampleAudio = new Audio(voice.previewUrl);
        state.sampleAudio.play().catch(() => toast("样本播放失败", "远程音频暂不可用", "error"));
      });
      card.append(play);
    }
    card.addEventListener("click", () => {
      state.selectedVoice = voice;
      renderVoices();
      schedulePromptSync();
    });
    list.append(card);
  }
  const add = document.createElement("button");
  add.className = "voice-add-card";
  add.type = "button";
  add.innerHTML = "<b>＋</b><span>添加音色</span><small>粘贴 Voice ID</small>";
  add.addEventListener("click", openVoiceModal);
  list.append(add);
  syncVoiceAction();
  schedulePromptSync();
}

function playVoiceSample(voice) {
  if (!voice?.previewUrl) return toast("没有可播放样音", "这个音色暂未提供预览", "error");
  state.sampleAudio.pause();
  state.sampleAudio = new Audio(voice.previewUrl);
  state.sampleAudio.play().catch(() => toast("样本播放失败", "音频暂不可用", "error"));
}

function syncVoiceAction() {
  const voice = state.selectedVoice;
  const button = $("#generateVoice");
  if (!button || !voice) return;
  button.textContent = voice.provider === "voicebox" ? "生成我的克隆配音" : voice.ttsReady === false ? "播放我的本地样音" : "生成配音试听";
  $(".voice-note").textContent = voice.provider === "voicebox"
    ? "配音试听使用本机 Voicebox；生成视频时 Seedance 2.0 会把这段本人授权音色作为声音参考。"
    : voice.ttsReady === false
    ? "这套历史中文音色的本地样音可直接播放；原候选未保存进 ElevenLabs 云端，不能生成新台词。"
    : "ElevenLabs 用于配音试听；Seedance 2.0 成片会把当前音色样本作为声音参考。";
}

function setRatio(ratio) {
  state.ratio = ratio;
  const frame = $("#videoFrame");
  frame.classList.remove("portrait", "landscape", "square");
  frame.classList.add(ratio);
  $$('[data-ratio]').forEach((button) => button.classList.toggle("active", button.dataset.ratio === ratio));
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function taskPayload(type, confirmCost = false) {
  return {
    type,
    confirmCost,
    title: title.value.trim(),
    script: script.value.trim(),
    avatarId: state.selectedAvatar?.id,
    avatarType: state.selectedAvatar?.avatarType || "",
    avatarSource: state.selectedAvatar?.source || "preset",
    voiceId: state.selectedVoice?.id,
    voiceName: state.selectedVoice?.name || "",
    voicePreviewUrl: state.selectedVoice?.previewUrl || "",
    generationPrompt: $("#generationPrompt").value.trim(),
    modelId: "eleven_multilingual_v2",
    ratio: state.ratio,
    resolution: $("#resolution").value,
    language: $("#language").value,
    stability: Number($("#stability").value) / 100,
    similarity: Number($("#similarity").value) / 100,
    speed: Number($("#speed").value) / 100,
    settings: state.settings
  };
}

async function submitTask(type, confirmCost = false) {
  if (script.value.trim().length < 3) return toast("脚本太短", "至少输入 3 个字符", "error");
  if (type === "voice_preview" && !state.selectedVoice) return toast("还没选音色", "请先选择 ElevenLabs 音色", "error");
  const payload = taskPayload(type, confirmCost);
  payload.idempotencyKey = await digest(JSON.stringify(payload));
  try {
    const { data, warnings } = await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
    if (data.reused) toast("已复用相同任务", "没有重复扣费", "success");
    else toast(type === "dry_run" ? "流程检查已开始" : "任务已提交", warnings?.[0] || "可在任务记录查看进度", "success");
    addTask({ id: data.taskId, type, title: payload.title, status: "queued", progress: 0 });
    pollTask(data.taskId);
    return data.taskId;
  } catch (error) {
    toast("提交失败", error.message, "error");
    throw error;
  }
}

function addTask(task) {
  state.tasks.set(task.id, task);
  renderTasks();
}

function renderTasks() {
  $("#taskBadge").textContent = String(state.tasks.size);
  const list = $("#taskList");
  list.replaceChildren();
  if (!state.tasks.size) {
    list.innerHTML = '<div class="empty-state">还没有任务</div>';
    return;
  }
  for (const task of [...state.tasks.values()].reverse()) {
    const item = document.createElement("article");
    item.className = `task-item ${task.status}`;
    const detail = task.error?.message || task.result?.message || (task.type === "voice_preview" ? "配音试听" : task.type === "dry_run" ? "无费用全流程检查" : "Seedance 2.0 数字人口播");
    item.innerHTML = `<header><h3></h3><span class="status"></span></header><div class="progress"><i></i></div><p></p>`;
    item.querySelector("h3").textContent = task.title || "未命名任务";
    item.querySelector(".status").textContent = statusText[task.status] || task.status;
    item.querySelector(".progress i").style.width = `${task.progress || 0}%`;
    item.querySelector("p").textContent = detail;
    if (task.result?.videoUrl) {
      const link = document.createElement("a");
      link.className = "task-result-link";
      link.href = task.result.videoUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "打开成片 ↗";
      item.append(link);
    }
    list.append(item);
  }
}

async function pollTask(id) {
  for (let attempt = 0; attempt < 750; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt ? 1200 : 450));
    try {
      const { data } = await api(`/api/tasks/${id}`);
      state.tasks.set(id, data);
      renderTasks();
      if (["succeeded", "failed", "cancelled"].includes(data.status)) {
        if (data.status === "succeeded") {
          toast("任务完成", data.result?.message || "结果已就绪", "success");
          if (data.result?.audioUrl) {
            const box = $("#audioResult");
            box.classList.remove("hidden");
            box.querySelector("audio").src = data.result.audioUrl;
            box.querySelector("a").href = data.result.audioUrl;
            box.querySelector("a").download = `${data.title || "配音试听"}.mp3`;
          }
        } else toast("任务失败", data.error?.message || "请稍后重试", "error");
        return;
      }
    } catch (error) {
      if (attempt > 4) return toast("任务状态中断", error.message, "error");
    }
  }
  toast("任务超时", "任务仍可能在后台执行，可稍后查看", "error");
}

function openDrawer() { $("#taskDrawer").classList.add("open"); $("#taskDrawer").setAttribute("aria-hidden", "false"); }
function closeDrawer() { $("#taskDrawer").classList.remove("open"); $("#taskDrawer").setAttribute("aria-hidden", "true"); }
function openModal() { $("#costModal").classList.add("open"); $("#costModal").setAttribute("aria-hidden", "false"); }
function closeModal() { $("#costModal").classList.remove("open"); $("#costModal").setAttribute("aria-hidden", "true"); }
function openVideoModal() {
  $("#modalAvatar").textContent = state.selectedAvatar?.name || "未选择";
  $("#modalVideoChars").textContent = `${script.value.replace(/\s/g, "").length} 字`;
  $("#modalVideoVoice").textContent = state.selectedVoice?.name || "未选择";
  const note = $("#videoModal p");
  const confirm = $("#confirmVideo");
  const ready = Boolean(state.selectedAvatar && state.selectedVoice && state.health?.providers?.seedance2?.connected);
  const estimatedSeconds = Math.max(1, Math.round(script.value.replace(/\s/g, "").length / 4.2));
  note.textContent = ready
    ? `这会通过 Seedance 2.0 API 提交 1 条 15 秒真实视频并消耗账户点数。${estimatedSeconds > 15 ? "当前台词偏长，可能需要压缩或后续拆段。" : ""}失败后不会自动付费重试。`
    : "请先选择人物与音色，并确认 Seedance 2.0 API 已连接。";
  confirm.disabled = !ready;
  confirm.textContent = ready ? "确认生成 1 条" : "生成条件未就绪";
  $("#videoModal").classList.add("open");
  $("#videoModal").setAttribute("aria-hidden", "false");
}
function closeVideoModal() { $("#videoModal").classList.remove("open"); $("#videoModal").setAttribute("aria-hidden", "true"); }

function resetAvatarForm() {
  state.pendingAvatarFile = null;
  state.pendingAvatarData = "";
  $("#customAvatarName").value = "我的数字人";
  $("#customAvatarUrl").value = "";
  $("#avatarFile").value = "";
  $("#avatarUploadPreview").src = "";
  $("#avatarUploadPreview").classList.add("hidden");
  $("#avatarDropzone").classList.remove("has-image", "dragging");
}

function openAvatarModal() {
  resetAvatarForm();
  $("#avatarModal").classList.add("open");
  $("#avatarModal").setAttribute("aria-hidden", "false");
}

function closeAvatarModal() {
  $("#avatarModal").classList.remove("open");
  $("#avatarModal").setAttribute("aria-hidden", "true");
}

function openVoiceModal() {
  $("#customVoiceName").value = "";
  $("#customVoiceId").value = "";
  $("#voiceModal").classList.add("open");
  $("#voiceModal").setAttribute("aria-hidden", "false");
  setTimeout(() => $("#customVoiceId").focus(), 80);
}

function closeVoiceModal() {
  $("#voiceModal").classList.remove("open");
  $("#voiceModal").setAttribute("aria-hidden", "true");
}

function openIntegrationModal() {
  $("#integrationModal").classList.add("open");
  $("#integrationModal").setAttribute("aria-hidden", "false");
  loadIntegrations();
}

function closeIntegrationModal() {
  $("#integrationModal").classList.remove("open");
  $("#integrationModal").setAttribute("aria-hidden", "true");
}

async function copyIntegrationChecklist() {
  const checklist = `使用“造人局·数字人口播工作台”需要准备：
1. 视频生成：Seedance 2.0 生成权限与本机适配器（必需）
2. 云端配音任选：ElevenLabs、火山语音大模型、Doubao-Seed-TTS 2.0 / 声音复刻 2.0
   火山官方开通：https://www.volcengine.com/products/Audio-editing-and-sound-processing
   声音复刻购买指南：https://www.volcengine.com/docs/6561/1167802?lang=zh
3. 本地克隆音色：Voicebox + Qwen3-TTS 1.7B（免费、可选）
   官方下载：https://voicebox.sh/download

请只在自己的电脑上配置，不要把 API Key、Token 或私人节点地址发给别人，也不要提交到 GitHub。`;
  try {
    await navigator.clipboard.writeText(checklist);
    toast("接入清单已复制", "可以直接发给安装或技术人员", "success");
  } catch {
    const field = document.createElement("textarea");
    field.value = checklist;
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
    toast("接入清单已复制", "可以直接发给安装或技术人员", "success");
  }
}

async function saveCustomVoice() {
  const voiceId = $("#customVoiceId").value.trim();
  if (!voiceId) return toast("还没有 Voice ID", "请粘贴 ElevenLabs Voice ID", "error");
  const button = $("#saveCustomVoice");
  button.disabled = true;
  button.textContent = "正在校验…";
  try {
    const { data } = await api("/api/voices/custom", {
      method: "POST",
      body: JSON.stringify({ voiceId, name: $("#customVoiceName").value.trim() })
    });
    closeVoiceModal();
    await loadVoices();
    state.selectedVoice = state.voices.find((voice) => voice.id === data.voice.id) || state.selectedVoice;
    renderVoices();
    toast("音色已加入", data.voice.name, "success");
  } catch (error) {
    toast("音色添加失败", error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "校验并加入";
  }
}

async function setAvatarFile(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast("图片格式不支持", "请选择 JPG、PNG 或 WebP", "error");
  if (file.size > 8 * 1024 * 1024) return toast("图片太大", "个人图片不能超过 8MB", "error");
  const objectUrl = URL.createObjectURL(file);
  const dimensions = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = objectUrl;
  }).catch(() => null);
  URL.revokeObjectURL(objectUrl);
  if (!dimensions) return toast("图片无法读取", "请换一张清晰图片", "error");
  if (Math.min(dimensions.width, dimensions.height) < 256) return toast("图片分辨率太低", "短边至少需要 256px", "error");
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  }).catch(() => "");
  if (!data) return toast("图片读取失败", "请重新选择", "error");
  state.pendingAvatarFile = file;
  state.pendingAvatarData = data;
  const preview = $("#avatarUploadPreview");
  preview.src = data;
  preview.classList.remove("hidden");
  $("#avatarDropzone").classList.add("has-image");
  if ($("#customAvatarName").value === "我的数字人") $("#customAvatarName").value = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "我的数字人";
}

async function saveCustomAvatar() {
  const remoteUrl = $("#customAvatarUrl").value.trim();
  if (!state.pendingAvatarData && !remoteUrl) return toast("还没有图片", "拖入图片或填写 HTTPS 图片地址", "error");
  if (remoteUrl && !/^https:\/\//i.test(remoteUrl)) return toast("图片地址无效", "请输入以 https:// 开头的地址", "error");
  const button = $("#saveCustomAvatar");
  button.disabled = true;
  button.textContent = "正在加入…";
  try {
    const { data, warnings } = await api("/api/avatars/custom", {
      method: "POST",
      body: JSON.stringify({
        name: $("#customAvatarName").value.trim(),
        imageData: state.pendingAvatarData || undefined,
        remoteUrl: remoteUrl || undefined
      })
    });
    state.avatars = [data.avatar, ...state.avatars.filter((avatar) => avatar.id !== data.avatar.id)];
    state.selectedAvatar = data.avatar;
    renderAvatars();
    closeAvatarModal();
    toast("个人图片已加入", warnings?.[0] || "已可作为 Seedance 人物参考图", "success");
  } catch (error) {
    toast("添加失败", error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "加入数字人列表";
  }
}

function saveLocal() {
  localStorage.setItem("digital-human-draft", JSON.stringify({ title: title.value, script: script.value, ratio: state.ratio }));
  $("#saveState").textContent = "已保存";
  $("#sideTitle").textContent = title.value || "未命名口播";
  setTimeout(() => { $("#saveState").textContent = "自动保存"; }, 900);
}

function loadLocal() {
  try {
    const draft = JSON.parse(localStorage.getItem("digital-human-draft"));
    if (draft?.title) title.value = draft.title;
    if (draft?.script) script.value = draft.script;
    if (draft?.ratio) setRatio(draft.ratio);
  } catch {}
  $("#sideTitle").textContent = title.value;
}

let saveTimer;
[title, script].forEach((field) => field.addEventListener("input", () => {
  calculateMeta();
  schedulePromptSync();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 500);
}));

$$('[data-ratio]').forEach((button) => button.addEventListener("click", () => setRatio(button.dataset.ratio)));
$$('.toggle').forEach((button) => button.addEventListener("click", () => {
  button.classList.toggle("on");
  const key = button.dataset.setting;
  if (key) state.settings[key] = button.classList.contains("on");
}));
$$('.step').forEach((button) => button.addEventListener("click", () => {
  $$('.step').forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  $(`#${button.dataset.anchor}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}));
$$('[data-close]').forEach((button) => button.addEventListener("click", closeDrawer));
$$('[data-modal-close]').forEach((button) => button.addEventListener("click", closeModal));
$$('[data-video-modal-close]').forEach((button) => button.addEventListener("click", closeVideoModal));
$$('[data-avatar-modal-close]').forEach((button) => button.addEventListener("click", closeAvatarModal));
$$('[data-voice-modal-close]').forEach((button) => button.addEventListener("click", closeVoiceModal));
$$('[data-integration-modal-close]').forEach((button) => button.addEventListener("click", closeIntegrationModal));

$("#openTasks").addEventListener("click", openDrawer);
$("#openIntegrations").addEventListener("click", openIntegrationModal);
[$("#seedanceStatus"), $("#elevenStatus"), $("#voiceboxStatus")].forEach((button) => button.addEventListener("click", openIntegrationModal));
$("#copyIntegrationChecklist").addEventListener("click", copyIntegrationChecklist);
$("#addAvatarText").addEventListener("click", openAvatarModal);
$("#addVoiceText").addEventListener("click", openVoiceModal);
$("#avatarDropzone").addEventListener("click", () => $("#avatarFile").click());
$("#avatarFile").addEventListener("change", (event) => setAvatarFile(event.target.files?.[0]));
['dragenter', 'dragover'].forEach((name) => $("#avatarDropzone").addEventListener(name, (event) => {
  event.preventDefault();
  $("#avatarDropzone").classList.add("dragging");
}));
['dragleave', 'drop'].forEach((name) => $("#avatarDropzone").addEventListener(name, (event) => {
  event.preventDefault();
  $("#avatarDropzone").classList.remove("dragging");
}));
$("#avatarDropzone").addEventListener("drop", (event) => setAvatarFile(event.dataTransfer?.files?.[0]));
$("#customAvatarUrl").addEventListener("change", (event) => {
  const value = event.target.value.trim();
  if (state.pendingAvatarData || !/^https:\/\//i.test(value)) return;
  $("#avatarUploadPreview").src = value;
  $("#avatarUploadPreview").classList.remove("hidden");
  $("#avatarDropzone").classList.add("has-image");
});
$("#saveCustomAvatar").addEventListener("click", saveCustomAvatar);
$("#saveCustomVoice").addEventListener("click", saveCustomVoice);
$("#generationPrompt").addEventListener("input", () => {
  state.promptCustomized = true;
  $("#promptMode").textContent = "已手动修改";
});
$("#resetGenerationPrompt").addEventListener("click", () => {
  state.promptCustomized = false;
  $("#promptMode").textContent = "正在恢复…";
  schedulePromptSync(true);
});
$("#refreshVoices").addEventListener("click", () => loadVoices(true));
$("#generateVoice").addEventListener("click", () => {
  if (state.selectedVoice?.provider === "voicebox") {
    const button = $("#generateVoice");
    button.disabled = true;
    button.textContent = "本机生成中…";
    submitTask("voice_preview", false).catch(() => {}).finally(() => { button.disabled = false; syncVoiceAction(); });
    return;
  }
  if (state.selectedVoice?.ttsReady === false) return playVoiceSample(state.selectedVoice);
  openModal();
});
$("#confirmVoice").addEventListener("click", async () => {
  closeModal();
  $("#generateVoice").disabled = true;
  $("#generateVoice").textContent = "生成中…";
  try { await submitTask("voice_preview", true); }
  catch {}
  finally { $("#generateVoice").disabled = false; $("#generateVoice").textContent = "生成配音试听"; }
});
[$("#dryRun"), $("#dryRunTop")].forEach((button) => button.addEventListener("click", () => submitTask("dry_run").catch(() => {})));
[$("#createVideo"), $("#createVideoTop")].forEach((button) => button.addEventListener("click", openVideoModal));
$("#confirmVideo").addEventListener("click", async () => {
  closeVideoModal();
  openDrawer();
  await submitTask("final_video", true).catch(() => {});
});
$("#templateBtn").addEventListener("click", () => {
  script.value = "如果你正在做口播，这个方法能帮你省下一半时间。\n\n先把结论放在第一句，再用一个真实场景解释原因，最后只留一个明确行动。观众不需要听完所有信息，只需要在每一句里都知道：这和我有什么关系。\n\n收藏这套结构，下次写脚本直接套用。";
  calculateMeta(); saveLocal(); toast("已套用高留存模板", "结论 → 场景 → 行动", "success");
});
$("#polishBtn").addEventListener("click", () => {
  let value = script.value.replace(/因此|所以说/g, "所以").replace(/我们可以看到/g, "你会发现").replace(/非常非常/g, "特别").replace(/。\s*/g, "。\n");
  if (!/^(你|大多数|如果|别|先)/.test(value.trim())) value = `先说结论。\n${value.trim()}`;
  script.value = value;
  calculateMeta(); saveLocal(); toast("脚本已顺口化", "已缩短书面表达并增加自然停顿", "success");
});

$("#previewPlay").addEventListener("click", () => toast("预览说明", "当前展示形象与字幕安全区，生成后可播放完整成片"));
$("#motionToggle").addEventListener("click", () => { state.settings.motion = $("#motionToggle").classList.contains("on"); schedulePromptSync(); });
$("#language").addEventListener("change", () => schedulePromptSync());
$("#stability").addEventListener("input", (event) => { $("#stabilityValue").textContent = event.target.value; });
$("#similarity").addEventListener("input", (event) => { $("#similarityValue").textContent = event.target.value; });
$("#speed").addEventListener("input", (event) => { $("#speedValue").textContent = `${(event.target.value / 100).toFixed(2)}×`; });
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") openVideoModal();
  if (event.key === "Escape") { closeDrawer(); closeModal(); closeVideoModal(); closeAvatarModal(); closeVoiceModal(); closeIntegrationModal(); }
});

loadLocal();
calculateMeta();
setRatio(state.ratio);
Promise.allSettled([loadHealth(), loadIntegrations(), loadAvatars(), loadVoices()]);
if (new URLSearchParams(location.search).get("setup") === "1") openIntegrationModal();
