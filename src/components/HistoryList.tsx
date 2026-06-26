import type { HistoryEntry, ScanResult, ScanSource } from "../lib/types";
import { timeAgo, previewLine, KIND_LABEL } from "../lib/format";
import {
  SearchIcon,
  CopyIcon,
  OpenIcon,
  TrashIcon,
  FileMark,
  SnipIcon,
  ClipboardIcon,
  FolderIcon,
} from "./icons";
import { isOpenable } from "../lib/format";

interface Props {
  entries: HistoryEntry[];
  search: string;
  onSearch: (s: string) => void;
  onCopy: (s: string) => void;
  onOpen: (r: ScanResult) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onExport: () => void;
}

function SourceMark({ source }: { source: ScanSource }) {
  const icon =
    source === "region" ? (
      <SnipIcon size={14} />
    ) : source === "clipboard" ? (
      <ClipboardIcon size={14} />
    ) : source === "batch" ? (
      <FolderIcon size={14} />
    ) : (
      <FileMark size={14} />
    );
  return (
    <span className="src" title={source}>
      {icon}
    </span>
  );
}

export default function HistoryList({
  entries,
  search,
  onSearch,
  onCopy,
  onOpen,
  onDelete,
  onClear,
  onExport,
}: Props) {
  const q = search.trim().toLowerCase();
  const shown = q
    ? entries.filter(
        (e) => e.content.toLowerCase().includes(q) || (e.fileName ?? "").toLowerCase().includes(q),
      )
    : entries;

  return (
    <div className="rail">
      <div className="rail-head">
        <h3>History</h3>
        <div className="tabs">
          <button className="btn-icon" title="Export CSV" onClick={onExport} disabled={!entries.length}>
            CSV
          </button>
          <button
            className="btn-icon btn-danger"
            title="Clear all"
            onClick={onClear}
            disabled={!entries.length}
          >
            <TrashIcon size={15} />
          </button>
        </div>
      </div>

      <div className="rail-search">
        <label className="input" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SearchIcon size={15} />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search history"
            style={{ all: "unset", flex: 1, color: "inherit" }}
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="rail-empty">
          {entries.length === 0 ? "Nothing scanned yet." : "No matches."}
        </div>
      ) : (
        <ul className="history">
          {shown.map((e) => (
            <li key={e.id} className="history-item">
              <SourceMark source={e.source} />
              <div className="history-content">
                <div className="line">{previewLine(e.content)}</div>
                <div className="meta">
                  {KIND_LABEL[e.kind]} · {timeAgo(e.at)}
                  {e.fileName ? ` · ${e.fileName}` : ""}
                </div>
              </div>
              <div className="history-actions">
                <button className="btn-icon" title="Copy" onClick={() => onCopy(e.content)}>
                  <CopyIcon size={15} />
                </button>
                {isOpenable(e.kind) && (
                  <button className="btn-icon" title="Open" onClick={() => onOpen(e)}>
                    <OpenIcon size={15} />
                  </button>
                )}
                <button
                  className="btn-icon btn-danger"
                  title="Remove"
                  onClick={() => onDelete(e.id)}
                >
                  <TrashIcon size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
