import { useRef, useState, type DragEvent } from 'react';

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
  error: string | null;
}

export function Uploader({ onFile, busy, error }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <div className="uploader-wrap">
      <div
        className={`dropzone${over ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') input.current?.click();
        }}
        aria-busy={busy}
      >
        <svg className="dropzone-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
        <p className="dropzone-title">{busy ? 'Opening image…' : 'Drop a JPG or PNG here'}</p>
        <p className="dropzone-sub">or click to choose a file</p>
        <input
          ref={input}
          type="file"
          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="promise">
        <li>Your image stays on this device. Nothing is uploaded.</li>
        <li>Crop to 2:3, 3:4 or 4:5 and see the largest print size at 300 PPI.</li>
        <li>Download print-ready JPGs, tagged 300 DPI.</li>
      </ul>
    </div>
  );
}
