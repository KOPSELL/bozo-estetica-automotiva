# Configuração da agenda online da Bozo

O formulário do site foi preparado para criar agendamentos diretamente, sem abrir WhatsApp. Para a confirmação funcionar em produção, é necessário executar o SQL e publicar a Edge Function no Supabase.

## 1. Executar o SQL

1. Abra o projeto Supabase `gzpvwzspjgmhfmvkbwah`.
2. Entre em **SQL Editor**.
3. Abra o arquivo `supabase/bozo_agendamento_setup.sql` neste repositório, copie o conteúdo e execute.
4. Confirme que terminou sem erro.

Esse script só usa objetos `bozo_*`. Ele cadastra os seis serviços iniciais com preço 0 (preço ainda não informado), cria uma proteção contra dois agendamentos no mesmo horário e cria uma RPC que retorna apenas os horários ocupados.

## 2. Publicar a Edge Function

No Supabase, abra **Edge Functions** e crie uma função chamada `bozo-agendamento`. Use o código deste repositório em `supabase/functions/bozo-agendamento/index.ts` e publique.

Se estiver usando Supabase CLI, na raiz do repositório execute:

```bash
supabase functions deploy bozo-agendamento --project-ref gzpvwzspjgmhfmvkbwah
```

A função usa as variáveis padrão do Supabase `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, sem expor a chave de serviço no navegador.

## 3. Configurar o push privado do administrador

Em **Supabase → Edge Functions → Secrets**, configure:

- `ONESIGNAL_APP_ID_BOZO` = App ID da Bozo: `60a6b2ba-47ca-4b23-9467-14a339493a08`
- `ONESIGNAL_REST_API_KEY_BOZO` = REST API Key da aplicação Bozo no OneSignal (secreta; nunca colocar no HTML/GitHub)
- `BOZO_ADMIN_SUBSCRIPTION_ID` = ID da assinatura do navegador do proprietário no OneSignal

Para encontrar o ID do computador: OneSignal → Audience → Subscriptions → abra a assinatura deste computador e copie o Subscription ID. Confirme que está como Subscribed. Não use a chave REST API no lugar do Subscription ID.

## 4. Confirmar a implantação

- Aguarde o deploy do Vercel do site.
- Acesse o site e escolha uma data futura.
- Os horários ocupados devem aparecer desabilitados.
- Faça um agendamento de teste. Ele deve aparecer em `bozo_agendamentos`.
- A notificação é enviada somente para o Subscription ID configurado.

**Importante:** até que o SQL seja executado, a Edge Function seja publicada e os três secrets de OneSignal sejam configurados, o formulário publicado não conseguirá confirmar agendamentos de ponta a ponta. Não compartilhe a REST API Key em chats ou no código do site.
