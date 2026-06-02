import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { decode } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const WEBHOOK_SECRET = Deno.env.get("EMAIL_WEBHOOK_SECRET") ?? "";

const InboundEmailSchema = z.object({
  message_id: z.string().min(1).max(998),
  from: z.string().email().max(320),
  subject: z.string().max(998),
  body_plain: z.string().max(200_000).optional(),
  body_html: z.string().max(500_000).optional(),
  date: z.string().optional(),
  tenant_id: z.string().uuid().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().max(255),
        content_type: z.string().max(255),
        content_base64: z.string(),
        size: z.number().int().nonnegative().optional(),
      }),
    )
    .max(20)
    .optional(),
});

function detectUrgency(subject: string): "baixa" | "media" | "alta" {
  const lower = subject.toLowerCase();
  if (lower.includes("urgente") || lower.includes("alta")) return "alta";
  if (lower.includes("media") || lower.includes("média")) return "media";
  return "baixa";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let payload: z.infer<typeof InboundEmailSchema> | null = null;

  try {
    if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = InboundEmailSchema.safeParse(raw);
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    payload = parsed.data;

    // Idempotência
    const { data: existing } = await supabase
      .from("processed_emails")
      .select("id, ticket_id")
      .eq("message_id", payload.message_id)
      .maybeSingle();
    if (existing) {
      return json({ message: "Email already processed", ticket_id: existing.ticket_id });
    }

    // Resolver criador a partir do remetente
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const senderUser = authUsers?.users?.find(
      (u) => u.email?.toLowerCase() === payload!.from.toLowerCase(),
    );

    let createdBy: string | null = senderUser?.id ?? null;
    let tenantId: string | null = payload.tenant_id ?? null;

    // Se o remetente é membro de algum tenant e nenhum foi informado, usar o primeiro
    if (senderUser && !tenantId) {
      const { data: mem } = await supabase
        .from("tenant_members")
        .select("tenant_id")
        .eq("user_id", senderUser.id)
        .limit(1)
        .maybeSingle();
      tenantId = mem?.tenant_id ?? null;
    }

    // Fallback: usar primeiro admin global como criador, e seu primeiro tenant
    if (!createdBy || !tenantId) {
      const { data: adminRole } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "supervisor"])
        .limit(1)
        .maybeSingle();
      createdBy = createdBy ?? adminRole?.user_id ?? null;

      if (createdBy && !tenantId) {
        const { data: mem } = await supabase
          .from("tenant_members")
          .select("tenant_id")
          .eq("user_id", createdBy)
          .limit(1)
          .maybeSingle();
        tenantId = mem?.tenant_id ?? null;
      }
    }

    if (!createdBy) throw new Error("Nenhum usuário admin disponível para receber o email");
    if (!tenantId) throw new Error("Não foi possível determinar o tenant do email");

    const urgency = detectUrgency(payload.subject);
    const description = payload.body_plain || payload.body_html || "(sem conteúdo)";
    const emailDate = payload.date ? new Date(payload.date).toISOString() : new Date().toISOString();
    const fullDescription = `📧 Remetente: ${payload.from}\n📅 Recebido em: ${new Date(emailDate).toLocaleString("pt-BR")}\n\n${description}`;

    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .insert({
        tenant_id: tenantId,
        title: payload.subject.slice(0, 250),
        description: fullDescription,
        urgency,
        status: "aberto",
        created_by: createdBy,
        created_at: emailDate,
      })
      .select("id, number")
      .single();
    if (ticketError) throw ticketError;

    // Anexos
    if (payload.attachments?.length) {
      for (const att of payload.attachments) {
        try {
          const fileBytes = decode(att.content_base64);
          if (fileBytes.length > 25 * 1024 * 1024) {
            console.warn(`Anexo descartado por exceder 25MB: ${att.filename}`);
            continue;
          }
          const filePath = `${ticket.id}/${Date.now()}-${att.filename}`;
          const { error: uploadError } = await supabase.storage
            .from("ticket-attachments")
            .upload(filePath, fileBytes, { contentType: att.content_type, upsert: false });
          if (uploadError) {
            console.error(`Upload falhou: ${att.filename}`, uploadError);
            continue;
          }
          await supabase.from("ticket_attachments").insert({
            tenant_id: tenantId,
            ticket_id: ticket.id,
            user_id: createdBy,
            file_name: att.filename,
            file_path: filePath,
            file_type: att.content_type,
            file_size: att.size ?? fileBytes.length,
          });
        } catch (e) {
          console.error(`Falha no anexo ${att.filename}`, e);
        }
      }
    }

    // Notificar admins do tenant
    const { data: tenantAdmins } = await supabase
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .in("role", ["owner", "admin"]);
    if (tenantAdmins?.length) {
      await supabase.from("notifications").insert(
        tenantAdmins.map((u) => ({
          tenant_id: tenantId!,
          user_id: u.user_id,
          ticket_id: ticket.id,
          message: `Novo chamado via e-mail #${ticket.number}: ${payload!.subject}`,
        })),
      );
    }

    await supabase.from("processed_emails").insert({
      tenant_id: tenantId,
      message_id: payload.message_id,
      ticket_id: ticket.id,
      sender_email: payload.from,
      subject: payload.subject,
      status: "success",
    });

    await supabase.from("ticket_history").insert({
      tenant_id: tenantId,
      ticket_id: ticket.id,
      user_id: createdBy,
      field: "criação",
      old_value: "",
      new_value: `Chamado criado automaticamente via e-mail de ${payload.from}`,
    });

    return json(
      { success: true, ticket_id: ticket.id, ticket_number: ticket.number },
      201,
    );
  } catch (error) {
    console.error("receive-email error:", error);
    try {
      await supabase.from("processed_emails").insert({
        tenant_id: payload?.tenant_id ?? null,
        message_id: payload?.message_id ?? `error-${Date.now()}`,
        sender_email: payload?.from ?? "unknown",
        subject: payload?.subject ?? "unknown",
        status: "error",
        error_message: error instanceof Error ? error.message : String(error),
      });
    } catch { /* ignore */ }
    return json({ error: error instanceof Error ? error.message : "Internal error" }, 500);
  }
});
