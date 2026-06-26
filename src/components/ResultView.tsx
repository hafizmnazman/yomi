import type { ScanResult } from "../lib/types";
import type { FileScan } from "../lib/scan";
import ResultCard from "./ResultCard";

export type ScanStatus = "idle" | "scanning" | "error";

interface Props {
  status: ScanStatus;
  error: string | null;
  results: ScanResult[] | null;
  batch: FileScan[] | null;
  onCopy: (s: string) => void;
  onOpen: (r: ScanResult) => void;
}

export default function ResultView({ status, error, results, batch, onCopy, onOpen }: Props) {
  if (status === "error") {
    return (
      <div className="results">
        <div className="notice error">{error ?? "Something went wrong."}</div>
      </div>
    );
  }

  if (batch) {
    const found = batch.reduce((n, f) => n + f.results.length, 0);
    const withCodes = batch.filter((f) => f.results.length > 0);
    return (
      <div className="results">
        <div className="notice">
          Scanned {batch.length} image{batch.length === 1 ? "" : "s"}, found {found} code
          {found === 1 ? "" : "s"}.
        </div>
        {withCodes.flatMap((f) =>
          f.results.map((r, i) => (
            <ResultCard
              key={`${f.path}-${i}`}
              result={r}
              label={f.fileName}
              onCopy={onCopy}
              onOpen={onOpen}
            />
          )),
        )}
      </div>
    );
  }

  if (results) {
    if (results.length === 0) {
      return (
        <div className="results">
          <div className="notice">No QR found. Try a tighter crop or a sharper image.</div>
        </div>
      );
    }
    return (
      <div className="results">
        {results.map((r, i) => (
          <ResultCard key={i} result={r} onCopy={onCopy} onOpen={onOpen} />
        ))}
      </div>
    );
  }

  return <div className="results" />;
}
