export async function ollamaChat({
  host,
  model,
  messages,
  numCtx = 32768,
  numPredict = 256,
  temperature = 0,
  jsonFormat = false,
  timeoutMs = 900_000,
}) {
  const payload = {
    model,
    messages,
    stream: false,
    keep_alive: "30m",
    options: {
      num_ctx: numCtx,
      num_predict: numPredict,
      temperature,
    },
  };
  if (jsonFormat) payload.format = "json";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${host.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(text || `ollama HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaHealthy(host, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${host.replace(/\/$/, "")}/api/tags`, {
      signal: ctrl.signal,
    });
    return res.ok;
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}
