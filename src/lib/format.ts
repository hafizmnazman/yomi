// Pure helpers for presenting decoded payloads. No Tauri / no IO, so they unit-test cleanly.

import type { ScanKind } from "./types";

export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

export const KIND_LABEL: Record<ScanKind, string> = {
  url: "Link",
  email: "Email",
  phone: "Phone",
  sms: "SMS",
  wifi: "Wi-Fi",
  geo: "Location",
  vcard: "Contact",
  text: "Text",
};

/** Whether the OS can usefully "open" this payload via a URL scheme. */
export function isOpenable(kind: ScanKind): boolean {
  return kind === "url" || kind === "email" || kind === "phone" || kind === "sms" || kind === "geo";
}

/** WIFI:T:WPA;S:MyNet;P:secret;H:false;; -> structured. */
export function parseWifi(content: string): { ssid: string; auth: string; password: string; hidden: boolean } | null {
  if (!/^wifi:/i.test(content)) return null;
  const body = content.slice(content.indexOf(":") + 1);
  const get = (k: string) => {
    const m = body.match(new RegExp(`(?:^|;)${k}:((?:\\\\.|[^;])*)`, "i"));
    return m ? m[1].replace(/\\([\\;,:"])/g, "$1") : "";
  };
  const auth = get("T") || "nopass";
  return {
    ssid: get("S"),
    auth: auth.toUpperCase() === "NOPASS" ? "Open" : auth.toUpperCase(),
    password: get("P"),
    hidden: /true/i.test(get("H")),
  };
}

/** geo:lat,lng[,alt][?q=...] -> structured. */
export function parseGeo(content: string): { lat: string; lng: string; label?: string } | null {
  const m = content.match(/^geo:([-\d.]+),([-\d.]+)/i);
  if (!m) return null;
  const q = content.match(/[?&]q=([^&]+)/i);
  return { lat: m[1], lng: m[2], label: q ? decodeURIComponent(q[1]) : undefined };
}

/** sms:NUMBER[?body=...] or smsto:NUMBER:BODY -> structured. */
export function parseSms(content: string): { number: string; body?: string } | null {
  let m = content.match(/^smsto:([^:]+)(?::(.*))?$/i);
  if (m) return { number: m[1], body: m[2] || undefined };
  m = content.match(/^sms:([^?]+)(?:\?body=(.*))?$/i);
  if (m) return { number: m[1], body: m[2] ? decodeURIComponent(m[2]) : undefined };
  return null;
}

/** Minimal vCard field extraction (BEGIN:VCARD ... END:VCARD). */
export function parseVCard(content: string): { name?: string; org?: string; tel?: string; email?: string; url?: string } | null {
  if (!/begin:vcard/i.test(content)) return null;
  const line = (k: string) => {
    const m = content.match(new RegExp(`^${k}(?:;[^:]*)?:(.*)$`, "im"));
    return m ? m[1].trim() : undefined;
  };
  const fn = line("FN");
  const n = line("N");
  return {
    name: fn || (n ? n.split(";").filter(Boolean).reverse().join(" ").trim() : undefined),
    org: line("ORG"),
    tel: line("TEL"),
    email: line("EMAIL"),
    url: line("URL"),
  };
}

/** The single-line preview shown in history. */
export function previewLine(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}
