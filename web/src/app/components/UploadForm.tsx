import { useRef, useState, type DragEvent } from 'react';
import { ACCEPTED_TYPES } from '../../utils/imageValidation.ts';

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  maxSizeLabel: string;
}

export function UploadForm({ onFiles, disabled, maxSizeLabel }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  };

  return (
    <div
      className={`dropzone${over ? ' dropzone--over' : ''}${disabled ? ' dropzone--disabled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <p className="dropzone__title">Drag fuel pump photos here</p>
      <p className="dropzone__hint">JPEG, PNG or WebP · up to {maxSizeLabel} each · photos stay on this device</p>
      <button type="button" className="btn" disabled={disabled} onClick={() => input.current?.click()}>
        Browse files
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
