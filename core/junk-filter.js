'use strict';

const PLACEHOLDER_EMAILS = new Set([
  'test@test.com',
  'test@example.com',
  'example@example.com',
  'name@example.com',
  'email@example.com',
  'your@email.com',
  'you@example.com',
  'abc@abc.com',
  'abc@gmail.com',
  'demo@demo.com'
]);

const JUNK_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'localhost',
  'localhost.localdomain',
  'test.com',
  'test.org',
  'invalid.com'
]);

const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.tiff'
];

const SOCIAL_DOMAINS = new Set([
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com'
]);

function getDomain(email) {
  if (!email || !email.includes('@')) return '';

  return email.split('@').pop().toLowerCase().trim();
}

function isValidEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

function isPlaceholderEmail(email) {
  return PLACEHOLDER_EMAILS.has((email || '').toLowerCase());
}

function isJunkDomain(domain) {
  return JUNK_DOMAINS.has((domain || '').toLowerCase());
}

function isImageLikeEmail(email) {
  const lower = (email || '').toLowerCase();

  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function isSocialOnlyDomain(domain) {
  return SOCIAL_DOMAINS.has((domain || '').toLowerCase());
}

function classifyEmail(email) {
  const normalized = (email || '').toLowerCase().trim();
  const domain = getDomain(normalized);

  if (!normalized) {
    return {
      valid: false,
      reason: 'empty_email',
      domain
    };
  }

  if (!isValidEmailFormat(normalized)) {
    return {
      valid: false,
      reason: 'invalid_format',
      domain
    };
  }

  if (isPlaceholderEmail(normalized)) {
    return {
      valid: false,
      reason: 'placeholder',
      domain
    };
  }

  if (isJunkDomain(domain)) {
    return {
      valid: false,
      reason: 'junk_domain',
      domain
    };
  }

  if (isImageLikeEmail(normalized)) {
    return {
      valid: false,
      reason: 'image_asset',
      domain
    };
  }

  if (isSocialOnlyDomain(domain)) {
    return {
      valid: false,
      reason: 'social_media_only',
      domain
    };
  }

  const localPart = normalized.split('@')[0];

  const rolePatterns = [
    'info',
    'sales',
    'contact',
    'admin',
    'office',
    'support',
    'enquiry',
    'inquiry',
    'marketing',
    'business',
    'export',
    'exports',
    'purchase',
    'purchases',
    'procurement',
    'tender'
  ];

  const isRoleEmail = rolePatterns.includes(localPart);

  return {
    valid: true,
    reason: isRoleEmail ? 'role_email' : 'business_email',
    domain,
    is_role_email: isRoleEmail
  };
}

module.exports = {
  getDomain,
  isValidEmailFormat,
  isPlaceholderEmail,
  isJunkDomain,
  isImageLikeEmail,
  isSocialOnlyDomain,
  classifyEmail
};
