import { Trans, useLingui } from "@lingui/solid/macro";
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import {
  openSupportCheckout,
  refreshEntitlements,
  useEntitlements,
} from "@revolt/rtc/entitlements";
import { Button, Column, Text } from "@revolt/ui";

/**
 * Support the Muchat from inside the app.
 *
 * Why this exists rather than the /doar link the menu used to point at: that
 * page is static HTML served by Caddy, with no session, so a donation made
 * there cannot be tied to an account — and a donation with no account cannot
 * grant anything. Someone paid R$ 20 through it and got nothing, which is the
 * worst possible failure for a page about money.
 *
 * Here the session is already in hand, so the `stoat_user_id` reaching the API
 * is verified rather than typed.
 */

const PRESETS_CENTS = [2000, 3000, 5000];

/** Same floor as MIN_VIP_CENTS on the backend. Below it is support, not VIP. */
const VIP_FROM_CENTS = 2000;

export function Support() {
  const { t } = useLingui();
  const client = useClient();
  const entitlements = useEntitlements;

  const [amountCents, setAmountCents] = createSignal(PRESETS_CENTS[0]);
  const [frequency, setFrequency] = createSignal<"once" | "monthly">("once");
  const [email, setEmail] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();

  const isVipAmount = createMemo(() => amountCents() >= VIP_FROM_CENTS);
  const needsEmail = createMemo(() => frequency() === "monthly");

  const vipUntilLabel = createMemo(() => {
    const until = entitlements().vipUntil;
    if (!until) return undefined;
    const parsed = new Date(until);
    return Number.isNaN(parsed.getTime())
      ? undefined
      : parsed.toLocaleDateString();
  });

  // O pagamento acontece fora do app, então não há evento para esperar. Com a
  // tela aberta, reperguntar de tempos em tempos faz o VIP aparecer sozinho
  // quando o Mercado Pago confirma — em vez de exigir reabrir o app.
  const poll = setInterval(() => {
    void refreshEntitlements(client());
  }, 15_000);
  onCleanup(() => clearInterval(poll));

  const money = (cents: number) =>
    (cents / 100).toLocaleString(undefined, {
      style: "currency",
      currency: "BRL",
    });

  async function go() {
    setError(undefined);
    if (needsEmail() && !email().trim()) {
      setError(t`O Mercado Pago pede e-mail no apoio mensal.`);
      return;
    }
    setBusy(true);
    try {
      const url = await openSupportCheckout(client(), {
        amountCents: amountCents(),
        frequency: frequency(),
        payerEmail: email().trim() || undefined,
      });
      if (!url) {
        setError(t`Não consegui abrir o checkout. Tente de novo em instantes.`);
        return;
      }
      window.open(url, "_blank", "noopener");
    } catch {
      setError(t`Não consegui falar com o servidor.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Column gap="lg">
      <Column gap="xs">
        <Text class="title">
          <Trans>Apoiar o Muchat</Trans>
        </Text>
        <Text class="label" size="small">
          <Trans>
            O chat é de graça. Apoiar ajuda a pagar o servidor — e a partir de
            R$ 20 libera 30 dias de tela em 1080p e 60 fps, câmera em 1080p e
            áudio melhor. Apoios seguidos somam os prazos.
          </Trans>
        </Text>
      </Column>

      <Card>
        <Show
          when={entitlements().tier === "vip"}
          fallback={
            <Text class="label">
              <Trans>Você ainda não é apoiador.</Trans>
            </Text>
          }
        >
          <Text class="label">
            <Show
              when={vipUntilLabel()}
              fallback={<Trans>Você é apoiador.</Trans>}
            >
              <Trans>Você é apoiador até {vipUntilLabel()}.</Trans>
            </Show>
          </Text>
        </Show>
      </Card>

      <Column gap="sm">
        <Text class="label" size="small">
          <Trans>Frequência</Trans>
        </Text>
        <Row>
          <Button
            group="connected-start"
            groupActive={frequency() === "once"}
            onPress={() => setFrequency("once")}
          >
            <Trans>Uma vez</Trans>
          </Button>
          <Button
            group="connected-end"
            groupActive={frequency() === "monthly"}
            onPress={() => setFrequency("monthly")}
          >
            <Trans>Todo mês</Trans>
          </Button>
        </Row>
      </Column>

      <Column gap="sm">
        <Text class="label" size="small">
          <Trans>Valor</Trans>
        </Text>
        <Row>
          <For each={PRESETS_CENTS}>
            {(cents, index) => (
              <Button
                group={
                  index() === 0
                    ? "connected-start"
                    : index() === PRESETS_CENTS.length - 1
                      ? "connected-end"
                      : "connected"
                }
                groupActive={amountCents() === cents}
                onPress={() => setAmountCents(cents)}
              >
                {money(cents)}
              </Button>
            )}
          </For>
        </Row>
        <Text class="label" size="small">
          <Show
            when={isVipAmount()}
            fallback={
              <Trans>
                Abaixo de R$ 20 o apoio ajuda no servidor, mas não libera o VIP.
              </Trans>
            }
          >
            <Trans>Libera 30 dias de VIP.</Trans>
          </Show>
        </Text>
      </Column>

      <Show when={needsEmail()}>
        <Column gap="sm">
          <Text class="label" size="small">
            <Trans>E-mail (o Mercado Pago exige no mensal)</Trans>
          </Text>
          <Input
            type="email"
            autocomplete="email"
            value={email()}
            onInput={(event) => setEmail(event.currentTarget.value)}
            placeholder="voce@email.com"
          />
        </Column>
      </Show>

      <Show when={error()}>
        <Text class="label" size="small">
          {error()}
        </Text>
      </Show>

      <Button variant="filled" isDisabled={busy()} onPress={() => void go()}>
        <Show when={busy()} fallback={<Trans>Continuar no Mercado Pago</Trans>}>
          <Trans>Abrindo…</Trans>
        </Show>
      </Button>

      <Text class="label" size="small">
        <Trans>
          O pagamento abre numa janela do navegador. Quando confirmar, volte
          aqui — o VIP entra sozinho, sem precisar reabrir o app.
        </Trans>
      </Text>
    </Column>
  );
}

const Card = styled("div", {
  base: {
    padding: "var(--gap-lg)",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container)",
  },
});

const Row = styled("div", {
  base: {
    display: "flex",
    gap: "var(--gap-xs)",
  },
});

const Input = styled("input", {
  base: {
    width: "100%",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-md)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container-highest)",
    color: "var(--md-sys-color-on-surface)",
    font: "inherit",
  },
});
