export const MICROSOFT_STORE_WEB_URL =
  "https://apps.microsoft.com/detail/XPFCFRJ95KS7M5";

/** Windows browsers go to the Store; everyone else lands on /download (APK, web). */
export function nativeDownloadHref(userAgent: string): string {
  return /windows/i.test(userAgent) ? MICROSOFT_STORE_WEB_URL : "/download";
}
