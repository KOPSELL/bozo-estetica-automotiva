import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const canceledStatuses = ["cancelado", "cancelada", "canceled", "cancelled", "rejeitado", "rejected"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing Supabase function environment variables");
      return json({ error: "A agenda ainda não está configurada no servidor." }, 500);
    }

    const body = await req.json();
    const nome = String(body.nome ?? "").trim().slice(0, 120);
    const whatsapp = String(body.whatsapp ?? "").replace(/\D/g, "").slice(0, 20);
    const servicoNome = String(body.servico ?? "").trim().slice(0, 120);
    const veiculo = String(body.veiculo ?? "").trim().slice(0, 160);
    const observacoes = String(body.observacoes ?? "").trim().slice(0, 1000);
    const data = String(body.data ?? "");
    const horario = String(body.horario ?? "");

    if (nome.length < 2 || whatsapp.length < 10 || !servicoNome) {
      return json({ error: "Informe seu nome, telefone com DDD e serviço." }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^(0[8-9]|1[0-7]):00$/.test(horario)) {
      return json({ error: "Escolha uma data e um horário válido." }, 400);
    }

    const chosenDate = new Date(data + "T12:00:00-03:00");
    if (Number.isNaN(chosenDate.getTime()) || chosenDate.toISOString().slice(0, 10) !== data) {
      return json({ error: "A data escolhida não é válida." }, 400);
    }
    const dayOfWeek = chosenDate.getUTCDay();
    const hour = Number(horario.slice(0, 2));
    if (dayOfWeek === 0 || (dayOfWeek === 6 && hour > 11) || (dayOfWeek >= 1 && dayOfWeek <= 5 && hour > 17)) {
      return json({ error: "Esse horário fica fora do funcionamento da Bozo." }, 400);
    }

    const dateTime = new Date(data + "T" + horario + ":00-03:00");
    if (dateTime.getTime() <= Date.now()) {
      return json({ error: "Escolha um horário futuro." }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: service, error: serviceError } = await supabase
      .from("bozo_servicos")
      .select("id,nome,preco,duracao_minutos,ativo")
      .ilike("nome", servicoNome)
      .eq("ativo", true)
      .maybeSingle();

    if (serviceError) {
      console.error("Service lookup failed:", serviceError.message);
      return json({ error: "Não foi possível verificar o serviço. Tente novamente." }, 500);
    }
    if (!service) return json({ error: "Esse serviço ainda não está cadastrado. Avise a Bozo para atualizar a lista." }, 400);
    if (Number(service.duracao_minutos) !== 60) {
      return json({ error: "Este serviço não está configurado para o intervalo de 1 hora. Entre em contato com a Bozo." }, 400);
    }

    const startIso = dateTime.toISOString();
    const { data: existing, error: availabilityError } = await supabase
      .from("bozo_agendamentos")
      .select("id")
      .eq("data_hora", startIso)
      .not("status", "in", `(${canceledStatuses.join(",")})`)
      .limit(1);

    if (availabilityError) {
      console.error("Availability check failed:", availabilityError.message);
      return json({ error: "Não foi possível conferir a agenda. Tente novamente." }, 500);
    }
    if (existing && existing.length > 0) return json({ error: "Esse horário acabou de ser reservado. Escolha outro horário." }, 409);

    const { data: client, error: clientError } = await supabase
      .from("bozo_clientes")
      .upsert({ nome, whatsapp }, { onConflict: "whatsapp" })
      .select("id")
      .single();

    if (clientError || !client) {
      console.error("Client save failed:", clientError?.message);
      return json({ error: "Não foi possível salvar seus dados. Confira o telefone e tente novamente." }, 500);
    }

    let vehicleId: string | null = null;
    if (veiculo) {
      const { data: vehicle, error: vehicleError } = await supabase
        .from("bozo_veiculos")
        .insert({ cliente_id: client.id, modelo: veiculo })
        .select("id")
        .single();
      if (vehicleError || !vehicle) {
        console.error("Vehicle save failed:", vehicleError?.message);
        return json({ error: "Não foi possível registrar o veículo. Confira os dados e tente novamente." }, 500);
      }
      vehicleId = vehicle.id;
    }

    const { data: appointment, error: appointmentError } = await supabase
      .from("bozo_agendamentos")
      .insert({
        cliente_id: client.id,
        veiculo_id: vehicleId,
        servico_id: service.id,
        data_hora: startIso,
        status: "confirmado",
        observacoes: observacoes || null,
        preco_combinado: service.preco,
      })
      .select("id,data_hora")
      .single();

    if (appointmentError || !appointment) {
      console.error("Appointment save failed:", appointmentError?.message);
      if (appointmentError?.code === "23505") {
        return json({ error: "Esse horário acabou de ser reservado. Escolha outro horário." }, 409);
      }
      return json({ error: "Não foi possível confirmar o agendamento. Tente novamente." }, 500);
    }

    // Push goes only to the owner's registered OneSignal subscription; no WhatsApp is used.
    const oneSignalAppId = Deno.env.get("ONESIGNAL_APP_ID_BOZO");
    const oneSignalRestKey = Deno.env.get("ONESIGNAL_REST_API_KEY_BOZO");
    const adminSubscriptionId = Deno.env.get("BOZO_ADMIN_SUBSCRIPTION_ID");
    let notificationSent = false;

    if (oneSignalAppId && oneSignalRestKey && adminSubscriptionId) {
      try {
        const pushResponse = await fetch("https://api.onesignal.com/notifications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Key " + oneSignalRestKey,
          },
          body: JSON.stringify({
            app_id: oneSignalAppId,
            include_subscription_ids: [adminSubscriptionId],
            headings: { pt: "Novo agendamento — Bozo" },
            contents: {
              pt: nome + " agendou " + service.nome + " para " + data.split("-").reverse().join("/") + " às " + horario + ". Telefone: " + whatsapp + (veiculo ? ". Veículo: " + veiculo : ""),
            },
            url: "https://bozo-estetica-automotiva.vercel.app/",
          }),
        });
        notificationSent = pushResponse.ok;
        if (!pushResponse.ok) console.error("OneSignal send failed:", await pushResponse.text());
      } catch (pushError) {
        console.error("OneSignal request failed:", pushError);
      }
    } else {
      console.error("Booking saved, but OneSignal secrets or admin subscription ID are not configured.");
    }

    return json({
      ok: true,
      appointment_id: appointment.id,
      notification_sent: notificationSent,
      message: notificationSent
        ? "Agendamento confirmado."
        : "Agendamento confirmado, mas o aviso ao administrador ainda precisa ser configurado.",
    });
  } catch (error) {
    console.error("Unexpected booking error:", error);
    return json({ error: "Ocorreu um erro inesperado ao confirmar o agendamento." }, 500);
  }
});
