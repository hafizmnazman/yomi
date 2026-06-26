import { useEffect, useRef, useState } from "react";
import { generateQr, saveQrPng } from "../lib/actions";
import { CloseIcon } from "./icons";

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
}

export default function QrModal({ onClose, onToast }: Props) {
  const [content, setContent] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bytesRef = useRef<number[] | null>(null);
  const urlRef = useRef<string | null>(null); // the live object URL, for revocation

  useEffect(() => {
    const text = content.trim();
    if (!text) {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      bytesRef.current = null;
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { bytes, url: fresh } = await generateQr(text);
        if (cancelled) {
          URL.revokeObjectURL(fresh);
          return;
        }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = fresh;
        bytesRef.current = bytes;
        setUrl(fresh);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setUrl(null);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [content]);

  // Revoke the last live URL on unmount (no setState, so no warnings).
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="result-head">
          <h3>Generate a QR code</h3>
          <button className="btn-icon" onClick={onClose} title="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="field-row">
          <label>Text or URL</label>
          <textarea
            className="input"
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="https://example.com"
            autoFocus
          />
        </div>

        {error && <div className="notice error">{error}</div>}

        {url && (
          <>
            <div className="qr-preview">
              <img src={url} alt="Generated QR code" />
            </div>
            <div className="result-actions">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (bytesRef.current && (await saveQrPng(bytesRef.current))) {
                    onToast("Saved");
                  }
                }}
              >
                Save PNG
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
