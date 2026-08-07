import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 4299;
const smokeDataDir = mkdtempSync(join(tmpdir(), "digital-human-studio-smoke-"));
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: smokeDataDir,
    ELEVENLABS_API_KEY: "",
    ELEVENLABS_KEY: "",
    XI_API_KEY: "",
    VOICEBOX_URL: "",
    SEEDANCE_PYTHON: "",
    TOOL_VAULT_PATH: "",
    SEEDANCE_RUNNER: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, options) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(`${path}: ${body.message || response.status}`);
  return body.data;
}

try {
  await wait(500);
  const health = await request("/api/health");
  const integrations = await request("/api/integrations");
  const avatars = await request("/api/avatars");
  const voices = await request("/api/voices");
  if (health.providers.seedance2.connected) throw new Error("public smoke test unexpectedly connected to a video provider");
  if (health.providers.elevenlabs.connected) throw new Error("public smoke test unexpectedly connected to a voice provider");
  if (integrations.integrations.length !== 3) throw new Error("integration contract must expose exactly three provider requirements");
  if (integrations.integrations.some((item) => item.configured || item.connected)) throw new Error("clean integration contract unexpectedly reports configured providers");
  const integrationJson = JSON.stringify(integrations);
  if (/\/Users\/|\/home\/|api[_-]?key["']?\s*[:=]\s*["'][^"']+/i.test(integrationJson)) throw new Error("integration contract exposed a path or secret value");
  if (avatars.avatars.length < 1 || voices.voices.length < 1) throw new Error("demo catalog missing");

  const custom = await request("/api/avatars/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Smoke avatar",
      imageData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2vAAAAABJRU5ErkJggg=="
    })
  });
  const customImage = await fetch(`http://127.0.0.1:${port}${custom.avatar.image}`);
  if (!customImage.ok || !customImage.headers.get("content-type")?.startsWith("image/png")) throw new Error("custom avatar image not served");

  const promptPreview = await request("/api/seedance/prompt-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      script: "这是一条透明可编辑的数字人口播提示词。",
      avatarId: custom.avatar.id,
      avatarName: custom.avatar.name,
      voiceId: voices.voices[0].id,
      voiceName: voices.voices[0].name,
      language: "zh",
      settings: { motion: true }
    })
  });
  if (!promptPreview.prompt.includes(custom.avatar.name)) throw new Error("prompt preview missing selected avatar");

  const costGateResponse = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "final_video",
      confirmCost: false,
      title: "Cost gate",
      script: "这条请求必须在提交付费任务之前被费用门禁拦截。",
      avatarId: custom.avatar.id,
      voiceId: voices.voices[0].id
    })
  });
  const costGate = await costGateResponse.json();
  if (costGateResponse.status !== 409 || costGate.errorCode !== "COST_CONFIRMATION_REQUIRED") throw new Error("cost gate failed");

  const dryRun = await request("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "dry_run",
      title: "Smoke test",
      script: "这是一条不会产生费用的流程检查。",
      idempotencyKey: "smoke-test-v2"
    })
  });
  await wait(1500);
  const task = await request(`/api/tasks/${dryRun.taskId}`);
  if (task.status !== "succeeded") throw new Error(`dry run status=${task.status}`);

  console.log(JSON.stringify({
    ok: true,
    service: health.service,
    providersConnected: false,
    demoAvatars: avatars.avatars.length,
    demoVoices: voices.voices.length,
    integrationRequirements: integrations.integrations.length,
    customAvatarUpload: customImage.status,
    promptPreview: promptPreview.prompt.length,
    costGate: costGate.errorCode,
    dryRun: task.status
  }, null, 2));
} finally {
  child.kill("SIGTERM");
  rmSync(smokeDataDir, { recursive: true, force: true });
}
