-- Bozo Estetica Automotiva: configuracao isolada de agenda
-- Execute no SQL Editor do projeto Supabase gzpvwzspjgmhfmvkbwah.
-- Este script usa somente objetos com prefixo bozo_.

-- Servicos iniciais. Preco 0 significa "a definir"; nao exibimos preco no formulario.
INSERT INTO public.bozo_servicos (nome, descricao, preco, duracao_minutos, ativo, ordem)
SELECT v.nome, v.descricao, 0, 60, true, v.ordem
FROM (VALUES
  ('Lavagem detalhada', 'Lavagem detalhada automotiva', 1),
  ('Polimento técnico', 'Polimento técnico automotivo', 2),
  ('Vitrificação', 'Vitrificação e proteção da pintura', 3),
  ('Higienização interna', 'Higienização interna do veículo', 4),
  ('Revitalização de pintura', 'Revitalização de pintura', 5),
  ('Pacote personalizado', 'Serviço personalizado a combinar', 6)
) AS v(nome, descricao, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM public.bozo_servicos s WHERE lower(s.nome) = lower(v.nome)
);

-- Um horário de início só pode ser reservado uma vez. Cancelados liberam o horário.
CREATE UNIQUE INDEX IF NOT EXISTS bozo_agendamentos_horario_ativo_uidx
ON public.bozo_agendamentos (data_hora)
WHERE lower(status) NOT IN ('cancelado','cancelada','canceled','cancelled','rejeitado','rejected');

-- Retorna somente os horários ocupados do dia, sem expor dados dos clientes.
CREATE OR REPLACE FUNCTION public.bozo_horarios_ocupados(p_data date)
RETURNS TABLE (horario text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_char(a.data_hora AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS horario
  FROM public.bozo_agendamentos a
  WHERE (a.data_hora AT TIME ZONE 'America/Sao_Paulo')::date = p_data
    AND lower(a.status) NOT IN ('cancelado','cancelada','canceled','cancelled','rejeitado','rejected')
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.bozo_horarios_ocupados(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bozo_horarios_ocupados(date) TO anon, authenticated;
