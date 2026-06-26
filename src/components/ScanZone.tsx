import { ImageIcon, SnipIcon, ClipboardIcon, FolderIcon } from "./icons";

interface Props {
  dragging: boolean;
  scanning: boolean;
  reduceMotion: boolean;
  onOpenImage: () => void;
  onSnip: () => void;
  onClipboard: () => void;
  onBatch: () => void;
}

export default function ScanZone({
  dragging,
  scanning,
  reduceMotion,
  onOpenImage,
  onSnip,
  onClipboard,
  onBatch,
}: Props) {
  return (
    <div className={`scanzone${dragging ? " dragging" : ""}`}>
      {scanning && !reduceMotion && <div className="scanline" aria-hidden />}
      <h2>{dragging ? "Drop to read it" : "Read a QR code"}</h2>
      <p className="hint">
        Drop an image, pick one, or snip a region of your screen. Every code you read lands in
        your history.
      </p>
      <div className="scanzone-actions">
        <button className="btn btn-primary" onClick={onOpenImage}>
          <ImageIcon /> Open image
        </button>
        <button className="btn btn-amber" onClick={onSnip}>
          <SnipIcon /> Snip region
        </button>
        <button className="btn btn-ghost" onClick={onClipboard}>
          <ClipboardIcon /> From clipboard
        </button>
        <button className="btn btn-ghost" onClick={onBatch}>
          <FolderIcon /> Scan folder
        </button>
      </div>
    </div>
  );
}
