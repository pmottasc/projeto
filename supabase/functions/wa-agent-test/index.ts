// Sandbox tester for agent persona/tools. Does NOT execute tools — just simulates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

function resolveProvider(p?: string, baseUrl?: string, apiKey?: string) {
  const prov = (p || "lovable").toLowerCase();
  if (prov === "openai") return { url: "https://api.openai.com/v1/chat/completions", key: apiKey || "" };
  if (prov === "gemini" || prov === "google") return { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: apiKey || "" };
  if (prov === "custom") {
    const url = (baseUrl || "").replace(/\/$/, "");
    const full = url.endsWith("/chat/completions") ? url : `${url}/chat/completions`;
    return { url: full, key: apiKey || "" };
  }
  return { url: LOVABLE_GATEWAY, key: Deno.env.get("LOVABLE_API_KEY") || "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u, error } = await sb.auth.getUser();
    if (error || !u?.user) return json({ error: "Unauthorized" }, 401);

    const { persona, model, tools, history, api_provider, api_key, api_base_url } = await req.json();
    const { url: AI_URL, key: AI_KEY } = resolveProvider(api_provider, api_base_url, api_key);
    if (!AI_KEY) return json({ error: `Chave de API ausente para o provedor "${api_provider || 'lovable'}". Configure a chave do cliente ou use o provedor Lovable.` }, 400);

    const sysPrompt = `${persona || "Você é um assistente."}\n\n[MODO SANDBOX] Ferramentas habilitadas (apenas descritivo, não execute): ${(tools || []).join(", ")}.\nResponda como faria de verdade. Se fosse usar uma ferramenta, descreva entre colchetes: [usaria handoff: motivo].`;

    const resp = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${AI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: sysPrompt },
          ...(history || []).map((m: any) => ({ role: m.role, content: m.content })),
        ],
        max_completion_tokens: 600,
      }),
    });

    if (resp.status === 429) return json({ reply: "⚠️ Limite de requisições. Tente novamente em alguns segundos." });
    if (resp.status === 402) return json({ reply: "⚠️ Sem créditos de IA. Adicione créditos em Configurações > Workspace > Uso." });
    if (!resp.ok) {
      const t = await resp.text();
      return json({ reply: `⚠️ Erro ${resp.status}: ${t.slice(0, 200)}` });
    }
    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || "(sem resposta)";
    return json({ reply });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
