/* global window */
/**
 * Aparelhos do laboratório de celular e tablet (23/11/2026). O APK do Muchat é um
 * WebView do Android que abre o site; aqui o Chromium faz o papel dele, com a tela,
 * a densidade e o toque de cada aparelho e o user agent do WebView com
 * " Muchat/<versão>" no fim, como o MainActivity monta.
 *
 * Os tamanhos são em px CSS, como o WebView mede (a barra de status e a de
 * navegação do Android já ficam de fora).
 */

const CHROME = "131.0.6778.135";
const APP = "Muchat/1.0.11";
const phoneUa = (model) =>
  `Mozilla/5.0 (Linux; Android 14; ${model} Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${CHROME} Mobile Safari/537.36 ${APP}`;
const tabletUa = (model) =>
  `Mozilla/5.0 (Linux; Android 14; ${model} Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${CHROME} Safari/537.36 ${APP}`;

/** @type {Record<string, {label: string, viewport: {width: number, height: number}, deviceScaleFactor: number, isMobile: boolean, hasTouch: boolean, userAgent: string | undefined}>} */
export const DEVICES = {
  // Celular comum no Brasil (Galaxy A54 e afins).
  phone: {
    label: "Celular em pé (393×851)",
    viewport: { width: 393, height: 851 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    userAgent: phoneUa("SM-A546E"),
  },
  // O menor que ainda é comum: 360 de largura.
  "phone-small": {
    label: "Celular pequeno (360×740)",
    viewport: { width: 360, height: 740 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: phoneUa("SM-A145M"),
  },
  "phone-land": {
    label: "Celular deitado (851×393)",
    viewport: { width: 851, height: 393 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    userAgent: phoneUa("SM-A546E"),
  },
  // Tablet de 10" (Galaxy Tab A8/A9+).
  tablet: {
    label: "Tablet em pé (800×1280)",
    viewport: { width: 800, height: 1280 },
    deviceScaleFactor: 1.5,
    isMobile: true,
    hasTouch: true,
    userAgent: tabletUa("SM-X210"),
  },
  "tablet-land": {
    label: "Tablet deitado (1280×800)",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
    isMobile: true,
    hasTouch: true,
    userAgent: tabletUa("SM-X210"),
  },
  desktop: {
    label: "Computador (1600×900)",
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent: undefined,
  },
};

/** Opções de contexto do Playwright para um aparelho. */
export function deviceContext(name) {
  const d = DEVICES[name];
  if (!d)
    throw new Error(
      `aparelho desconhecido: ${name} (${Object.keys(DEVICES).join(", ")})`,
    );
  const { label: _label, userAgent, ...rest } = d;
  return userAgent ? { ...rest, userAgent } : rest;
}

/** O APK expõe `window.MuchatNative`; o app muda alguns caminhos por ele (toque, splash). */
export function isAppDevice(name) {
  return name !== "desktop";
}

/**
 * A ponte do APK, sem o lado nativo: o app a usa para o splash, o serviço de voz em
 * segundo plano, o token do FCM e a proteção de tela. A tela compartilhada fica de
 * fora (sem ela o app usa o getDisplayMedia do navegador).
 */
export function fakeBridge() {
  window.MuchatNative = {
    hideSplash() {},
    startVoiceSession() {},
    stopVoiceSession() {},
    fcmToken() {
      return "";
    },
    setContentProtection() {},
  };
}
