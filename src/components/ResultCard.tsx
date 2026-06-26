import type { ScanResult } from "../lib/types";
import { KIND_LABEL, isOpenable, parseWifi, parseGeo, parseSms, parseVCard } from "../lib/format";
import { CopyIcon, OpenIcon } from "./icons";

interface Props {
  result: ScanResult;
  label?: string; // optional source label (e.g. a file name in batch results)
  onCopy: (s: string) => void;
  onOpen: (r: ScanResult) => void;
}

function Fields({ result }: { result: ScanResult }) {
  if (result.kind === "wifi") {
    const w = parseWifi(result.content);
    if (!w) return null;
    return (
      <dl className="fields">
        <dt>Network</dt>
        <dd>{w.ssid || "(hidden)"}</dd>
        <dt>Security</dt>
        <dd>{w.auth}</dd>
        {w.password && (
          <>
            <dt>Password</dt>
            <dd>{w.password}</dd>
          </>
        )}
      </dl>
    );
  }
  if (result.kind === "geo") {
    const g = parseGeo(result.content);
    if (!g) return null;
    return (
      <dl className="fields">
        <dt>Latitude</dt>
        <dd>{g.lat}</dd>
        <dt>Longitude</dt>
        <dd>{g.lng}</dd>
        {g.label && (
          <>
            <dt>Place</dt>
            <dd>{g.label}</dd>
          </>
        )}
      </dl>
    );
  }
  if (result.kind === "sms") {
    const s = parseSms(result.content);
    if (!s) return null;
    return (
      <dl className="fields">
        <dt>Number</dt>
        <dd>{s.number}</dd>
        {s.body && (
          <>
            <dt>Message</dt>
            <dd>{s.body}</dd>
          </>
        )}
      </dl>
    );
  }
  if (result.kind === "vcard") {
    const v = parseVCard(result.content);
    if (!v) return null;
    return (
      <dl className="fields">
        {v.name && (
          <>
            <dt>Name</dt>
            <dd>{v.name}</dd>
          </>
        )}
        {v.org && (
          <>
            <dt>Org</dt>
            <dd>{v.org}</dd>
          </>
        )}
        {v.tel && (
          <>
            <dt>Phone</dt>
            <dd>{v.tel}</dd>
          </>
        )}
        {v.email && (
          <>
            <dt>Email</dt>
            <dd>{v.email}</dd>
          </>
        )}
      </dl>
    );
  }
  return null;
}

export default function ResultCard({ result, label, onCopy, onOpen }: Props) {
  const isUrl = result.kind === "url";
  return (
    <div className="card result-card">
      <div className="result-head">
        <span className={`chip${isUrl ? " url" : ""}`}>{KIND_LABEL[result.kind]}</span>
        {label && <span className="meta selectable">{label}</span>}
      </div>
      <div className={`payload${isUrl ? " revealed" : ""}`}>{result.content}</div>
      <Fields result={result} />
      <div className="result-actions">
        <button className="btn btn-ghost" onClick={() => onCopy(result.content)}>
          <CopyIcon /> Copy
        </button>
        {isOpenable(result.kind) && (
          <button className="btn btn-primary" onClick={() => onOpen(result)}>
            <OpenIcon /> Open
          </button>
        )}
      </div>
    </div>
  );
}
