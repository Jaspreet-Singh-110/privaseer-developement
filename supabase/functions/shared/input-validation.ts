export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: any;
}

export function validateEmail(email: string): ValidationResult {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required and must be a string' };
  }

  const trimmed = email.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Email cannot be empty' };
  }

  if (trimmed.length > 254) {
    return { valid: false, error: 'Email is too long (max 254 characters)' };
  }

  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid email format' };
  }

  const [localPart, domain] = trimmed.split('@');

  if (localPart.length > 64) {
    return { valid: false, error: 'Email local part is too long (max 64 characters)' };
  }

  if (domain.length > 255) {
    return { valid: false, error: 'Email domain is too long (max 255 characters)' };
  }

  return { valid: true, sanitized: trimmed.toLowerCase() };
}

export function validateUUID(uuid: string): ValidationResult {
  if (!uuid || typeof uuid !== 'string') {
    return { valid: false, error: 'UUID is required and must be a string' };
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuid)) {
    return { valid: false, error: 'Invalid UUID format' };
  }

  return { valid: true, sanitized: uuid.toLowerCase() };
}

export function validateString(
  value: string,
  fieldName: string,
  options: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
  } = {}
): ValidationResult {
  if (!value || typeof value !== 'string') {
    if (options.required) {
      return { valid: false, error: `${fieldName} is required and must be a string` };
    }
    return { valid: true, sanitized: '' };
  }

  const trimmed = value.trim();

  if (options.required && trimmed.length === 0) {
    return { valid: false, error: `${fieldName} cannot be empty` };
  }

  if (options.minLength && trimmed.length < options.minLength) {
    return {
      valid: false,
      error: `${fieldName} must be at least ${options.minLength} characters`,
    };
  }

  if (options.maxLength && trimmed.length > options.maxLength) {
    return {
      valid: false,
      error: `${fieldName} must be at most ${options.maxLength} characters`,
    };
  }

  if (options.pattern && !options.pattern.test(trimmed)) {
    return { valid: false, error: `${fieldName} has invalid format` };
  }

  return { valid: true, sanitized: trimmed };
}

export function validateNumber(
  value: any,
  fieldName: string,
  options: {
    required?: boolean;
    min?: number;
    max?: number;
    integer?: boolean;
  } = {}
): ValidationResult {
  if (value === undefined || value === null) {
    if (options.required) {
      return { valid: false, error: `${fieldName} is required` };
    }
    return { valid: true, sanitized: undefined };
  }

  const num = Number(value);

  if (isNaN(num)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }

  if (options.integer && !Number.isInteger(num)) {
    return { valid: false, error: `${fieldName} must be an integer` };
  }

  if (options.min !== undefined && num < options.min) {
    return { valid: false, error: `${fieldName} must be at least ${options.min}` };
  }

  if (options.max !== undefined && num > options.max) {
    return { valid: false, error: `${fieldName} must be at most ${options.max}` };
  }

  return { valid: true, sanitized: num };
}

export function validateBoolean(
  value: any,
  fieldName: string,
  required: boolean = false
): ValidationResult {
  if (value === undefined || value === null) {
    if (required) {
      return { valid: false, error: `${fieldName} is required` };
    }
    return { valid: true, sanitized: false };
  }

  if (typeof value === 'boolean') {
    return { valid: true, sanitized: value };
  }

  if (value === 'true') {
    return { valid: true, sanitized: true };
  }

  if (value === 'false') {
    return { valid: true, sanitized: false };
  }

  return { valid: false, error: `${fieldName} must be a boolean` };
}

export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  return html
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
    .replace(/<object[^>]*>.*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}

export function sanitizeSubject(subject: string): string {
  if (!subject || typeof subject !== 'string') {
    return '';
  }

  return subject
    .trim()
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .substring(0, 998);
}

export function validateEmailPayload(payload: any): ValidationResult {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload must be an object' };
  }

  const recipientValidation = validateEmail(payload.recipient || '');
  if (!recipientValidation.valid) {
    return { valid: false, error: `Recipient: ${recipientValidation.error}` };
  }

  const senderValidation = validateEmail(payload.sender || payload.from || '');
  if (!senderValidation.valid) {
    return { valid: false, error: `Sender: ${senderValidation.error}` };
  }

  const subjectValidation = validateString(payload.subject || '', 'Subject', {
    maxLength: 998,
  });
  if (!subjectValidation.valid) {
    return { valid: false, error: subjectValidation.error };
  }

  return {
    valid: true,
    sanitized: {
      recipient: recipientValidation.sanitized,
      sender: senderValidation.sanitized,
      from: payload.from || senderValidation.sanitized,
      subject: sanitizeSubject(payload.subject || ''),
      bodyPlain: validateString(payload.bodyPlain || '', 'Body plain', {
        maxLength: 1000000,
      }).sanitized,
      bodyHtml: sanitizeHtml(payload.bodyHtml || ''),
      strippedText: payload.strippedText,
      strippedSignature: payload.strippedSignature,
      messageHeaders: payload.messageHeaders,
      timestamp: payload.timestamp || Date.now(),
    },
  };
}

export function validateGenerateEmailRequest(body: any): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be an object' };
  }

  const installationIdValidation = validateUUID(body.installationId || '');
  if (!installationIdValidation.valid) {
    return { valid: false, error: `Installation ID: ${installationIdValidation.error}` };
  }

  const realEmailValidation = validateEmail(body.realEmail || '');
  if (!realEmailValidation.valid) {
    return { valid: false, error: `Real email: ${realEmailValidation.error}` };
  }

  const domainValidation = validateString(body.domain || '', 'Domain', {
    required: true,
    maxLength: 255,
  });
  if (!domainValidation.valid) {
    return { valid: false, error: domainValidation.error };
  }

  const urlValidation = validateString(body.url || '', 'URL', {
    maxLength: 2048,
  });
  if (!urlValidation.valid) {
    return { valid: false, error: urlValidation.error };
  }

  const labelValidation = validateString(body.label || '', 'Label', {
    maxLength: 255,
  });
  if (!labelValidation.valid) {
    return { valid: false, error: labelValidation.error };
  }

  const descriptionValidation = validateString(body.description || '', 'Description', {
    maxLength: 500,
  });
  if (!descriptionValidation.valid) {
    return { valid: false, error: descriptionValidation.error };
  }

  const expiresInDaysValidation = validateNumber(body.expiresInDays, 'Expires in days', {
    min: 1,
    max: 365,
    integer: true,
  });
  if (!expiresInDaysValidation.valid) {
    return { valid: false, error: expiresInDaysValidation.error };
  }

  return {
    valid: true,
    sanitized: {
      installationId: installationIdValidation.sanitized,
      realEmail: realEmailValidation.sanitized,
      domain: domainValidation.sanitized,
      url: urlValidation.sanitized,
      label: labelValidation.sanitized,
      description: descriptionValidation.sanitized,
      expiresInDays: expiresInDaysValidation.sanitized,
    },
  };
}

export function createValidationErrorResponse(error: string): Response {
  return new Response(
    JSON.stringify({
      error: 'Validation error',
      message: error,
    }),
    {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
