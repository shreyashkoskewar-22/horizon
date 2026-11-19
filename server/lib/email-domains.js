'use strict';
/** Personal / disposable email providers. Recruiters must use an organisational domain. */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com',
  'outlook.com', 'outlook.in', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.in', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'zoho.com', 'zohomail.com', 'zohomail.in', 'rediffmail.com', 'rediff.com',
  'gmx.com', 'gmx.de', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru', 'tutanota.com', 'tuta.io', 'hey.com', 'fastmail.com',
  'inbox.com', 'qq.com', '163.com', '126.com', 'naver.com', 'hanmail.net', 'daum.net', 'web.de', 'libero.it', 'orange.fr', 'laposte.net',
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'temp-mail.org', 'tempmail.com', 'yopmail.com', 'sharklasers.com',
  'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'throwawaymail.com',
]);

const isFreeEmailDomain = (domain) => FREE_EMAIL_DOMAINS.has(String(domain).toLowerCase());

module.exports = { FREE_EMAIL_DOMAINS, isFreeEmailDomain };
