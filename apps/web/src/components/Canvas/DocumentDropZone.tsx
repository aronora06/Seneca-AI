/**
 * Empty / drop-target state for the Documents tab. Click-to-pick (mobile
 * friendly) and desktop drag-drop both route through the same callback.
 */

import clsx from "clsx";
import { useCallback, useRef, useState } from "react";

interface DocumentDropZoneProps {
  uploading: boolean;
  onUpload: (file: File) => void;
}

const MAX_BYTES = 25 * 1024 * 1024;

export function DocumentDropZone({
  uploading,
  onUpload,
}: DocumentDropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const triggerPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      const err = validateFile(file);
      if (err) {
        setLocalError(err);
        return;
      }
      setLocalError(null);
      onUpload(file);
    },
    [onUpload],
  );

  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-8"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        handleFile(file);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          handleFile(file);
          e.target.value = "";
        }}
      />
      <div
        className={clsx(
          "card flex max-w-md flex-col items-center gap-3 p-8 text-center transition-colors",
          dragOver && "border-accent/60 bg-accent/5",
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunk text-fg-muted">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 4h9l5 5v11H5z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M14 4v5h5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="space-y-1">
          <p className="font-serif text-lg text-fg">
            Bring a document into the conversation.
          </p>
          <p className="text-sm text-fg-muted">
            Drop a file here, or use the button below. PDF, .docx, .pptx, .md,
            .txt, .html — up to {MAX_BYTES / 1024 / 1024} MB.
          </p>
        </div>
        <button
          type="button"
          onClick={triggerPicker}
          disabled={uploading}
          className={clsx(
            "btn h-9 px-4 text-xs font-medium",
            uploading
              ? "cursor-not-allowed bg-surface-sunk text-fg-subtle"
              : "bg-fg text-fg-on hover:opacity-90",
          )}
        >
          {uploading ? "Uploading…" : "Choose a file"}
        </button>
        {localError && (
          <p className="text-xs text-danger" role="alert">
            {localError}
          </p>
        )}
      </div>
    </div>
  );
}

// Phase 5: mirrored from the server's extractor registry. See the same
// const in DocumentSidebar.tsx — keep both in sync when adding formats.
const SUPPORTED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".pptx",
  ".md",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
] as const;
const SUPPORTED_MIMES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "text/html",
  "application/xhtml+xml",
  "application/zip",
]);
const ACCEPTED_FILE_TYPES = [
  ...SUPPORTED_MIMES,
  ...SUPPORTED_EXTENSIONS,
].join(",");

function validateFile(file: File): string | null {
  const lowerName = file.name.toLowerCase();
  const hasExt = SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const hasMime = file.type && SUPPORTED_MIMES.has(file.type);
  if (!hasExt && !hasMime) {
    return "Unsupported file type. Seneca accepts PDF, .docx, .pptx, .md, .txt, .html.";
  }
  if (file.size > MAX_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max upload size is ${MAX_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}
