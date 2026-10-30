export type ProcessingErrorCode =
  | 'unsupported_type'
  | 'too_large'
  | 'decode_failed'
  | 'no_numbers'
  | 'timeout'
  | 'init_failed'
  | 'cancelled'
  | 'internal';

export interface ProcessingError {
  code: ProcessingErrorCode;
  message: string;
}

export function processingError(code: ProcessingErrorCode, message: string): ProcessingError {
  return { code, message };
}

export const ERROR_MESSAGES: Record<ProcessingErrorCode, string> = {
  unsupported_type: 'Unsupported file type. Use JPEG, PNG or WebP.',
  too_large: 'File is larger than the allowed size.',
  decode_failed: 'The image could not be opened. It may be corrupt.',
  no_numbers: 'No numbers were found on this image.',
  timeout: 'Processing took too long and was stopped.',
  init_failed: 'The image processor could not start in this browser.',
  cancelled: 'Processing was cancelled.',
  internal: 'Unexpected processing error.',
};
